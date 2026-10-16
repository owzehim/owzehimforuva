import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { constantTimeSecretEquals } from '../_shared/constantTimeSecret.js'
import { getMasterPrivacyEndpoint } from '../_shared/masterPrivacyEndpoint.ts'

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

async function clearAuthPersonalMetadata(admin: ReturnType<typeof createClient>, userId: string) {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      first_name: null,
      last_name: null,
      first_name_korean: null,
      last_name_korean: null,
      name: null,
      registration: null,
      registration_accepted_at: null,
    },
  })
  if (error && error.status !== 404) throw new Error('Auth metadata cleanup failed')
}

async function deleteAuthAccount(admin: ReturnType<typeof createClient>, userId: string) {
  const { error: imageError } = await admin.storage
    .from('profile-images')
    .remove([`avatars/${userId}.jpg`])
  if (imageError) throw new Error('Inactive account profile image cleanup failed')

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) throw new Error('Inactive Auth account deletion failed')
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

    const { data: expiredSignups, error: expiredSignupsError } = await admin.rpc(
      'find_expired_signup_auth_users',
      { p_batch_size: 100 },
    )
    if (expiredSignupsError) {
      console.error('Expired signup lookup failed')
      return new Response(
        JSON.stringify({ success: false, message: '만료된 가입 계정 정리를 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let expiredSignupDeletedCount = 0
    let expiredSignupFailedCount = 0
    for (const row of Array.isArray(expiredSignups) ? expiredSignups : []) {
      const userId = row?.user_id
      if (typeof userId !== 'string') continue
      try {
        await deleteAuthAccount(admin, userId)
        expiredSignupDeletedCount += 1
      } catch {
        console.error('Expired signup cleanup failed')
        expiredSignupFailedCount += 1
      }
    }

    const { data: cleanedPendingEmailMappings, error: pendingEmailCleanupError } = await admin.rpc(
      'cleanup_orphaned_pending_email_changes',
    )
    if (pendingEmailCleanupError) {
      console.error('Orphaned pending email cleanup failed')
      expiredSignupFailedCount += 1
    }

    const { data: newlyQueued, error: queueError } = await admin.rpc('queue_expired_member_anonymizations')

    if (queueError) {
      console.error('Retention RPC failed')
      return new Response(
        JSON.stringify({ success: false, message: '개인정보 보존 작업을 처리하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: queuedUsers, error: claimError } = await admin.rpc(
      'claim_privacy_retention_batch',
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
    const sheetUsers = users.filter((row) => row?.delete_auth_user !== true)
    let masterUrl: string | null = null
    if (sheetUsers.length > 0) {
      try {
        masterUrl = await getMasterPrivacyEndpoint(admin)
      } catch {
        console.error('Master sheet configuration lookup failed')
        return new Response(
          JSON.stringify({ success: false, message: '개인정보 보존 작업을 처리하지 못했습니다.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }
    let syncedCount = 0
    let deletedAuthAccountCount = 0
    let failedCount = 0

    for (const row of users) {
      const userId = typeof row === 'string' ? row : row?.anonymized_user_id || row?.user_id
      if (!userId) continue
      const deleteAuthUser = typeof row === 'object' && row?.delete_auth_user === true

      try {
        if (deleteAuthUser) {
          await deleteAuthAccount(admin, userId)
          deletedAuthAccountCount += 1
        } else {
          if (!masterUrl) throw new Error('Master sheet endpoint is not configured')
          await anonymizeMasterSheet(masterUrl, userId)
          await clearAuthPersonalMetadata(admin, userId)
          syncedCount += 1
        }
        const { data: completed, error: completionError } = await admin.rpc('complete_privacy_sheet_sync', {
          p_user_id: userId,
          p_success: true,
        })
        if (completionError || completed !== true) throw new Error('Privacy queue acknowledgement failed')
      } catch {
        console.error('Privacy queue cleanup failed')
        failedCount += 1
        await admin.rpc('complete_privacy_sheet_sync', {
          p_user_id: userId,
          p_success: false,
        })
      }
    }

    const { data: overdueData, error: overdueError } = await admin.rpc('count_overdue_member_retention')
    if (overdueError) {
      console.error('Overdue retention count failed')
      return new Response(
        JSON.stringify({ success: false, message: '개인정보 보존 작업 결과를 확인하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { count: pendingQueueCount, error: pendingQueueError } = await admin
      .from('privacy_sheet_sync_queue')
      .select('user_id', { count: 'exact', head: true })
    if (pendingQueueError) {
      console.error('Privacy retention queue count failed')
      return new Response(
        JSON.stringify({ success: false, message: '개인정보 보존 작업 결과를 확인하지 못했습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const overdueRecordCount = Number(overdueData) || 0
    const remainingQueueCount = Number(pendingQueueCount) || 0
    const success = failedCount === 0 && expiredSignupFailedCount === 0 &&
      overdueRecordCount === 0 && remainingQueueCount === 0

    return new Response(
      JSON.stringify({
        success,
        newly_queued_count: Number(newlyQueued) || 0,
        attempted_count: users.length,
        expired_signup_accounts_deleted_count: expiredSignupDeletedCount,
        expired_signup_accounts_failed_count: expiredSignupFailedCount,
        orphaned_pending_email_mappings_deleted_count: Number(cleanedPendingEmailMappings) || 0,
        sheet_synced_count: syncedCount,
        auth_accounts_deleted_count: deletedAuthAccountCount,
        sheet_failed_count: failedCount,
        overdue_record_count: overdueRecordCount,
        pending_sync_count: remainingQueueCount,
        historical_archive_updated: false,
      }),
      {
        status: success ? 200 : 207,
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
