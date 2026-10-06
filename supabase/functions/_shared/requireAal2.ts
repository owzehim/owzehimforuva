export async function hasAal2(admin: any, accessToken: string): Promise<boolean> {
  if (!accessToken) return false
  const { data, error } = await admin.auth.mfa.getAuthenticatorAssuranceLevel(accessToken)
  if (!error && data?.currentLevel === 'aal2') return true

  // The app's password + email OTP flow uses a server-issued session claim,
  // not Supabase's native AAL2. Permit it for member actions, but keep admin
  // actions behind native AAL2 even when the admin account skips email OTP.
  try {
    const encodedPayload = accessToken.split('.')[1]
    if (!encodedPayload) return false
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded))
    if (claims?.app_access !== true || typeof claims?.sub !== 'string') return false

    const { data: adminRole, error: roleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', claims.sub)
      .maybeSingle()

    return !roleError && !adminRole
  } catch {
    return false
  }
}

export function requireAal2Response(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ success: false, message: '계속하려면 2단계 인증을 완료해 주세요.' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

export async function hasActiveDeviceSession(
  admin: any,
  userId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const { data: adminRole, error: roleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (!roleError && adminRole) return true

    const encodedPayload = accessToken.split('.')[1]
    if (!encodedPayload) return false
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded))
    const sessionId = claims?.session_id
    if (claims?.sub !== userId || typeof sessionId !== 'string' || !sessionId) return false

    const { data: member, error: memberError } = await admin
      .from('members')
      .select('session_token')
      .eq('user_id', userId)
      .maybeSingle()

    return !memberError && member?.session_token === sessionId
  } catch {
    return false
  }
}
