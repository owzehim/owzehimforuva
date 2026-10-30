// Call only with the user independently verified by Auth. The service-only RPC
// owns the old/new association; never accept an old account ID from a client.
export async function finalizePendingEmail(admin, user, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!user?.id || !user.email || !user.email_confirmed_at) {
    throw new Error('Confirmed account required')
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const { data: changes, error } = await admin.rpc('complete_pending_email_change', {
        p_new_user_id: user.id,
        p_confirmed_email: user.email,
      })
      if (error) throw error
      const change = Array.isArray(changes) ? changes[0] : null
      if (!change) return { changed: false }
      if (!change.old_user_id || change.old_user_id === user.id || change.state !== 'transferred') {
        throw new Error('Invalid pending email association')
      }

      const { data: oldAccount, error: lookupError } = await admin.auth.admin.getUserById(change.old_user_id)
      if (lookupError && lookupError.status !== 404) throw lookupError
      if (oldAccount?.user) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(change.old_user_id)
        if (deleteError && deleteError.status !== 404) throw deleteError
      }
      // Keep the mapping (and original signup timestamp) until the caller has
      // saved consent receipts. A retry can safely encounter an absent old user.
      return { changed: true }
    } catch (error) {
      const status = error?.status
      if (attempt >= 2 || (status && status !== 429 && status < 500)) throw error
      await wait(200 * (attempt + 1))
    }
  }
}

// The existing retention job retries interrupted transfers even if the member
// never reopens the confirmation screen. Leave receipt cleanup to registration.
export async function retryPendingEmailCleanup(admin) {
  const { data: mappings, error } = await admin.from('pending_email_changes')
    .select('new_user_id').eq('state', 'transferred').order('created_at').limit(100)
  if (error) throw error
  let failed = 0
  let completed = 0
  for (const mapping of mappings || []) {
    try {
      const { data, error: userError } = await admin.auth.admin.getUserById(mapping.new_user_id)
      if (userError || !data?.user?.email_confirmed_at) throw userError || new Error('Confirmed account unavailable')
      const result = await finalizePendingEmail(admin, data.user)
      if (!result.changed) throw new Error('Confirmed email no longer matches transfer')
      // While registration metadata exists, this mapping is the authoritative
      // source of the original consent timestamp, even if the old Auth user is gone.
      if (!data.user.user_metadata?.registration) {
        const { error: cleanupError } = await admin.from('pending_email_changes')
          .delete().eq('new_user_id', data.user.id).eq('state', 'transferred')
        if (cleanupError) throw cleanupError
      }
      completed++
    } catch {
      failed++
    }
  }
  return { completed, failed }
}
