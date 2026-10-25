const REQUIRED_DOCUMENTS = ['terms', 'privacy', 'community']

export function hasCurrentLegalConsent(receipts, requiredVersion) {
  const accepted = new Set(
    (Array.isArray(receipts) ? receipts : [])
      .filter((receipt) => receipt?.document_version === requiredVersion)
      .map((receipt) => receipt.document_key),
  )

  return REQUIRED_DOCUMENTS.every((documentKey) => accepted.has(documentKey))
}

export function getRequiredLegalDocuments() {
  return [...REQUIRED_DOCUMENTS]
}
