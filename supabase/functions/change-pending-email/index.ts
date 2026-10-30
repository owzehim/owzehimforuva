import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getSupabasePublishableKey } from '../_shared/publishableKey.ts'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'

const genericFailure = 'Unable to change the email address. Check your details and try again later.'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safePendingMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ['registration', 'registration_accepted_at', 'first_name', 'last_name']) {
    if (Object.hasOwn(source, key)) result[key] = source[key]
  }
  return result
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: genericFailure }, 405)

  try {
    let body: Record<string, unknown> | null
    try {
      body = await readJsonBody(req, 4096) as Record<string, unknown>
    } catch (bodyError) {
      const status = bodyError instanceof RequestBodyTooLargeError ? 413 : 400
      return json({ success: false, message: genericFailure }, status)
    }
    const oldEmail = normalizeEmail(body?.currentEmail)
    const newEmail = normalizeEmail(body?.newEmail)
    const password = typeof body?.password === 'string' ? body.password : ''
    // The request origin has already passed the project-specific CORS allowlist.
    const confirmationUrl = new URL('/email-confirmed', origin || 'https://app.uva-in.nl')
    if (body?.returnToken !== undefined) {
      if (typeof body.returnToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.returnToken)) {
        return json({ success: false, message: genericFailure }, 400)
      }
      confirmationUrl.searchParams.set('returnToken', body.returnToken)
    }
    const confirmationRedirect = confirmationUrl.toString()

    if (!validEmail(oldEmail) || !validEmail(newEmail) || oldEmail === newEmail || !password || password.length > 256) {
      return json({ success: false, message: genericFailure }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const publishableKey = getSupabasePublishableKey()
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !publishableKey || !serviceKey) {
      return json({ success: false, message: 'Email changes are temporarily unavailable.' }, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const clientIp = req.headers.get('cf-connecting-ip') || 'unknown-client'
    const [ipBucket, emailBucket] = await Promise.all([
      sha256(`pending-email:ip:${clientIp}`),
      sha256(`pending-email:account:${oldEmail}`),
    ])
    const [ipLimit, emailLimit] = await Promise.all([
      admin.rpc('consume_edge_rate_limit', { p_key_hash: ipBucket, p_limit: 8, p_window_seconds: 900 }),
      admin.rpc('consume_edge_rate_limit', { p_key_hash: emailBucket, p_limit: 5, p_window_seconds: 3600 }),
    ])
    if (ipLimit.error || emailLimit.error) {
      console.error('Pending email rate limiter is unavailable')
      return json({ success: false, message: 'Email changes are temporarily unavailable.' }, 503)
    }
    if (ipLimit.data !== true || emailLimit.data !== true) {
      return json({ success: false, message: 'Too many attempts. Please wait before trying again.' }, 429)
    }

    const passwordClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(publishableKey) },
    })
    const { error: passwordError } = await passwordClient.auth.signInWithPassword({
      email: oldEmail,
      password,
    })
    if (!passwordError || passwordError.code !== 'email_not_confirmed') {
      return json({ success: false, message: genericFailure }, 400)
    }

    const { data: pendingUsers, error: lookupError } = await admin.rpc(
      'find_pending_auth_user_by_email',
      { p_email: oldEmail },
    )
    const pendingUser = Array.isArray(pendingUsers) ? pendingUsers[0] : null
    if (lookupError || !pendingUser?.user_id) {
      if (lookupError) console.error('Pending account lookup failed')
      return json({ success: false, message: genericFailure }, 400)
    }

    const oldUserId = String(pendingUser.user_id)
    const { data: existingChange, error: pendingChangeError } = await admin
      .from('pending_email_changes')
      .select('new_user_id, new_email, state')
      .eq('old_user_id', oldUserId)
      .maybeSingle()
    if (pendingChangeError) {
      console.error('Pending email change lookup failed')
      return json({ success: false, message: genericFailure }, 503)
    }
    if (existingChange) {
      if (existingChange.state !== 'pending' || normalizeEmail(existingChange.new_email) !== newEmail) {
        return json({ success: false, message: genericFailure }, 400)
      }
      const { error: resendError } = await admin.auth.resend({
        type: 'signup',
        email: newEmail,
        options: { emailRedirectTo: confirmationRedirect },
      })
      if (resendError) {
        console.error('Pending email confirmation could not be resent')
        return json({ success: false, message: genericFailure }, 400)
      }
      return json({ success: true, message: 'A confirmation link was sent to the new address.' })
    }

    const { data: newAuth, error: createError } = await admin.auth.admin.createUser({
      email: newEmail,
      password,
      email_confirm: false,
      user_metadata: safePendingMetadata(pendingUser.user_metadata),
    })
    if (createError || !newAuth.user) {
      console.warn('Pending email replacement could not be created')
      return json({ success: false, message: genericFailure }, 400)
    }

    const newUserId = newAuth.user.id
    const { error: pendingInsertError } = await admin.from('pending_email_changes').insert({
      new_user_id: newUserId,
      old_user_id: oldUserId,
      new_email: newEmail,
      original_created_at: pendingUser.created_at,
    })
    if (pendingInsertError) {
      await admin.auth.admin.deleteUser(newUserId)
      console.error('Pending email change could not be recorded')
      return json({ success: false, message: genericFailure }, 503)
    }

    const { error: resendError } = await admin.auth.resend({
      type: 'signup',
      email: newEmail,
      options: { emailRedirectTo: confirmationRedirect },
    })
    if (resendError) {
      await admin.from('pending_email_changes').delete().eq('new_user_id', newUserId)
      await admin.auth.admin.deleteUser(newUserId)
      console.error('Pending email confirmation could not be sent')
      return json({ success: false, message: genericFailure }, 400)
    }

    return json({ success: true, message: 'A confirmation link was sent to the new address.' })
  } catch (error) {
    console.error('change-pending-email failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return json({ success: false, message: genericFailure }, 500)
  }
})
