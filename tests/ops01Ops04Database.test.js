// OPS-01 / OPS-04: schema baseline and the read-only permission check.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const baseline = readFileSync('supabase/baselines/production-schema-20261106.sql', 'utf8')
const check = readFileSync('supabase/checks/permission-check.sql', 'utf8')
const workflow = readFileSync('.github/workflows/database-permission-check.yml', 'utf8')

test('the schema baseline creates the core tables and holds no data or secrets', () => {
  for (const table of ['members', 'restaurants', 'partnerships', 'redemptions', 'stamp_card_visits', 'stamp_card_rewards', 'admin_roles', 'admin_action_audit', 'partnership_apps_script_secrets']) {
    assert.match(baseline, new RegExp(`CREATE TABLE IF NOT EXISTS "public"."${table}"`), table)
  }
  assert.ok(baseline.includes('REFERENCE ONLY'))
  assert.doesNotMatch(baseline, /^COPY /m)
  assert.doesNotMatch(baseline, /sb_secret_|script\.google\.com|eyJ[A-Za-z0-9_-]{10,}\./)
})

test('the permission check is read-only and covers RLS, grants and definer functions', () => {
  assert.ok(check.includes('BEGIN READ ONLY;'))
  assert.ok(check.trimEnd().endsWith('ROLLBACK;'))
  assert.ok(check.includes('tables without RLS'))
  assert.ok(check.includes('unexpected table privileges'))
  assert.ok(check.includes('SECURITY DEFINER functions'))
  const code = check.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(GRANT|REVOKE|INSERT INTO|UPDATE public|DELETE FROM|ALTER|CREATE|DROP)\b/)
})

test('server-only tables stay closed to app users in the expected model', () => {
  for (const table of ['admin_action_audit', 'partnership_apps_script_secrets', 'partnership_integrations', 'privacy_sheet_sync_queue', 'login_otp_exempt_users', 'stamp_card_visits_archive', 'stamp_card_rewards_archive']) {
    assert.ok(!check.includes(`|${table}|`), table)
  }
})

test('the workflow runs the check weekly with a read-only session', () => {
  assert.ok(workflow.includes('default_transaction_read_only=on'))
  assert.ok(workflow.includes('supabase/checks/permission-check.sql'))
  assert.ok(workflow.includes("cron: '0 4 * * 1'"))
})
