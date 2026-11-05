// OPS-05: admin audit covers more tables and changes made outside the app.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261105235000_ops05_audit_coverage.sql', 'utf8')

test('the three report tables get the audit trigger', () => {
  for (const table of ['admin_roles', 'partnership_integrations', 'login_otp_exempt_users']) {
    assert.ok(sql.includes(`AFTER INSERT OR UPDATE OR DELETE ON public.${table}`), table)
  }
})

test('changes without an app user are recorded with the database user', () => {
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS db_role text'))
  assert.ok(sql.includes("login_role text := session_user::text"))
  assert.ok(sql.includes("CASE WHEN actor IS NULL THEN login_role END"))
})

test('members and Edge Function service calls are still not logged by the trigger', () => {
  assert.ok(sql.includes('IF NOT public.is_admin() THEN'))
  assert.ok(sql.includes("ELSIF login_role = 'authenticator' THEN"))
})

test('only column names are stored, not values', () => {
  assert.doesNotMatch(sql, /INSERT INTO public\.admin_action_audit[\s\S]*?(old_row|new_row)\s*[,)]/)
})
