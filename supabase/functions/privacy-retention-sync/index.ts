import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { constantTimeSecretEquals } from '../_shared/constantTimeSecret.js'
import { getMasterPrivacyEndpoint } from '../_shared/masterPrivacyEndpoint.ts'
import { retryPendingEmailCleanup } from '../_shared/finalizePendingEmail.js'

async function anonymizeMasterSheet(url: string, userId: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withAppsScriptSecret(
      { type: 'privacy_anonymize', user_id: userId },
      Deno.env.get('MASTER_APPS_SCRIPT_SECRET'),
    )),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true) throw new Error('Master sheet did not confirm anonymization')
}

async function clearAuthPersonalMetadata(admin: any, userId: string) {
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

async function deleteAuthAccount(admin: any, userId: string) {
  const { error: imageError } = await admin.storage
    .from('profile-images')
    .remove([`avatars/${userId}.jpg`])
  if (imageError) throw new Error('Profile image cleanup failed')

  const { error: reporterReportsError } = await admin
    .from('restaurant_note_reports')
    .update({ reporter_id: null, reporter_name: null, reporter_email: null })
    .eq('reporter_id', userId)
  if (reporterReportsError) throw new Error('Reporter identity cleanup failed')

  const { error: authorReportsError } = await admin
    .from('restaurant_note_reports')
    .update({ content_author_id: null, content_author_email: null, content_author_name_snapshot: null })
    .eq('content_author_id', userId)
  if (authorReportsError) throw new Error('Reported author identity cleanup failed')

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) throw new Error('Auth account deletion failed')
}

Deno.serve(async (req) => {
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

    const admin: any = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    let pendingEmailCleanup = { completed: 0, failed: 0 }
    try {
      pendingEmailCleanup = await retryPendingEmailCleanup(admin)
    } catch {
      console.error('Pending email cleanup retry lookup failed')
      pendingEmailCleanup.failed = 1
    }

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
    const sheetUsers = users.filter((row) => row?.sync_master_sheet !== false)
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
      const hasExplicitSheetSync = typeof row === 'object' &&
        typeof row?.sync_master_sheet === 'boolean'
      // Older DB versions returned only delete_auth_user. There, false meant
      // an expired member (sync Master first, then delete); true meant an
      // unverified/inactive signup with no Master Sheet row.
      const deleteAuthUser = typeof row === 'object' &&
        (row?.delete_auth_user === true ||
          (!hasExplicitSheetSync && row?.delete_auth_user === false))
      const syncMasterSheet = hasExplicitSheetSync
        ? row.sync_master_sheet
        : typeof row !== 'object' || row?.delete_auth_user !== true

      try {
        if (syncMasterSheet) {
          if (!masterUrl) throw new Error('Master sheet endpoint is not configured')
          await anonymizeMasterSheet(masterUrl, userId)
          syncedCount += 1
        }
        if (deleteAuthUser) {
          await deleteAuthAccount(admin, userId)
          deletedAuthAccountCount += 1
        } else {
          await clearAuthPersonalMetadata(admin, userId)
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

    // Use a calendar-year cutoff for the agreed 12-month retention period.
    const retentionNow = new Date()
    const retentionYear = retentionNow.getUTCFullYear() - 1
    const retentionMonth = retentionNow.getUTCMonth()
    const retentionDay = Math.min(
      retentionNow.getUTCDate(),
      new Date(Date.UTC(retentionYear, retentionMonth + 1, 0)).getUTCDate(),
    )
    const retentionCutoff = new Date(Date.UTC(
      retentionYear,
      retentionMonth,
      retentionDay,
      retentionNow.getUTCHours(),
      retentionNow.getUTCMinutes(),
      retentionNow.getUTCSeconds(),
      retentionNow.getUTCMilliseconds(),
    )).toISOString()

    let retentionFailedCount = 0
    const rewardRetentionNow = new Date().toISOString()
    const { count: expiredPartnerRewardsCount, error: rewardRetentionError } = await admin
      .from('stamp_card_rewards')
      .delete({ count: 'exact' })
      .lte('delete_after', rewardRetentionNow)
    if (rewardRetentionError) {
      console.error('Expired partner reward cleanup failed')
      retentionFailedCount += 1
    }
    const { count: expiredHiddenNoteCount, error: hiddenNoteRetentionError } = await admin
      .from('restaurant_notes')
      .delete({ count: 'exact' })
      .lt('hidden_at', retentionCutoff)
    if (hiddenNoteRetentionError) {
      console.error('Hidden note retention cleanup failed')
      retentionFailedCount += 1
    }

    const { count: expiredReportCount, error: reportRetentionError } = await admin
      .from('restaurant_note_reports')
      .delete({ count: 'exact' })
      .eq('status', 'resolved')
      .lt('reviewed_at', retentionCutoff)
    if (reportRetentionError) {
      console.error('Resolved content report retention cleanup failed')
      retentionFailedCount += 1
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
    const success = failedCount === 0 && expiredSignupFailedCount === 0 && pendingEmailCleanup.failed === 0 &&
      retentionFailedCount === 0 && overdueRecordCount === 0 && remainingQueueCount === 0

    return new Response(
      JSON.stringify({
        success,
        newly_queued_count: Number(newlyQueued) || 0,
        attempted_count: users.length,
        pending_email_cleanup_completed_count: pendingEmailCleanup.completed,
        pending_email_cleanup_failed_count: pendingEmailCleanup.failed,
        expired_signup_accounts_deleted_count: expiredSignupDeletedCount,
        expired_signup_accounts_failed_count: expiredSignupFailedCount,
        orphaned_pending_email_mappings_deleted_count: Number(cleanedPendingEmailMappings) || 0,
        expired_partner_rewards_deleted_count: Number(expiredPartnerRewardsCount) || 0,
        sheet_synced_count: syncedCount,
        auth_accounts_deleted_count: deletedAuthAccountCount,
        expired_hidden_notes_deleted_count: Number(expiredHiddenNoteCount) || 0,
        expired_content_report_records_deleted_count: Number(expiredReportCount) || 0,
        retention_cleanup_failed_count: retentionFailedCount,
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
