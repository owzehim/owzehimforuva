/** Read only the current, named default secret key; never fall back to service_role. */
export function getSupabaseServiceKey() {
  try {
    const rawSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'
    const secretKeys: unknown = JSON.parse(rawSecretKeys)

    if (secretKeys && typeof secretKeys === 'object' && !Array.isArray(secretKeys)) {
      const key = (secretKeys as Record<string, unknown>).default
      if (typeof key === 'string' && key.trim()) return key
    }
  } catch {
    // Missing or malformed new-key configuration fails closed below.
  }

  return ''
}
