/**
 * Call only after Supabase Auth has validated this access token with getUser.
 * The Auth Hook issues app_access=true only for a server-recorded email OTP
 * proof (or an explicitly allowlisted non-admin test account).
 */
export function hasVerifiedAppLogin(accessToken: string, expectedUserId: string): boolean {
  try {
    const encodedPayload = accessToken.split('.')[1]
    if (!encodedPayload || !expectedUserId) return false
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded))
    return claims?.app_access === true && claims?.sub === expectedUserId
  } catch {
    return false
  }
}

export function requireVerifiedLoginResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ success: false, message: '이메일 인증을 포함해 다시 로그인해 주세요.' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

// SEC-63: the single-device exemption is limited to this one test account,
// even if another user is added to login_otp_exempt_users.
const DEVICE_CHECK_EXEMPT_TEST_EMAIL = 'test@uvain.nl'

export async function hasActiveDeviceSession(
  admin: any,
  userId: string,
  accessToken: string,
  { testAccountEmail }: { testAccountEmail?: string | null } = {},
): Promise<boolean> {
  try {
    const encodedPayload = accessToken.split('.')[1]
    if (!encodedPayload) return false
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded))
    const sessionId = claims?.session_id
    if (claims?.sub !== userId || claims?.app_access !== true) return false

    const { data: member, error: memberError } = await admin
      .from('members')
      .select('session_token, is_test_account')
      .eq('user_id', userId)
      .maybeSingle()

    if (memberError) return false
    if (!member) {
      // SEC-25: admins hold one device seat like members. Only an admin
      // without a members row (no seat to hold) is let through.
      const { data: adminRole, error: roleError } = await admin
        .from('admin_roles')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()
      return !roleError && Boolean(adminRole)
    }

    const isExemptTestEmail =
      typeof testAccountEmail === 'string' &&
      testAccountEmail.trim().toLowerCase() === DEVICE_CHECK_EXEMPT_TEST_EMAIL
    if (isExemptTestEmail && member.is_test_account === true) {
      const { data: exemption, error: exemptionError } = await admin
        .from('login_otp_exempt_users')
        .select('user_id')
        .eq('user_id', userId)
        .eq('reason', 'test')
        .maybeSingle()
      if (!exemptionError && exemption) return true
    }

    return typeof sessionId === 'string' && Boolean(sessionId) && member.session_token === sessionId
  } catch {
    return false
  }
}
