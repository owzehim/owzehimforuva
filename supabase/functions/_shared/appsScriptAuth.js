// Matches the webhook field expected by the existing master and partner Apps Scripts.
export const APPS_SCRIPT_AUTH_FIELD = 'shared_secret'

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
