import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { constantTimeSecretEquals } from '../_shared/constantTimeSecret.js'

async function anonymizeMasterSheet(url: string, userId: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withAppsScriptSecret(
      { type: 'privacy_anonymize', user_id: userId },
      Deno.env.get('APPS_SCRIPT_SHARED_SECRET'),
    )),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true) throw new Error('Master sheet did not confirm anonymization')
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
    if (!supabaseUrl || !serviceKey) {
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
    let masterUrl: string | null = null
    if (users.length > 0) {
      const { data: integration, error: integrationError } = await admin
        .from('partnership_integrations')
        .select('master_apps_script_url')
        .not('master_apps_script_url', 'is', null)
        .limit(1)
        .maybeSingle()
      if (integrationError) {
        console.error('Master sheet configuration lookup failed')
        return new Response(
          JSON.stringify({ success: false, message: '개인정보 보존 작업을 처리하지 못했습니다.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      masterUrl = integration?.master_apps_script_url || null
    }
    let syncedCount = 0
    let failedCount = 0

    for (const row of users) {
      const userId = typeof row === 'string' ? row : row?.anonymized_user_id || row?.user_id
      if (!userId) continue

      try {
        if (!masterUrl) throw new Error('Master sheet endpoint is not configured')
        await anonymizeMasterSheet(masterUrl, userId)
        const { data: completed, error: completionError } = await admin.rpc('complete_privacy_sheet_sync', {
          p_user_id: userId,
          p_success: true,
        })
        if (completionError || completed !== true) throw new Error('Privacy queue acknowledgement failed')
        syncedCount += 1
      } catch {
        console.error('Privacy queue cleanup failed')
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
        historical_archive_updated: false,
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
