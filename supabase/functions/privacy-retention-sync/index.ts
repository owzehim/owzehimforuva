import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { constantTimeSecretEquals } from '../_shared/constantTimeSecret.js'

async function postJsonToAppsScript(url: string, payload: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withAppsScriptSecret(payload, Deno.env.get('APPS_SCRIPT_SHARED_SECRET'))),
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // Apps Script can echo user data or the webhook URL in its response.
    throw new Error(`Apps Script failed with status ${res.status}`)
  }

  if (!text) throw new Error('Apps Script did not confirm anonymization')

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // A successful Apps Script deployment can return plain text. Never copy
    // an untrusted response body into errors or logs.
    return text
  }
  if (body && typeof body === 'object' && 'success' in body && body.success === false) {
    throw new Error('Apps Script returned failure')
  }
  if (!body || typeof body !== 'object' || !('success' in body) || body.success !== true) {
    throw new Error('Apps Script did not confirm anonymization')
  }
  return body
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const expectedSecret = Deno.env.get('RETENTION_JOB_SECRET')
    const suppliedSecret = req.headers.get('x-retention-secret')

    if (!await constantTimeSecretEquals(expectedSecret, suppliedSecret)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Unauthorized retention job request' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    const masterAppsScriptUrl = Deno.env.get('MASTER_SHEET_APPS_SCRIPT_URL')

    if (!supabaseUrl || !serviceKey || !masterAppsScriptUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          message: '개인정보 보존 작업을 처리하지 못했습니다.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: newlyQueued, error: queueError } = await admin.rpc('queue_expired_member_anonymizations')

    if (queueError) {
      console.error('Retention RPC failed')
      return new Response(
        JSON.stringify({ success: false, message: '개인정보 보존 작업을 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: queuedUsers, error: claimError } = await admin.rpc(
      'claim_privacy_sheet_sync_batch',
      { p_batch_size: 50 },
    )
    if (claimError) {
      console.error('Privacy sync queue claim failed')
      return new Response(
        JSON.stringify({ success: false, message: '개인정보 보존 작업을 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const users = Array.isArray(queuedUsers) ? queuedUsers : []
    let syncedCount = 0
    let failedCount = 0

    for (const row of users) {
      const userId = typeof row === 'string' ? row : row?.anonymized_user_id || row?.user_id
      if (!userId) continue

      try {
        await postJsonToAppsScript(masterAppsScriptUrl, {
          type: 'privacy_anonymize',
          user_id: userId,
        })
        const { data: completed, error: completionError } = await admin.rpc('complete_privacy_sheet_sync', {
          p_user_id: userId,
          p_success: true,
        })
        if (completionError || completed !== true) throw new Error('Privacy sync acknowledgement failed')
        syncedCount += 1
      } catch {
        console.error('Master Sheet privacy sync failed')
        failedCount += 1
        await admin.rpc('complete_privacy_sheet_sync', {
          p_user_id: userId,
          p_success: false,
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: failedCount === 0,
        newly_queued_count: Number(newlyQueued) || 0,
        attempted_count: users.length,
        sheet_synced_count: syncedCount,
        sheet_failed_count: failedCount,
      }),
      {
        status: failedCount === 0 ? 200 : 207,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch {
    console.error('privacy-retention-sync fatal error')
    return new Response(
      JSON.stringify({
        success: false,
        message: '개인정보 보존 작업을 처리하지 못했습니다.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
