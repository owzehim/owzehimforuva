import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'

function json(body: Record<string, unknown>, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function base32ToBytes(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let buffer = 0
  const output: number[] = []
  for (const char of value.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char)
    if (index < 0) return null
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return output.length ? new Uint8Array(output) : null
}

async function matchesTotp(token: string, secret: string) {
  const keyBytes = base32ToBytes(secret)
  if (!keyBytes) return false
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const nowCounter = Math.floor(Date.now() / 15_000)
  for (let offset = -2; offset <= 2; offset += 1) {
    const counter = nowCounter + offset
    if (counter < 0) continue
    const bytes = new Uint8Array(8)
    let remaining = counter
    for (let index = 7; index >= 0; index -= 1) {
      bytes[index] = remaining & 0xff
      remaining = Math.floor(remaining / 256)
    }
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes))
    const dynamicOffset = hmac[hmac.length - 1] & 0x0f
    const binary = ((hmac[dynamicOffset] & 0x7f) << 24)
      | ((hmac[dynamicOffset + 1] & 0xff) << 16)
      | ((hmac[dynamicOffset + 2] & 0xff) << 8)
      | (hmac[dynamicOffset + 3] & 0xff)
    const expected = String(binary % 100_000_000).padStart(8, '0')
    let difference = 0
    for (let index = 0; index < 8; index += 1) difference |= expected.charCodeAt(index) ^ token.charCodeAt(index)
    if (difference === 0) return true
  }
  return false
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function amsterdamToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ valid: false, reason: 'Invalid request.' }, corsHeaders, 405)

  try {
    const body = await req.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : ''
    if (token.length > 100 || !/^\d{8}_[^_]{1,64}$/.test(token)) {
      return json({ valid: false, reason: 'Invalid QR code.' }, corsHeaders, 400)
    }

    const separator = token.indexOf('_')
    const otp = token.slice(0, separator)
    const studentNumber = token.slice(separator + 1)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('QR verification service is not configured')
      return json({ valid: false, reason: 'Verification is temporarily unavailable.' }, corsHeaders, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const clientIp = req.headers.get('cf-connecting-ip') || 'unknown-client'
    const [ipBucket, tokenBucket] = await Promise.all([
      sha256(`verify-qr:ip:${clientIp}`),
      sha256(`verify-qr:token:${token}`),
    ])
    const [ipLimit, tokenLimit] = await Promise.all([
      admin.rpc('consume_edge_rate_limit', { p_key_hash: ipBucket, p_limit: 60, p_window_seconds: 900 }),
      admin.rpc('consume_edge_rate_limit', { p_key_hash: tokenBucket, p_limit: 6, p_window_seconds: 900 }),
    ])
    if (ipLimit.error || tokenLimit.error) {
      console.error('QR verification rate limiter is unavailable')
      return json({ valid: false, reason: 'Verification is temporarily unavailable.' }, corsHeaders, 503)
    }
    if (ipLimit.data !== true || tokenLimit.data !== true) {
      return json({ valid: false, reason: 'Too many attempts. Please try again later.' }, corsHeaders, 429)
    }

    const { data: member, error } = await admin
      .from('members')
      .select('first_name, last_name, first_name_korean, last_name_korean, student_number, major, membership_valid_until, is_member, identity_anonymized_at, totp_secret')
      .eq('student_number', studentNumber)
      .maybeSingle()
    if (error || !member || !member.totp_secret || !(await matchesTotp(otp, member.totp_secret))) {
      return json({ valid: false, reason: 'QR code has expired. Please ask the member to refresh.' }, corsHeaders)
    }

    const fullName = [member.first_name_korean || member.first_name, member.last_name_korean || member.last_name]
      .filter(Boolean)
      .join(' ')
    const publicMember = {
      full_name: fullName,
      student_number: member.student_number,
      major: member.major,
      membership_valid_until: member.membership_valid_until,
    }
    const membershipActive = member.is_member === true
      && !member.identity_anonymized_at
      && typeof member.membership_valid_until === 'string'
      && member.membership_valid_until >= amsterdamToday()

    if (!membershipActive) {
      return json({ valid: false, reason: 'Membership is not active.', member: publicMember }, corsHeaders)
    }
    return json({ valid: true, member: publicMember }, corsHeaders)
  } catch {
    console.error('QR verification failed')
    return json({ valid: false, reason: 'Verification is temporarily unavailable.' }, corsHeaders, 503)
  }
})
