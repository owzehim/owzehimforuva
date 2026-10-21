// Matches the field read by the deployed Master Apps Script authorization guard.
export const APPS_SCRIPT_AUTH_FIELD = '__uvain_shared_secret'

export function getAllowedAppsScriptUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'script.google.com'
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

export function withAppsScriptSecret(payload, secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Apps Script shared secret is not configured')
  }
  if (Object.prototype.hasOwnProperty.call(payload, APPS_SCRIPT_AUTH_FIELD)) {
    throw new Error('Apps Script payload contains a reserved field')
  }

  return {
    ...payload,
    [APPS_SCRIPT_AUTH_FIELD]: secret,
  }
}
