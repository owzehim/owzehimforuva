export async function recordAdminAction(
  client: any,
  entry: {
    actorId: string
    action: string
    resourceType: string
    resourceId?: string | null
    changedFields?: string[]
  },
) {
  const { error } = await client.from('admin_action_audit').insert({
    actor_id: entry.actorId,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    changed_fields: entry.changedFields ?? [],
  })

  if (error) {
    console.error('Admin audit log insert failed:', error.message || 'unknown database error')
    return false
  }

  return true
}
