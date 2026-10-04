import { supabase } from './supabase'

/**
 * admin_roles is the canonical admin allowlist. The table's RLS policy only
 * lets an authenticated user read their own row; callers fail closed on error.
 */
export async function hasAdminRole(userId) {
  if (!userId) return false

  try {
    const { data, error } = await supabase
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.warn('Admin role check failed:', error.message)
      return false
    }

    return Boolean(data)
  } catch (error) {
    console.warn('Admin role check failed:', error)
    return false
  }
}
