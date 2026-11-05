// SEC-58: each partner's Apps Script has its own secret, so one partner who
// reads the value in their sheet's Script Properties cannot write to another
// partner's sheet. Secrets live in public.partnership_apps_script_secrets
// (service_role only). A partner uses its own secret once `enabled` is true;
// until then the old shared PARTNER_APPS_SCRIPT_SECRET is used (transition).
export const PARTNER_SECRETS_TABLE = 'partnership_apps_script_secrets'

export async function getPartnerAppsScriptSecret(admin, partnershipId, fallbackSecret) {
  const fallback = typeof fallbackSecret === 'string' && fallbackSecret ? fallbackSecret : null
  if (typeof partnershipId !== 'string' || !partnershipId) return fallback
  try {
    const { data, error } = await admin
      .from(PARTNER_SECRETS_TABLE)
      .select('secret')
      .eq('partnership_id', partnershipId)
      .eq('enabled', true)
      .maybeSingle()
    if (error) {
      console.error('Partner Apps Script secret lookup failed')
      return fallback
    }
    return typeof data?.secret === 'string' && data.secret.length >= 32 ? data.secret : fallback
  } catch {
    console.error('Partner Apps Script secret lookup failed')
    return fallback
  }
}
