// Check-IN limits: 3 different stores per member per day, admin review of
// unusual patterns (store QR codes are not secret).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const migration = read('supabase/migrations/20261112120000_checkin_daily_store_limit_and_review.sql')

test('the database refuses a 4th different store on the same day, under a per-member-per-day lock', () => {
  assert.match(migration, /hashtextextended\('checkin-day:' \|\| p_user_id::text \|\| ':' \|\| v_today::text, 0\)/)
  assert.match(migration, /IF v_other_stores >= 3 THEN\s+RAISE EXCEPTION 'daily_store_limit'/)
  // The same-store-today path returns before the limit, so a repeat scan still works.
  assert.ok(migration.indexOf('RETURN QUERY SELECT v_existing_id, false;', migration.indexOf('Do not mint another')) < migration.indexOf("RAISE EXCEPTION 'daily_store_limit'"))
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.checkin_daily_store_limit_reached\(uuid, text\) FROM PUBLIC, anon, authenticated;/)
})

test('log-redemption checks the limit before recording a stamp and shows the agreed message', () => {
  const fn = read('supabase/functions/log-redemption/index.ts')
  assert.match(fn, /const DAILY_STORE_LIMIT_MESSAGE = '오늘은 이미 매장 3곳에서 Check-IN했어요\. 내일 다시 이용해 주세요\.'/)
  assert.ok(fn.indexOf("'checkin_daily_store_limit_reached'") < fn.indexOf('recordStampCardVisit(admin, user.id, storeId)'))
  assert.match(fn, /claimError\?\.message\?\.includes\('daily_store_limit'\)\) return dailyStoreLimitResponse\(\)/)
  // The test account returns before any of this (no limit for it).
  assert.ok(fn.indexOf('member.is_test_account) {') < fn.indexOf("'checkin_daily_store_limit_reached'"))
})

test('admins (only) see members with unusual Check-IN patterns', () => {
  assert.match(migration, /FUNCTION public\.admin_checkin_review[\s\S]*WHERE public\.is_admin\(\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_checkin_review\(integer\) FROM PUBLIC, anon;/)
  assert.match(migration, /interval '10 minutes'/)
  assert.match(migration, /d\.stores >= 3/)
  assert.match(migration, /f\.days >= 15/)
  const panel = read('src/components/admin/CheckinReviewPanel.jsx')
  assert.match(panel, /확인이 필요한 Check-IN/)
  assert.match(panel, /daily_limit: '하루 3곳 Check-IN'/)
  assert.match(read('src/pages/AdminPage.jsx'), /<div className="space-y-4">\n {6}<CheckinReviewPanel \/>/)
  const check = read('supabase/checks/permission-check.sql')
  assert.match(check, /'admin_checkin_review'/)
  // Members read partnership id and name only, never the Apps Script address columns.
  assert.match(check, /'authenticated\|partnerships\|SELECT\|id,name'/)
})
