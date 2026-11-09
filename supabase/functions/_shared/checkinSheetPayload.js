// PERF-04: pure helpers for check-in Sheet rows (tested with node --test).
// Used by log-redemption for the first send and by the retry job, so a
// re-sent row is built exactly like the original one.
import { sheetText } from './sheetText.js'

export function formatStampStatus(stampResult) {
  if (!stampResult?.enabled) return ''
  if (stampResult.rewardPending) return 'reward pending'
  if (stampResult.cycleCompleted) return 'ready to claim'
  if (stampResult.alreadyStamped) return 'already stamped today'
  return ''
}

export function formatStampProgress(stampResult) {
  if (!stampResult?.enabled) return ''
  const totalStamps = Math.max(1, Number(stampResult.totalStamps || 10))
  const count = stampResult.rewardPending || stampResult.cycleCompleted
    ? totalStamps
    : Number(stampResult.newCount ?? stampResult.currentCount ?? 0)
  return `${Math.max(0, count)}/${totalStamps}`
}

/** Stamp columns as stored in the retry queue (no personal data). */
export function stampColumns(stampResult) {
  return {
    stamp_status: formatStampStatus(stampResult),
    stamp_progress: formatStampProgress(stampResult),
    stamp_card_claimed_after_scan: stampResult?.claimedAfterScan === true,
  }
}

const safe = (value) => (value == null || value === '' ? '' : sheetText(value))

export function buildCheckinMasterPayload({ storeId, partnership, redemptionId, redeemedAt, userId, member, stamp }) {
  const date = redeemedAt.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' })
  const time = redeemedAt.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
  })
  return {
    type: 'master', date, time, redemption_id: String(redemptionId),
    restaurant_id: storeId, place_name: sheetText(partnership?.name || storeId, 160), user_id: userId,
    first_name: safe(member.first_name), last_name: safe(member.last_name),
    first_name_korean: safe(member.first_name_korean), last_name_korean: safe(member.last_name_korean),
    university: safe(member.University), student_number: safe(member.student_number),
    education_level: safe(member.education_level), year_number: member.year_number ?? '',
    major: safe(member.major), gender: safe(member.gender), year_of_birth: safe(member.year_of_birth),
    country_of_origin: safe(member.country_of_origin), star_rating: '', great_food: '',
    friendly_staff: '', nice_atmosphere: '', good_value: '', comment: '',
    stamp_status: stamp.stamp_status, stamp_progress: stamp.stamp_progress,
    stamp_card_progress: stamp.stamp_progress,
    stamp_card_claimed_after_scan: stamp.stamp_card_claimed_after_scan ? 'Yes' : 'No',
    account_status: safe(member.account_status) || 'active',
    membership_valid_until: safe(member.membership_valid_until),
    membership_ended_at: safe(member.membership_ended_at),
    identity_anonymized_at: safe(member.identity_anonymized_at),
  }
}

export function buildCheckinPartnerPayload({ storeId, partnership, redemptionId, redeemedAt, stamp }) {
  const date = redeemedAt.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' })
  return {
    type: 'store', partnership_id: storeId,
    sheet_name: sheetText(partnership?.sheet_name || partnership?.name || storeId, 160),
    date, redemption_id: String(redemptionId), place_name: sheetText(partnership?.name || storeId, 160),
    stamp_status: stamp.stamp_status, stamp_progress: stamp.stamp_progress,
    stamp_card_progress: stamp.stamp_progress,
    stamp_card_claimed_after_scan: stamp.stamp_card_claimed_after_scan ? 'Yes' : 'No',
  }
}
