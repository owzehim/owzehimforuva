import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const atomicMigration = read('../supabase/migrations/20261005020000_sec14_atomic_stamp_writes.sql')
const redemptionMigration = read('../supabase/migrations/20261004250000_restrict_stamp_card_client_writes.sql')
const logRedemption = read('../supabase/functions/log-redemption/index.ts')
const adminAddStamp = read('../supabase/functions/admin-add-stamp/index.ts')

test('stamp visit and reward-cycle writes serialize and enforce Amsterdam calendar days', () => {
  assert.match(atomicMigration, /CREATE UNIQUE INDEX stamp_card_visits_member_daily_unique[\s\S]*user_id,[\s\S]*restaurant_id,[\s\S]*visited_at AT TIME ZONE 'Europe\/Amsterdam'/i)
  assert.match(atomicMigration, /CREATE OR REPLACE FUNCTION public\.record_member_stamp_visit[\s\S]*pg_advisory_xact_lock[\s\S]*Europe\/Amsterdam/i)
  assert.match(atomicMigration, /CREATE OR REPLACE FUNCTION public\.admin_add_stamp_card_visit[\s\S]*pg_advisory_xact_lock/i)
  assert.match(atomicMigration, /ON CONFLICT \(user_id, restaurant_id, card_cycle\) DO NOTHING/i)
})

test('redemption window claims serialize and keep the fifteen-minute reuse window server-side', () => {
  assert.match(redemptionMigration, /CREATE OR REPLACE FUNCTION public\.claim_redemption_window[\s\S]*pg_advisory_xact_lock[\s\S]*interval '15 minutes'/i)
  assert.match(redemptionMigration, /GRANT EXECUTE ON FUNCTION public\.claim_redemption_window\(uuid, text\)\s+TO service_role/i)
  assert.match(logRedemption, /admin\.rpc\(\s*'record_member_stamp_visit'/i)
  assert.match(logRedemption, /admin\.rpc\([\s\S]*?'claim_redemption_window'/i)
  assert.doesNotMatch(logRedemption, /\.from\('stamp_card_visits'\)[\s\S]*?\.insert\(/i)
  assert.doesNotMatch(logRedemption, /\.from\('redemptions'\)[\s\S]*?\.insert\(/i)
  assert.match(adminAddStamp, /admin\.rpc\(\s*'admin_add_stamp_card_visit'/i)
})
