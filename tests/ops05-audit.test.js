import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../supabase/migrations/20261005081830_ops05_admin_action_audit.sql', import.meta.url),
  'utf8',
)
const addStamp = readFileSync(
  new URL('../supabase/functions/admin-add-stamp/index.ts', import.meta.url),
  'utf8',
)
const createMember = readFileSync(
  new URL('../supabase/functions/admin-create-member/index.ts', import.meta.url),
  'utf8',
)
const updateMember = readFileSync(
  new URL('../supabase/functions/admin-update-member/index.ts', import.meta.url),
  'utf8',
)

test('OPS-05 audit storage is RLS-locked and excludes old/new field values', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_action_audit/i)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.admin_action_audit TO service_role/i)
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/i)
  assert.match(migration, /REVOKE ALL PRIVILEGES ON SEQUENCE public\.admin_action_audit_id_seq/i)
  assert.match(migration, /changed_fields text\[\]/i)
  assert.doesNotMatch(migration, /old_values|new_values|before_state|after_state/i)
  assert.match(migration, /IF \(SELECT auth\.uid\(\)\) IS NULL OR NOT public\.is_admin\(\)/i)
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE/i)
})

test('OPS-05 records Edge Function admin member and stamp actions', () => {
  assert.match(addStamp, /action: 'stamp\.add'/)
  assert.match(addStamp, /action: 'stamp_reward\.restore'/)
  assert.match(addStamp, /action: 'stamp_progress\.reset'/)
  assert.match(createMember, /action: 'member\.create'/)
  assert.match(updateMember, /action: 'member\.update'/)
})
