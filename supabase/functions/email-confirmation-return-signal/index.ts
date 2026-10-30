import { createClient } from '@supabase/supabase-js'
import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { readJsonBody } from '../_shared/readJsonBody.js'

const STATUSES = ['success', 'error', 'registration_error', 'email_change_error']
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const cors = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return json({ error: 'Origin not allowed' }, 403)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let body: any
  try { body = await readJsonBody(req, 1024) } catch { return json({ error: 'Invalid request' }, 400) }
  const { action, token, status } = body || {}
  if (!['check', 'complete'].includes(action) || typeof token !== 'string' || !TOKEN_PATTERN.test(token) ||
      (action === 'complete' && !STATUSES.includes(status))) return json({ error: 'Invalid request' }, 400)
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!url || !serviceKey) return json({ error: 'Service unavailable' }, 503)
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const tokenHash = await hash(token)
    const ip = req.headers.get('cf-connecting-ip') || 'unknown-client'
    const limits = await Promise.all([
      admin.rpc('consume_edge_rate_limit', { p_key_hash: await hash(`email-return:${action}:ip:${ip}`), p_limit: action === 'check' ? 600 : 30, p_window_seconds: 60 }),
      admin.rpc('consume_edge_rate_limit', { p_key_hash: await hash(`email-return:${tokenHash}`), p_limit: 60, p_window_seconds: 60 }),
    ])
    if (limits.some(result => result.error)) return json({ error: 'Service unavailable' }, 503)
    if (limits.some(result => result.data !== true)) return json({ error: 'Too many requests' }, 429)
    const now = new Date().toISOString()
    await admin.from('email_confirmation_return_signals').delete().lt('expires_at', now)
    // Possession of the unpredictable per-email token authorizes only this
    // screen notification. No account IDs, email addresses, passwords or Auth
    // sessions are accepted, returned, or changed by this endpoint.
    if (action === 'complete') {
      const { error } = await admin.from('email_confirmation_return_signals').upsert({
        token_hash: tokenHash, status, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'token_hash' })
      if (error) throw error
      return json({ success: true })
    }
    const { data, error } = await admin.from('email_confirmation_return_signals')
      .select('status').eq('token_hash', tokenHash).gt('expires_at', now).maybeSingle()
    if (error) throw error
    return json({ status: data?.status || 'pending' })
  } catch {
    console.error('Email confirmation return signal failed')
    return json({ error: 'Could not synchronize confirmation status' }, 503)
  }
})
