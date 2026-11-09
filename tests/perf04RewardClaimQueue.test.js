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
