import { getDefaultSecretKey } from './defaultSecretKey.js'

/** Read only the current, named default secret key; never fall back to service_role. */
export function getSupabaseServiceKey() {
  return getDefaultSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
}
