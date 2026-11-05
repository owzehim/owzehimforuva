// SEC-58: each partner's Apps Script has its own secret, so one partner who
// reads the value in their sheet's Script Properties cannot write to another
// partner's sheet. Secrets live in public.partnership_apps_script_secrets
// (service_role only, created automatically per partnership). A partner sheet
// only receives requests once its row is `enabled`; there is no shared secret.
export const PARTNER_SECRETS_TABLE = 'partnership_apps_script_secrets'

export async function getPartnerAppsScriptSecret(admin, partnershipId) {
  if (typeof partnershipId !== 'string' || !partnershipId) return null
  try {
    const { data, error } = await admin
      .from(PARTNER_SECRETS_TABLE)
      .select('secret')
      .eq('partnership_id', partnershipId)
      .eq('enabled', true)
      .maybeSingle()
    if (error) {
      console.error('Partner Apps Script secret lookup failed')
      return null
    }
    return typeof data?.secret === 'string' && data.secret.length >= 32 ? data.secret : null
  } catch {
    console.error('Partner Apps Script secret lookup failed')
    return null
  }
}
