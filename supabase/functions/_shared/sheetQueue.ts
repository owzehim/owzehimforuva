// PERF-04: shared retry-queue handling for Google Sheets rows
// (reward_claim_sheet_queue, checkin_sheet_queue).
import type { SheetSendResult } from './appsScriptPost.ts'
import { nextAttemptDelayMs, REWARD_CLAIM_ALERT_ATTEMPTS } from './rewardClaimPayload.js'

export const SHEET_RETRY_ALERT_ATTEMPTS = REWARD_CLAIM_ALERT_ATTEMPTS

type QueueRow = { id: number, attempts: number }

/** Remove a row once the Sheet confirmed it (or it must not be sent); otherwise back off. */
export async function settleSheetQueueRow(admin: any, table: string, row: QueueRow, result: SheetSendResult) {
  if (result.ok || result.skipped || result.drop) {
    const { error } = await admin.from(table).delete().eq('id', row.id)
    if (error) console.error(`${table} row could not be cleared`)
    return
  }
  const attempts = (row.attempts || 0) + 1
  const { error } = await admin.from(table).update({
    attempts,
    next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(attempts)).toISOString(),
    last_error: String(result.errorCode || 'unknown').slice(0, 60),
  }).eq('id', row.id)
  if (error) console.error(`${table} row could not be updated`)
}

/** Send every row of this batch, never throwing; failures stay queued. */
export function sendSheetQueueRows<T extends QueueRow>(
  admin: any,
  table: string,
  rows: T[],
  send: (row: T) => Promise<SheetSendResult>,
) {
  return Promise.all(rows.map(async (row) => {
    try {
      await settleSheetQueueRow(admin, table, row, await send(row))
    } catch {
      console.error(`${table} Sheet write failed; it stays queued`)
    }
  })).then(() => undefined)
}

/** Re-send due rows of one queue. Used by the sheet retry job. */
export async function retryDueSheetQueueRows<T extends QueueRow>(
  admin: any,
  table: string,
  columns: string,
  send: (row: T) => Promise<SheetSendResult>,
  { limit = 50, deadline = Number.POSITIVE_INFINITY }: { limit?: number, deadline?: number } = {},
) {
  const { data, error } = await admin
    .from(table)
    .select(columns)
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`${table} lookup failed`)

  let synced = 0
  let failed = 0
  for (const row of (data || []) as T[]) {
    // Stay inside the caller's time budget; the rest waits for the next run.
    if (Date.now() >= deadline) break
    const result: SheetSendResult = await send(row).catch(() => ({ ok: false, errorCode: 'unexpected' }))
    await settleSheetQueueRow(admin, table, row, result)
    if (result.ok || result.skipped || result.drop) synced += 1
    else failed += 1
  }

  const { count: stuck, error: stuckError } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte('attempts', SHEET_RETRY_ALERT_ATTEMPTS)
  if (stuckError) throw new Error(`${table} count failed`)

  return { attempted: synced + failed, synced, failed, stuck: stuck || 0 }
}
