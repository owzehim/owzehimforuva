import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const migration = readFileSync(
  new URL('../supabase/migrations/20261005130000_sec20_explicit_api_grants.sql', import.meta.url),
  'utf8',
)
const partnershipsMigration = readFileSync(
  new URL('../supabase/migrations/20261005013148_sec08_private_partnership_integrations.sql', import.meta.url),
  'utf8',
)

test('SEC-20 final grant reset runs after session, report, and safe-view migrations', () => {
  const sec20Version = Number(basename('../supabase/migrations/20261005130000_sec20_explicit_api_grants.sql').slice(0, 14))
  for (const dependency of [
    '20261005080000_sec25_server_enforced_single_device.sql',
    '20261005095000_sec34_admin_report_queue.sql',
    '20261005081830_ops05_admin_action_audit.sql',
    '20261005110000_sec18_safe_views_require_active_session.sql',
    '20261005120000_sec20_harden_helper_functions.sql',
  ]) {
    assert.ok(sec20Version > Number(basename(dependency).slice(0, 14)))
  }
})

test('SEC-20 resets inherited API grants and restores the app operations explicitly', () => {
  assert.match(migration, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public\s+FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /REVOKE ALL PRIVILEGES \(%I\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT SELECT ON TABLE public\.restaurants TO anon/i)
  assert.match(migration, /GRANT SELECT \(id, name\)\s+ON TABLE public\.partnerships TO authenticated/i)
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*sheet_name[^)]*\)\s+ON TABLE public\.partnerships/i)
  assert.match(partnershipsMigration, /GRANT SELECT \(id, name\)\s+ON TABLE public\.partnerships TO authenticated/i)
  assert.doesNotMatch(partnershipsMigration, /GRANT SELECT \([^)]*sheet_name[^)]*\)\s+ON TABLE public\.partnerships/i)
  assert.doesNotMatch(partnershipsMigration, /TO anon, authenticated/i)
  assert.match(partnershipsMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.partnerships FROM PUBLIC, anon, authenticated/i)
  assert.match(partnershipsMigration, /REVOKE ALL PRIVILEGES \(%I\) ON TABLE public\.partnerships FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT INSERT ON TABLE public\.reviews TO authenticated/i)
  assert.match(migration, /has_table_privilege\('anon', 'public\.reviews', 'INSERT'\)/i)
  assert.match(migration, /GRANT INSERT, UPDATE, DELETE ON TABLE public\.events, public\.restaurants\s+TO authenticated/i)
  assert.match(migration, /GRANT UPDATE \(username, profile_image_url, tutorial_completed_at\)\s+ON TABLE public\.members TO authenticated/i)
  assert.match(migration, /GRANT UPDATE \(status\) ON TABLE public\.review_prompts TO authenticated/i)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.admin_action_audit FROM service_role/i)
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.admin_action_audit TO service_role/i)
  assert.match(migration, /has_table_privilege\('service_role', 'public\.admin_action_audit', 'UPDATE'\)/i)
  assert.match(migration, /GRANT UPDATE \(reviewed_at, reviewed_by\)/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_current_device_session\(\) TO authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_single_device_session\(\) TO authenticated/i)
  assert.match(migration, /has_function_privilege\('anon', 'public\.claim_single_device_session\(\)', 'EXECUTE'\)/i)
  assert.match(migration, /anon has an unexpected public-table grant/i)
  assert.match(migration, /anon can execute an unexpected public function/i)
  assert.match(migration, /authenticated can execute an unexpected public function/i)
  assert.match(migration, /authenticated', 'public\.stamp_card_visits', 'INSERT'/i)
  assert.match(migration, /authenticated', 'public\.stamp_card_rewards', 'UPDATE'/i)
  assert.match(migration, /CROSS JOIN LATERAL aclexplode\(attribute\.attacl\)/i)
  assert.match(migration, /relation\.relname = 'members'[\s\S]*attribute\.attname IN \('username', 'profile_image_url', 'tutorial_completed_at'\)/i)
  assert.match(migration, /relation\.relname = 'partnerships'[\s\S]*attribute\.attname IN \('id', 'name'\)/i)
  assert.match(migration, /unexpected public-schema column privilege remains/i)
})
