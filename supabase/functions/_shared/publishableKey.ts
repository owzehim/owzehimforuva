/** Read only the current, named default publishable key. */
export function getSupabasePublishableKey() {
  try {
    const rawPublishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}'
    const publishableKeys: unknown = JSON.parse(rawPublishableKeys)

    if (
      publishableKeys &&
      typeof publishableKeys === 'object' &&
      !Array.isArray(publishableKeys)
    ) {
      const key = (publishableKeys as Record<string, unknown>).default
      if (typeof key === 'string' && key.trim()) return key
    }
  } catch {
    // Missing or malformed new-key configuration fails closed below.
  }

  return ''
}
