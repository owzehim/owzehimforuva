// PERF-04: pure helpers for reward-claim Sheet rows (tested with node --test).

// After this many failed attempts (about a day with the backoff below) the
// retry job reports failure, so the workflow opens a GitHub issue.
export const REWARD_CLAIM_ALERT_ATTEMPTS = 8

const FIFTEEN_MINUTES = 15 * 60 * 1000
const ONE_DAY = 24 * 60 * 60 * 1000

/** 15 min, 30 min, 1 h, 2 h ... capped at one day. */
export function nextAttemptDelayMs(attempts) {
  const step = Math.max(1, Number(attempts) || 1)
  return Math.min(FIFTEEN_MINUTES * 2 ** (step - 1), ONE_DAY)
}

export function buildRewardClaimPayloads({ storeId, sheetName, redemptionId, claimedAt }) {
  const date = claimedAt.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' })
  const time = claimedAt.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
  })
  const master = {
    type: 'stamp_claim',
    partnership_id: storeId,
    sheet_name: sheetName,
    redemption_id: String(redemptionId),
    stamp_status: 'claimed',
    claimed_at_date: date,
    claimed_at_time: time,
  }
  // GDPR-20: partners receive the claim date only; the time stays in the
  // association's Master Sheet.
  const partner = { ...master }
  delete partner.claimed_at_time
  return { master, partner }
}
