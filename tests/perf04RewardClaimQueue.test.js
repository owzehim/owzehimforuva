import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildRewardClaimPayloads,
  nextAttemptDelayMs,
  REWARD_CLAIM_ALERT_ATTEMPTS,
} from '../supabase/functions/_shared/rewardClaimPayload.js'

test('PERF-04: claim payloads keep the time in the Master Sheet only (GDPR-20)', () => {
  const { master, partner } = buildRewardClaimPayloads({
    storeId: 'store-1', sheetName: 'Shop', redemptionId: 42, claimedAt: new Date('2026-11-10T11:05:00Z'),
  })
  assert.equal(master.claimed_at_date, '10/11/2026')
  assert.equal(master.claimed_at_time, '12:05')
  assert.equal(master.redemption_id, '42')
  assert.equal(partner.claimed_at_time, undefined)
  assert.equal(partner.claimed_at_date, '10/11/2026')
})

test('PERF-04: retries back off from 15 minutes up to one day', () => {
  assert.equal(nextAttemptDelayMs(1), 15 * 60 * 1000)
  assert.equal(nextAttemptDelayMs(2), 30 * 60 * 1000)
  assert.equal(nextAttemptDelayMs(20), 24 * 60 * 60 * 1000)
  let total = 0
  for (let attempt = 1; attempt < REWARD_CLAIM_ALERT_ATTEMPTS; attempt += 1) total += nextAttemptDelayMs(attempt)
  assert.ok(total >= 24 * 60 * 60 * 1000 && total <= 48 * 60 * 60 * 1000, 'alert after roughly a day')
})

test('PERF-04: using a reward does not wait for Google Sheets', async () => {
  const source = await readFile('supabase/functions/redeem-stamp-card-reward/index.ts', 'utf8')
  assert.match(source, /queueRewardClaimSheetRows/)
  assert.match(source, /edgeRuntime\.waitUntil\(sending\)/)
  assert.ok(!source.includes('syncClaimToAppsScript'))
  const scanBox = await readFile('src/features/stampCard/components/ScanPageStampBox.jsx', 'utf8')
  assert.ok(!scanBox.includes('동기화에 실패'))
})

test('PERF-04: queue table is server-only and retried every 15 minutes', async () => {
  const sql = await readFile('supabase/migrations/20261110110000_perf04_reward_claim_sheet_queue.sql', 'utf8')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.reward_claim_sheet_queue FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /ON DELETE CASCADE/)
  const workflow = await readFile('.github/workflows/sheet-sync-retry.yml', 'utf8')
  assert.match(workflow, /cron: '\*\/15 \* \* \* \*'/)
  assert.match(workflow, /"task":"sheet_retry"/)
  const job = await readFile('supabase/functions/privacy-retention-sync/index.ts', 'utf8')
  assert.match(job, /requestBody\?\.task === 'sheet_retry'/)
})

const checkin = await import('../supabase/functions/_shared/checkinSheetPayload.js')

test('PERF-04 check-ins: queued stamp columns hold no personal data', () => {
  const stamp = checkin.stampColumns({ enabled: true, newCount: 3, totalStamps: 10, claimedAfterScan: false })
  assert.deepEqual(stamp, { stamp_status: '', stamp_progress: '3/10', stamp_card_claimed_after_scan: false })
  assert.deepEqual(checkin.stampColumns({ enabled: false }), { stamp_status: '', stamp_progress: '', stamp_card_claimed_after_scan: false })
  assert.equal(checkin.formatStampStatus({ enabled: true, rewardPending: true }), 'reward pending')
})

test('PERF-04 check-ins: rebuilt rows match the original Sheet format', () => {
  const base = {
    storeId: 'store-1',
    partnership: { name: 'Shop', sheet_name: '=Shop' },
    redemptionId: 7,
    redeemedAt: new Date('2026-11-10T11:05:00Z'),
    stamp: { stamp_status: 'ready to claim', stamp_progress: '10/10', stamp_card_claimed_after_scan: true },
  }
  const partner = checkin.buildCheckinPartnerPayload(base)
  assert.equal(partner.type, 'store')
  assert.equal(partner.date, '10/11/2026')
  assert.equal(partner.sheet_name, "'=Shop", 'formula-looking text is escaped')
  assert.equal(partner.stamp_card_claimed_after_scan, 'Yes')
  assert.equal(partner.first_name, undefined, 'partner rows carry no member identifiers')
  const member = {
    first_name: 'Kim', last_name: 'Lee', student_number: '12345678', University: 'UvA', major: 'Law',
    education_level: 'bachelor', year_number: 2, gender: 'female', year_of_birth: 2004,
    country_of_origin: 'KR', account_status: null,
  }
  const master = checkin.buildCheckinMasterPayload({ ...base, userId: 'u1', member })
  assert.equal(master.type, 'master')
  assert.equal(master.time, '12:05')
  assert.equal(master.user_id, 'u1', 'rows are matched by the random account code')
  // GDPR-14 (option A): no identity or demographics in the Master sheet.
  for (const field of checkin.MASTER_IDENTITY_FIELDS) {
    assert.equal(master[field], '', `${field} is sent empty`)
  }
  assert.ok(!JSON.stringify(master).includes('12345678'))
  assert.equal(master.account_status, 'active')
  assert.equal(master.stamp_card_progress, '10/10')
})

test('PERF-04 check-ins: log-redemption queues its Sheet rows and the retry job covers them', async () => {
  const source = await readFile('supabase/functions/log-redemption/index.ts', 'utf8')
  assert.match(source, /queueCheckinSheetRows/)
  assert.ok(!source.includes('postJsonToAppsScript'))
  const sync = await readFile('supabase/functions/_shared/checkinSheetSync.ts', 'utf8')
  assert.match(sync, /if \(!redemption\.user_id\) return \{ ok: false, drop: true \}/, 'no Master row once the account is gone')
  const sql = await readFile('supabase/migrations/20261110120000_perf04_checkin_sheet_queue.sql', 'utf8')
  assert.match(sql, /REVOKE ALL ON TABLE public\.checkin_sheet_queue FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /REFERENCES public\.redemptions\(id\) ON DELETE CASCADE/)
  const job = await readFile('supabase/functions/privacy-retention-sync/index.ts', 'utf8')
  assert.match(job, /retryCheckinSheetRows\(admin, \{ limit: 20, deadline: startedAt \+ 45_000 \}\)/)
})

test('GDPR-14: the Master sheet never receives the free-text review comment', async () => {
  const source = await readFile('supabase/functions/sync-to-sheets/index.ts', 'utf8')
  assert.match(source, /comment: '',/)
  assert.ok(!source.includes('sheetText(review.comment'))
})
