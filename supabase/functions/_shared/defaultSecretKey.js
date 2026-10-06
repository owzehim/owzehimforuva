/** Parse Supabase's named secret-key map and return only the configured default. */
export function getDefaultSecretKey(rawSecretKeys) {
  if (typeof rawSecretKeys !== 'string' || rawSecretKeys.length === 0) return ''

  try {
    const secretKeys = JSON.parse(rawSecretKeys)
    if (!secretKeys || typeof secretKeys !== 'object' || Array.isArray(secretKeys)) return ''

    const key = secretKeys.default
    return typeof key === 'string' && key.trim() ? key : ''
  } catch {
    return ''
  }
}
