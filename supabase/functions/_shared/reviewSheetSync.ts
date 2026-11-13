// FUNC-14: Google Sheets rows for a review, written with a durable retry queue
// (public.review_sheet_queue), like check-ins (checkinSheetSync.ts).
//
// The queue keeps only the check-in number and the store. The review is read
// from the database when it is sent; if it is gone by then, the row is dropped.
// The Master sheet adds the review to the check-in's row, so a review sent
// before that row exists fails and is simply retried after it arrives.
import { getPartnerAppsScriptSecret } from './partnerAppsScriptSecret.js'
import { buildReviewSheetPayloads } from './reviewSheetPayload.js'
import { postToAppsScript, type SheetSendResult, type SheetTarget } from './appsScriptPost.ts'
import { retryDueSheetQueueRows, sendSheetQueueRows } from './sheetQueue.ts'

const QUEUE_TABLE = 'review_sheet_queue'
const QUEUE_COLUMNS = 'id, redemption_id, target, store_id, attempts'
const SHEET_TARGETS: SheetTarget[] = ['master', 'partner']

type QueueRow = {
  id: number
  redemption_id: number | string
  target: SheetTarget
  store_id: string
  attempts: number
}

async function sendQueueRow(admin: any, row: QueueRow): Promise<SheetSendResult> {
  const [reviewResult, partnershipResult, integrationsResult, placeResult] = await Promise.all([
    admin.from('reviews').select('rating, tags, created_at, store_id').eq('redemption_id', String(row.redemption_id)).maybeSingle(),
    admin.from('partnerships').select('name, sheet_name').eq('id', row.store_id).maybeSingle(),
    admin.from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', row.store_id)
      .maybeSingle(),
    // The place's own 멤버 평가 names (default: the restaurant criteria).
    admin.from('restaurants')
      .select('review_criteria')
      .eq('partnership_id', row.store_id)
      .order('is_archived', { ascending: true })
      .limit(1),
  ])
  if (reviewResult.error || partnershipResult.error || integrationsResult.error) {
    return { ok: false, errorCode: 'config_lookup' }
  }
  const review = reviewResult.data
  if (!review || review.store_id !== row.store_id) return { ok: false, drop: true }
  if (placeResult.error) console.warn('Review criteria lookup failed; using default names')

  const payloads = buildReviewSheetPayloads({
    storeId: row.store_id,
    partnership: partnershipResult.data,
    redemptionId: String(row.redemption_id),
    review,
    placeCriteria: placeResult.data?.[0]?.review_criteria ?? null,
  })
  const integrations = integrationsResult.data

  if (row.target === 'partner') {
    return postToAppsScript(
      integrations?.partner_apps_script_url,
      'partner',
      payloads.partner,
      await getPartnerAppsScriptSecret(admin, row.store_id),
    )
  }
  return postToAppsScript(integrations?.master_apps_script_url, 'master', payloads.master)
}

/**
 * Queue a review's Sheet rows (Master and partner) and send them once.
 * Returns how many rows are still queued after that first try (0 = sent).
 * An edited review is queued again; the Sheets update rows by check-in number.
 */
export async function queueAndSendReviewSheetRows(admin: any, review: { redemptionId: string | number, storeId: string }) {
  const redemptionId = Number(review.redemptionId)
  const rows = SHEET_TARGETS.map((target) => ({ redemption_id: redemptionId, target, store_id: review.storeId }))
  const { error: queueError } = await admin
    .from(QUEUE_TABLE)
    .upsert(rows, { onConflict: 'redemption_id,target', ignoreDuplicates: true })
  if (queueError) {
    console.error('Review could not be queued for Google Sheets')
    return { queued: false, pending: SHEET_TARGETS.length }
  }
  const { data, error } = await admin.from(QUEUE_TABLE).select(QUEUE_COLUMNS).eq('redemption_id', redemptionId)
  if (error) {
    console.error('Queued review rows could not be read; the retry job will send them')
    return { queued: true, pending: SHEET_TARGETS.length }
  }
  await sendSheetQueueRows(admin, QUEUE_TABLE, (data || []) as QueueRow[], (row) => sendQueueRow(admin, row))
  const { count } = await admin
    .from(QUEUE_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('redemption_id', redemptionId)
  return { queued: true, pending: count ?? 0 }
}

/** Re-send queued review Sheet rows that are due. */
export function retryReviewSheetRows(admin: any, options: { limit?: number, deadline?: number } = {}) {
  return retryDueSheetQueueRows<QueueRow>(admin, QUEUE_TABLE, QUEUE_COLUMNS, (row) => sendQueueRow(admin, row), options)
}
