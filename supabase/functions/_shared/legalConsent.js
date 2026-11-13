const DOCUMENT_KEYS = ['terms', 'privacy', 'community']
export const CURRENT_LEGAL_DOCUMENT_VERSION = '2026-11-13-02'
const AGE_CONFIRMATION_DOCUMENT_KEY = 'age_16_plus'
const AGE_CONFIRMATION_DOCUMENT_VERSION = 'age-16-plus-v1'

function documentVersion(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80
    ? value.trim()
    : null
}

export function getConsentAcceptedAt(authUser, preservedServerTimestamp = null) {
  if (typeof preservedServerTimestamp === 'string' && Number.isFinite(Date.parse(preservedServerTimestamp))) {
    return new Date(preservedServerTimestamp).toISOString()
  }
  if (typeof authUser?.created_at === 'string' && Number.isFinite(Date.parse(authUser.created_at))) {
    return new Date(authUser.created_at).toISOString()
  }
  return new Date().toISOString()
}

// GDPR-21: pass currentVersion when saving. Sign-up consent is recorded only
// if the app showed the current documents; otherwise nothing is recorded for
// them and the member is asked to accept the current version after login.
/**
 * @param {string} userId
 * @param {any} registration
 * @param {string} acceptedAt
 * @param {string | null} [currentVersion]
 */
export function getConsentReceiptRows(userId, registration, acceptedAt, currentVersion = null) {
  if (!userId || !registration || typeof registration !== 'object' || Array.isArray(registration)) {
    return null
  }

  let versions = registration.legal_documents
  // Older app builds required all three checkboxes before submitting and sent
  // one shared version under privacy_policy_version. Keep those pending email
  // confirmations completable without fabricating a different version.
  const legacyPrivacyVersion = documentVersion(registration.privacy_policy_version)
  if ((!versions || typeof versions !== 'object') && legacyPrivacyVersion) {
    versions = Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, legacyPrivacyVersion]))
  }

  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return null
  const normalizedVersions = Object.fromEntries(
    DOCUMENT_KEYS.map((key) => [key, documentVersion(versions[key])]),
  )
  if (!DOCUMENT_KEYS.every((key) => normalizedVersions[key] !== null)) return null
  if (legacyPrivacyVersion !== normalizedVersions.privacy) return null

  const documentReceipts = DOCUMENT_KEYS
    .filter((documentKey) => currentVersion === null || normalizedVersions[documentKey] === currentVersion)
    .map((documentKey) => ({
      user_id: userId,
      document_key: documentKey,
      document_version: normalizedVersions[documentKey],
      accepted_at: acceptedAt,
    }))

  if (registration.age_16_plus_confirmed !== true) return documentReceipts

  return [
    ...documentReceipts,
    {
      user_id: userId,
      document_key: AGE_CONFIRMATION_DOCUMENT_KEY,
      document_version: AGE_CONFIRMATION_DOCUMENT_VERSION,
      accepted_at: acceptedAt,
    },
  ]
}
