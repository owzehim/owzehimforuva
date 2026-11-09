// PERF-04: Google Sheets rows for a check-in, written in the background with a
// durable retry queue (public.checkin_sheet_queue).
//
// The queue keeps only the check-in number, the store and the stamp columns
// from the moment of the scan. The Master row (names, student number, ...) is
// rebuilt from the database when it is sent; if the member's account is gone
// by then, the Master row is dropped and nothing personal is re-sent. The
// partner row has no member identifiers.
import { getPartnerAppsScriptSecret } from './partnerAppsScriptSecret.js'
import { buildCheckinMasterPayload, buildCheckinPartnerPayload, stampColumns } from './checkinSheetPayload.js'
import { postToAppsScript, type SheetSendResult, type SheetTarget } from './appsScriptPost.ts'
import { retryDueSheetQueueRows, sendSheetQueueRows } from './sheetQueue.ts'

const QUEUE_TABLE = 'checkin_sheet_queue'
const QUEUE_COLUMNS = 'id, redemption_id, target, store_id, stamp_status, stamp_progress, stamp_card_claimed_after_scan, attempts'
const SHEET_TARGETS: SheetTarget[] = ['master', 'partner']
const MEMBER_COLUMNS =
  'first_name, last_name, first_name_korean, last_name_korean, University, student_number, major, education_level, year_number, year_of_birth, country_of_origin, gender, membership_valid_until, membership_ended_at, identity_anonymized_at, account_status'

type QueueRow = {
  id: number
  redemption_id: number | string
  target: SheetTarget
  store_id: string
  stamp_status: string
  stamp_progress: string
  stamp_card_claimed_after_scan: boolean
  attempts: number
}

async function sendQueueRow(admin: any, row: QueueRow): Promise<SheetSendResult> {
  const [redemptionResult, partnershipResult, integrationsResult] = await Promise.all([
    admin.from('redemptions').select('user_id, store_id, redeemed_at').eq('id', String(row.redemption_id)).maybeSingle(),
    admin.from('partnerships').select('name, sheet_name').eq('id', row.store_id).maybeSingle(),
    admin.from('partnership_integrations')
      .select('master_apps_script_url, partner_apps_script_url')
      .eq('partnership_id', row.store_id)
      .maybeSingle(),
  ])
  if (redemptionResult.error || partnershipResult.error || integrationsResult.error) {
    return { ok: false, errorCode: 'config_lookup' }
  }
  const redemption = redemptionResult.data
  if (!redemption?.redeemed_at || redemption.store_id !== row.store_id) return { ok: false, drop: true }

  const base = {
    storeId: row.store_id,
    partnership: partnershipResult.data,
    redemptionId: String(row.redemption_id),
    redeemedAt: new Date(redemption.redeemed_at),
    stamp: row,
  }
  const integrations = integrationsResult.data

  if (row.target === 'partner') {
    return postToAppsScript(
      integrations?.partner_apps_script_url,
      'partner',
      buildCheckinPartnerPayload(base),
      await getPartnerAppsScriptSecret(admin, row.store_id),
    )
  }

  // Master row: only while the member's account still exists.
  if (!redemption.user_id) return { ok: false, drop: true }
  const { data: member, error: memberError } = await admin
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('user_id', redemption.user_id)
    .maybeSingle()
  if (memberError) return { ok: false, errorCode: 'member_lookup' }
  if (!member) return { ok: false, drop: true }
  return postToAppsScript(
    integrations?.master_apps_script_url,
    'master',
    buildCheckinMasterPayload({ ...base, userId: redemption.user_id, member }),
  )
}

/**
 * Queue the Sheet rows for a check-in (awaited: quick database write) and
 * return `sending`, the first attempt, for EdgeRuntime.waitUntil. A repeat
 * scan of the same check-in sends whatever is still queued (or queues it again
 * if it already went through; the Sheets update rows by check-in number).
 */
export async function queueCheckinSheetRows(
  admin: any,
  checkin: { redemptionId: string | number, storeId: string, stampResult: unknown },
) {
  const stamp = stampColumns(checkin.stampResult)
  const rows = SHEET_TARGETS.map((target) => ({
    redemption_id: Number(checkin.redemptionId),
    target,
    store_id: checkin.storeId,
    ...stamp,
  }))
  const { error: queueError } = await admin
    .from(QUEUE_TABLE)
    .upsert(rows, { onConflict: 'redemption_id,target', ignoreDuplicates: true })
  if (queueError) {
    console.error('Check-in could not be queued for Google Sheets')
    return { queued: false, sending: Promise.resolve() }
  }
  const { data, error } = await admin
    .from(QUEUE_TABLE)
    .select(QUEUE_COLUMNS)
    .eq('redemption_id', Number(checkin.redemptionId))
  if (error) {
    console.error('Queued check-in rows could not be read; the retry job will send them')
    return { queued: true, sending: Promise.resolve() }
  }
  const sending = sendSheetQueueRows(admin, QUEUE_TABLE, (data || []) as QueueRow[], (row) => sendQueueRow(admin, row))
  return { queued: true, sending }
}

/** Re-send queued check-in Sheet rows that are due. */
export function retryCheckinSheetRows(admin: any, options: { limit?: number, deadline?: number } = {}) {
  return retryDueSheetQueueRows<QueueRow>(admin, QUEUE_TABLE, QUEUE_COLUMNS, (row) => sendQueueRow(admin, row), options)
}
