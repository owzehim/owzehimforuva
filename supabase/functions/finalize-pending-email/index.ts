import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { finalizePendingEmail } from '../_shared/finalizePendingEmail.js'

const failureMessage = 'Email confirmation completed, but the account update could not be finished. Please contact support.'

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
  if (req.method !== 'POST') return json({ success: false, message: 'Method not allowed.' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = getSupabaseServiceKey()
  if (!token || !supabaseUrl || !serviceKey) {
    return json({ success: false, message: failureMessage }, 401)
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user || !user.email_confirmed_at || !user.email) {
      return json({ success: false, message: failureMessage }, 401)
    }

    let changed = false
    try {
      const result = await finalizePendingEmail(admin, user)
      changed = result.changed
    } catch {
      console.error('Pending email finalization failed; mapping retained for retry')
      return json({ success: false, message: failureMessage }, 503)
    }
    if (!changed) return json({ success: true, changed: false })

    if (!user.user_metadata?.registration) {
      const { error: cleanupError } = await admin
        .from('pending_email_changes')
        .delete()
        .eq('new_user_id', user.id)
        .neq('state', 'pending')
      if (cleanupError) {
        console.error('Completed pending email change could not be cleaned up')
        return json({ success: false, message: failureMessage }, 503)
      }
    }

    return json({ success: true, changed: true })
  } catch (error) {
    console.error('Pending email change finalization failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return json({ success: false, message: failureMessage }, 500)
  }
})
