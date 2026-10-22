import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { withAppsScriptSecret } from '../_shared/appsScriptAuth.js'
import { getMasterPrivacyEndpoint } from '../_shared/masterPrivacyEndpoint.ts'

async function anonymizeMasterSheet(admin: any, userId: string) {
  const url = await getMasterPrivacyEndpoint(admin)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify(withAppsScriptSecret(
      { type: 'privacy_anonymize', user_id: userId },
      Deno.env.get('MASTER_APPS_SCRIPT_SECRET'),
    )),
  })
  const contentType = response.headers.get('content-type') || ''
  const responseText = await response.text().catch(() => '')
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(responseText)
  } catch {
    // Google Apps Script can return an HTML error page even when fetch follows
    // its redirect successfully. Keep the body out of logs because it is
    // controlled by an external endpoint.
  }
  if (!response.ok || body?.success !== true) {
    const responseKind = body === null
      ? (contentType.includes('text/html') ? 'html' : 'non_json')
      : typeof body.success === 'boolean'
        ? (body.success ? 'success_true' : 'success_false')
        : 'success_flag_missing'
    const remoteText = [body?.error, body?.message, body?.code]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
    const reasonKind = /secret|auth|forbidden|unauthor/.test(remoteText)
      ? 'authorization_rejected'
      : /not.?found|no.?match|missing.?user/.test(remoteText)
        ? 'record_not_found'
        : /unknown.?type|unsupported.?type|invalid.?type/.test(remoteText)
          ? 'unsupported_request'
          : responseKind === 'success_false'
            ? 'remote_rejected'
            : 'invalid_response'
    throw new Error(`Master Sheet response rejected (http_${response.status}, ${reasonKind})`)
  }
}

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  let stage = 'request_validation'
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const body = await req.json().catch(() => null)
    if (!token || body?.confirmation !== 'DELETE') {
      return json({ success: false, message: '계정 삭제 확인이 필요합니다.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Account deletion service configuration is missing')
      return json({ success: false, message: '계정 삭제 서비스를 사용할 수 없습니다.' }, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    stage = 'auth_user_verification'
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    const claims = decodeClaims(token)
    if (userError || !user || claims?.sub !== user.id || claims?.app_access !== true) {
      return json({ success: false, message: '다시 로그인하고 이메일 인증을 완료해 주세요.' }, 401)
    }
    stage = 'active_session_verification'
    if (!hasVerifiedAppLogin(token, user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, user.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    stage = 'administrator_guard'
    const { data: adminRole, error: adminRoleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (adminRoleError) throw new Error('Could not check account permissions')
    if (adminRole) {
      const { count, error: adminCountError } = await admin
        .from('admin_roles')
        .select('user_id', { count: 'exact', head: true })
      if (adminCountError) throw new Error('Could not check administrator coverage')
      if ((count || 0) <= 1) {
        return json({ success: false, message: '마지막 관리자는 먼저 다른 관리자에게 권한을 넘긴 뒤 삭제할 수 있습니다.' }, 409)
      }
    }

    // The master sheet still has identifying fields. Anonymize it before the
    // member row and Auth identity are irreversibly removed.
    stage = 'master_sheet_anonymization'
    await anonymizeMasterSheet(admin, user.id)

    stage = 'profile_image_cleanup'
    const { error: imageError } = await admin.storage
      .from('profile-images')
      .remove([`avatars/${user.id}.jpg`])
    if (imageError) throw new Error('Profile image cleanup failed')

    // These two operational tables intentionally have no Auth foreign key, so
    // Auth's ON DELETE CASCADE cannot clean them up.
    stage = 'redemptions_cleanup'
    const { error: redemptionsError } = await admin
      .from('redemptions')
      .delete()
      .eq('user_id', user.id)
    if (redemptionsError) throw new Error('Redemption cleanup failed')

    stage = 'analytics_cleanup'
    const { error: analyticsError } = await admin
      .from('member_analytics_profiles')
      .delete()
      .eq('user_id', user.id)
    if (analyticsError) throw new Error('Analytics cleanup failed')

    stage = 'pending_email_changes_cleanup'
    const { error: pendingChangesError } = await admin
      .from('pending_email_changes')
      .delete()
      .or(`old_user_id.eq.${user.id},new_user_id.eq.${user.id}`)
    if (pendingChangesError) throw new Error('Pending email change cleanup failed')

    // This retry queue deliberately has no Auth foreign key. Remove any stale
    // retention entry so a later scheduled run does not revisit this account.
    stage = 'privacy_queue_cleanup'
    const { error: privacyQueueError } = await admin
      .from('privacy_sheet_sync_queue')
      .delete()
      .eq('user_id', user.id)
    if (privacyQueueError) throw new Error('Privacy queue cleanup failed')

    // Revoke refresh sessions before deleting the Auth user. Existing access
    // JWTs may remain valid until expiry, but all account-owned rows are gone.
    stage = 'session_revocation'
    const { error: signOutError } = await admin.auth.admin.signOut(token, 'global')
    if (signOutError) throw new Error('Could not revoke account sessions')

    stage = 'auth_user_deletion'
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteUserError) throw new Error('Auth account deletion failed')

    return json({ success: true })
  } catch (error) {
    console.error('Account deletion did not complete', {
      stage,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return json({ success: false, message: '계정 삭제가 완료되지 않았습니다. 데이터가 일부 남아 있을 수 있으니 관리자에게 문의해 주세요.' }, 500)
  }
})
