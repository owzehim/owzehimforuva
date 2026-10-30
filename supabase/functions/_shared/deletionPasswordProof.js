/** Call only after Auth validates the proof JWT independently with getUser. */
export function hasFreshDeletionPasswordProof(claims, expectedUserId, now = Math.floor(Date.now() / 1000)) {
  if (!expectedUserId || claims?.sub !== expectedUserId ||
      typeof claims?.session_id !== 'string' || !claims.session_id ||
      typeof claims?.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Array.isArray(claims?.amr)) return false

  // This is the proof created by the password entered in the deletion dialog.
  // It does not limit the age of the member's existing app login session.
  return claims.amr.some((method) => method?.method === 'password' &&
    typeof method.timestamp === 'number' && Number.isFinite(method.timestamp) &&
    method.timestamp >= now - 5 * 60 && method.timestamp <= now + 30)
}
