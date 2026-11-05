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

// OPS-11: admin functions write the audit entry BEFORE changing anything and
// stop if that write fails, so no admin change happens without a record.
export const AUDIT_UNAVAILABLE_MESSAGE =
  '관리자 작업 기록을 저장하지 못해 변경하지 않았습니다. 잠시 후 다시 시도해 주세요.'

type AuditEntry = Parameters<typeof recordAdminAction>[1]

/** Best-effort follow-up when a change fails after its audit entry was written. */
export async function recordAdminActionFailure(client: any, entry: AuditEntry) {
  return recordAdminAction(client, { ...entry, action: `${entry.action}.failed` })
}
