// PERF-04: Google Sheets rows for a used stamp-card reward, written in the
// background with a durable retry queue (public.reward_claim_sheet_queue).
import { sheetText } from './sheetText.js'
import { getAllowedAppsScriptUrl, withAppsScriptSecret } from './appsScriptAuth.js'
import { getPartnerAppsScriptSecret } from './partnerAppsScriptSecret.js'
import { buildRewardClaimPayloads, nextAttemptDelayMs, REWARD_CLAIM_ALERT_ATTEMPTS } from './rewardClaimPayload.js'

export { REWARD_CLAIM_ALERT_ATTEMPTS }

const QUEUE_TABLE = 'reward_claim_sheet_queue'
const SHEET_TARGETS = ['master', 'partner'] as const
type SheetTarget = typeof SHEET_TARGETS[number]

type SendResult = { ok: boolean, skipped?: boolean, errorCode?: string }

async function postToAppsScript(
  url: string | null | undefined,
  target: SheetTarget,
  payload: Record<string, unknown>,
  secret?: string | null,
): Promise<SendResult> {
  // A Sheet that is intentionally not connected (no URL) is not a failure (FUNC-09).
  if (!url) return { ok: false, skipped: true }
  const endpoint = getAllowedAppsScriptUrl(url)
  if (!endpoint) return { ok: false, errorCode: 'invalid_endpoint' }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(withAppsScriptSecret(
        payload,
        target === 'master' ? Deno.env.get('MASTER_APPS_SCRIPT_SECRET') : secret,
      )),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) return { ok: false, errorCode: `http_${response.status}` }
    try {
      const result = text ? JSON.parse(text) : null
      // HTTP 200 alone does not prove Apps Script applied the Sheet update.
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.success !== true) {
        return { ok: false, errorCode: 'script_rejected' }
      }
    } catch {
      return { ok: false, errorCode: 'invalid_response' }
    }
    return { ok: true }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, errorCode: 'timeout' }
    if (error instanceof Error && error.message.includes('secret')) return { ok: false, errorCode: 'secret_missing' }
    return { ok: false, errorCode: 'network' }
  } finally {
    clearTimeout(timeoutId)
  }
}

type QueueRow = {
  id: number
  reward_id: string
  target: SheetTarget
  store_id: string
  redemption_id: number | string
  claimed_at: string
  attempts: number
}

async function sendQueueRow(admin: any, row: QueueRow): Promise<SendResult> {
  const [{ data: partnership, error: partnershipError }, { data: integrations, error: integrationsError }] =
    await Promise.all([
      admin.from('partnerships').select('name, sheet_name').eq('id', row.store_id).maybeSingle(),
      admin.from('partnership_integrations')
        .select('master_apps_script_url, partner_apps_script_url')
        .eq('partnership_id', row.store_id)
        .maybeSingle(),
    ])
  if (partnershipError || integrationsError) return { ok: false, errorCode: 'config_lookup' }

  const { master, partner } = buildRewardClaimPayloads({
    storeId: row.store_id,
    sheetName: sheetText(partnership?.sheet_name || partnership?.name || row.store_id, 160),
    redemptionId: String(row.redemption_id),
    claimedAt: new Date(row.claimed_at),
  })
  if (row.target === 'master') {
    return postToAppsScript(integrations?.master_apps_script_url, 'master', master)
  }
  return postToAppsScript(
    integrations?.partner_apps_script_url,
    'partner',
    partner,
    await getPartnerAppsScriptSecret(admin, row.store_id),
  )
}

async function settleQueueRow(admin: any, row: QueueRow, result: SendResult) {
  if (result.ok || result.skipped) {
    const { error } = await admin.from(QUEUE_TABLE).delete().eq('id', row.id)
    if (error) console.error('Reward claim queue row could not be cleared')
    return
  }
  const attempts = (row.attempts || 0) + 1
  const { error } = await admin.from(QUEUE_TABLE).update({
    attempts,
    next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(attempts)).toISOString(),
    last_error: String(result.errorCode || 'unknown').slice(0, 60),
  }).eq('id', row.id)
  if (error) console.error('Reward claim queue row could not be updated')
}

/**
 * Queue the Sheet rows for a used reward (awaited: quick database write), and
 * return `sending`, the first send attempt, for EdgeRuntime.waitUntil so
 * staff do not wait for Google Sheets.
 */
export async function queueRewardClaimSheetRows(
  admin: any,
  claim: { rewardId: string, storeId: string, redemptionId: string | number, claimedAt: Date },
) {
  const rows = SHEET_TARGETS.map((target) => ({
    reward_id: claim.rewardId,
    target,
    store_id: claim.storeId,
    redemption_id: Number(claim.redemptionId),
    claimed_at: claim.claimedAt.toISOString(),
  }))
  const { data, error } = await admin
    .from(QUEUE_TABLE)
    .upsert(rows, { onConflict: 'reward_id,target', ignoreDuplicates: true })
    .select('id, reward_id, target, store_id, redemption_id, claimed_at, attempts')
  if (error) {
    console.error('Reward claim could not be queued for Google Sheets')
    return { queued: false, sending: Promise.resolve() }
  }
  const sending = Promise.all((data || []).map(async (row: QueueRow) => {
    try {
      await settleQueueRow(admin, row, await sendQueueRow(admin, row))
    } catch {
      console.error('Reward claim Sheet write failed; it stays queued')
    }
  })).then(() => undefined)
  return { queued: true, sending }
}

/** Re-send queued Sheet rows that are due. Used by the sheet retry job. */
export async function retryRewardClaimSheetRows(admin: any, { limit = 50 } = {}) {
  const { data, error } = await admin
    .from(QUEUE_TABLE)
    .select('id, reward_id, target, store_id, redemption_id, claimed_at, attempts')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error('Reward claim queue lookup failed')

  let synced = 0
  let failed = 0
  for (const row of (data || []) as QueueRow[]) {
    const result = await sendQueueRow(admin, row).catch(() => ({ ok: false, errorCode: 'unexpected' }))
    await settleQueueRow(admin, row, result)
    if (result.ok || (result as SendResult).skipped) synced += 1
    else failed += 1
  }

  const { count: stuck, error: stuckError } = await admin
    .from(QUEUE_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('attempts', REWARD_CLAIM_ALERT_ATTEMPTS)
  if (stuckError) throw new Error('Reward claim queue count failed')

  return { attempted: (data || []).length, synced, failed, stuck: stuck || 0 }
}
