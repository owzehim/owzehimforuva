// PERF-04: Google Sheets rows for a used stamp-card reward, written in the
// background with a durable retry queue (public.reward_claim_sheet_queue).
import { sheetText } from './sheetText.js'
import { getPartnerAppsScriptSecret } from './partnerAppsScriptSecret.js'
import { buildRewardClaimPayloads, REWARD_CLAIM_ALERT_ATTEMPTS } from './rewardClaimPayload.js'
import { postToAppsScript, type SheetSendResult, type SheetTarget } from './appsScriptPost.ts'
import { retryDueSheetQueueRows, sendSheetQueueRows } from './sheetQueue.ts'

export { REWARD_CLAIM_ALERT_ATTEMPTS }

const QUEUE_TABLE = 'reward_claim_sheet_queue'
const QUEUE_COLUMNS = 'id, reward_id, target, store_id, redemption_id, claimed_at, attempts'
const SHEET_TARGETS: SheetTarget[] = ['master', 'partner']

type QueueRow = {
  id: number
  reward_id: string
  target: SheetTarget
  store_id: string
  redemption_id: number | string
  claimed_at: string
  attempts: number
}

async function sendQueueRow(admin: any, row: QueueRow): Promise<SheetSendResult> {
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
    .select(QUEUE_COLUMNS)
  if (error) {
    console.error('Reward claim could not be queued for Google Sheets')
    return { queued: false, sending: Promise.resolve() }
  }
  const sending = sendSheetQueueRows(admin, QUEUE_TABLE, (data || []) as QueueRow[], (row) => sendQueueRow(admin, row))
  return { queued: true, sending }
}

/** Re-send queued reward-claim Sheet rows that are due. */
export function retryRewardClaimSheetRows(admin: any, options: { limit?: number, deadline?: number } = {}) {
  return retryDueSheetQueueRows<QueueRow>(admin, QUEUE_TABLE, QUEUE_COLUMNS, (row) => sendQueueRow(admin, row), options)
}
