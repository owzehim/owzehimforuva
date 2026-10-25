import { hasAppAccessClaim } from './authRules.js'

export function shouldAutoDetectSessionInUrl(pathname, search = '', hash = '') {
  const normalizedPath = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (normalizedPath !== '/email-confirmed') return false

  const searchParams = new URLSearchParams(String(search).replace(/^\?/, ''))
  const hashParams = new URLSearchParams(String(hash).replace(/^#/, ''))
  const accessToken = hashParams.get('access_token') || searchParams.get('access_token')

  // Email callback routes may exchange email-link tokens, but must not let an
  // existing app session supplied in the URL replace the current session.
  return !accessToken || !hasAppAccessClaim(accessToken)
}
