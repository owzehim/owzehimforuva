/**
 * SEC-59: a password-reset page must only accept a session created by an
 * email link, never a normal sign-in session pasted into a crafted URL.
 *
 * Supabase Auth issues recovery-link sessions with amr method "otp"
 * (verified against GoTrue 2026-11-05), so "recovery" alone is not enough;
 * accept the email-link methods and reject password/OAuth/SSO sessions.
 * Call only after Auth has validated the session (setSession/getUser).
 */
const EMAIL_LINK_METHODS = new Set(['otp', 'recovery', 'magiclink'])

export function isEmailLinkSession(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1]
    if (!payload) return false
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded))
    if (!Array.isArray(claims?.amr) || claims.amr.length === 0) return false
    return claims.amr.every((entry) => EMAIL_LINK_METHODS.has(entry?.method))
  } catch {
    return false
  }
}
