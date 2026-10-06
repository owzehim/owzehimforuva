/**
 * Only call this with claims returned by supabase.auth.getClaims(), which
 * verifies the access token. Decoding a JWT stored by the browser is not proof.
 */
export function isPasswordRecoveryClaims(claims) {
  return Array.isArray(claims?.amr) &&
    claims.amr.some((entry) => entry?.method === 'recovery')
}
