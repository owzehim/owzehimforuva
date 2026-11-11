import { createClient } from '@supabase/supabase-js'
import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'

const RECOVERY_REQUEST_MAX_AGE_MS = 60 * 60 * 1000
const SIGNAL_TTL_MS = 15 * 60 * 1000

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// SEC-61: recovery-link sessions carry amr 'otp' (GoTrue); a normal sign-in
// (password/OAuth) must not be able to mark a reset as completed.
function isEmailLinkSession(accessToken: string) {
  try {
    const payload = accessToken.split('.')[1] || ''
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return Array.isArray(claims?.amr) && claims.amr.length > 0 &&
      claims.amr.every((entry: { method?: unknown }) => ['otp', 'recovery', 'magiclink'].includes(String(entry?.method)))
  } catch {
    return false
  }
}

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders)
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  try {
    const { action, token } = await req.json()
    if (
      !['complete', 'check'].includes(action)
      || typeof token !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
    ) {
      return jsonResponse({ error: 'Invalid request' }, 400, corsHeaders)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: 'Service unavailable' }, 500, corsHeaders)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const tokenHash = await hashToken(token)

    // SEC-61: same limits as email-confirmation-return-signal. The login
    // screen polls 'check' about every 5 seconds while visible.
    const ip = req.headers.get('cf-connecting-ip') || 'unknown-client'
    const limits = await Promise.all([
      admin.rpc('consume_edge_rate_limit', { p_key_hash: await hashToken(`reset-return:${action}:ip:${ip}`), p_limit: action === 'check' ? 100 : 30, p_window_seconds: action === 'check' ? 10 : 60 }),
      admin.rpc('consume_edge_rate_limit', { p_key_hash: await hashToken(`reset-return:${tokenHash}`), p_limit: 60, p_window_seconds: 60 }),
    ])
    if (limits.some((result) => result.error)) return jsonResponse({ error: 'Service unavailable' }, 503, corsHeaders)
    if (limits.some((result) => result.data !== true)) return jsonResponse({ error: 'Too many requests' }, 429, corsHeaders)

    // Opportunistically remove expired records. The table only contains
    // hashed, short-lived tokens and never stores an email or account ID.
    await admin.from('password_reset_return_signals').delete().lt('expires_at', new Date().toISOString())

    if (action === 'complete') {
      const bearerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (!bearerToken) return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
      const { data: { user }, error: authError } = await admin.auth.getUser(bearerToken)
      if (authError || !user || !isEmailLinkSession(bearerToken)) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
      }
      // SEC-61: a reset must have been requested for this account in the last
      // hour. A normal sign-in session of an account with no recent reset
      // request cannot pose as a completed reset.
      const recoverySentAt = Date.parse(String((user as { recovery_sent_at?: string }).recovery_sent_at || ''))
      if (!Number.isFinite(recoverySentAt) || Date.now() - recoverySentAt > RECOVERY_REQUEST_MAX_AGE_MS) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
      }

      const expiresAt = new Date(Date.now() + SIGNAL_TTL_MS).toISOString()
      const { error } = await admin.from('password_reset_return_signals').upsert(
        { token_hash: tokenHash, expires_at: expiresAt },
        { onConflict: 'token_hash' },
      )
      if (error) throw error
      return jsonResponse({ completed: true }, 200, corsHeaders)
    }

    const { data, error } = await admin
      .from('password_reset_return_signals')
      .select('token_hash')
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (error) throw error

    if (data) return jsonResponse({ completed: true }, 200, corsHeaders)

    return jsonResponse({ completed: false }, 200, corsHeaders)
  } catch (error) {
    console.error('Password reset return signal failed:', error instanceof Error ? error.name : 'unknown')
    return jsonResponse({ error: 'Could not check password reset status' }, 500, corsHeaders)
  }
})
