export const CURRENT_LEGAL_DOCUMENT_VERSION = '2026-06-29'

const DOCUMENT_KEYS = ['terms', 'privacy', 'community']

export function getConsentAcceptedAt(authUser, preservedServerTimestamp = null) {
  if (typeof preservedServerTimestamp === 'string' && Number.isFinite(Date.parse(preservedServerTimestamp))) {
    return new Date(preservedServerTimestamp).toISOString()
  }
  if (typeof authUser?.created_at === 'string' && Number.isFinite(Date.parse(authUser.created_at))) {
    return new Date(authUser.created_at).toISOString()
  }
  return new Date().toISOString()
}

export function getConsentReceiptRows(userId, registration, acceptedAt) {
  if (!userId || !registration || typeof registration !== 'object' || Array.isArray(registration)) {
    return null
  }

  let versions = registration.legal_documents
  // Older app builds required all three checkboxes before submitting and sent
  // one shared version under privacy_policy_version. Keep those pending email
  // confirmations completable without fabricating a different version.
  if ((!versions || typeof versions !== 'object') && registration.privacy_policy_version === CURRENT_LEGAL_DOCUMENT_VERSION) {
    versions = Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, CURRENT_LEGAL_DOCUMENT_VERSION]))
  }

  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return null
  if (!DOCUMENT_KEYS.every((key) => versions[key] === CURRENT_LEGAL_DOCUMENT_VERSION)) return null
  if (registration.privacy_policy_version !== versions.privacy) return null

  return DOCUMENT_KEYS.map((documentKey) => ({
    user_id: userId,
    document_key: documentKey,
    document_version: versions[documentKey],
    accepted_at: acceptedAt,
  }))
}
