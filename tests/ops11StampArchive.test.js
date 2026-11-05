// OPS-11: stamp progress reset archives history instead of deleting it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261105230000_ops11_archive_stamp_progress_reset.sql', 'utf8')
const fn = readFileSync('supabase/functions/admin-add-stamp/index.ts', 'utf8')

test('archive tables are closed to app users and follow account deletion', () => {
  for (const table of ['stamp_card_visits_archive', 'stamp_card_rewards_archive']) {
    assert.ok(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`))
    assert.ok(sql.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`))
  }
  assert.equal((sql.match(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/g) || []).length, 2)
  assert.equal((sql.match(/delete_after timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '12 months'\)/g) || []).length, 2)
})

test('only the server can run the reset, and it moves rows instead of dropping them', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_reset_stamp_progress\(uuid, uuid\) FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_reset_stamp_progress\(uuid, uuid\) TO service_role/)
  assert.match(sql, /DELETE FROM public\.stamp_card_visits[\s\S]*RETURNING[\s\S]*INSERT INTO public\.stamp_card_visits_archive/)
  assert.match(sql, /DELETE FROM public\.stamp_card_rewards[\s\S]*RETURNING[\s\S]*INSERT INTO public\.stamp_card_rewards_archive/)
})

test('admin reset uses the archiving function, not direct deletes', () => {
  assert.match(fn, /rpc\('admin_reset_stamp_progress'/)
  assert.doesNotMatch(fn, /from\('stamp_card_visits'\)\s*\.delete\(\)/)
  assert.doesNotMatch(fn, /from\('stamp_card_rewards'\)\s*\.delete\(\)/)
})
