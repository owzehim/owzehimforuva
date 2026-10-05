import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const migrationDir = new URL('../supabase/migrations/', import.meta.url)
const sec25Name = '20261005080000_sec25_server_enforced_single_device.sql'
const sec18Name = '20261005081000_sec18_anonymous_author_views.sql'
const sec18FollowUpName = '20261005110000_sec18_safe_views_require_active_session.sql'

test('SEC-18 view migrations run after the required SEC-25 session function', () => {
  const sec25Version = Number(basename(sec25Name).slice(0, 14))
  const sec18Version = Number(basename(sec18Name).slice(0, 14))
  assert.ok(sec18Version > sec25Version)

  for (const name of [sec18Name, sec18FollowUpName]) {
    const sql = readFileSync(new URL(name, migrationDir), 'utf8')
    assert.match(sql, /auth\.jwt\(\)\s*->>\s*'aal'\)\s*=\s*'aal2'/i)
    assert.match(sql, /public\.is_current_device_session\(\)/i)
  }
})

test('SEC-18 follow-up drops raw Realtime tables before asserting they are absent', () => {
  const sql = readFileSync(new URL(sec18FollowUpName, migrationDir), 'utf8')
  const dropPosition = sql.indexOf('ALTER PUBLICATION supabase_realtime DROP TABLE')
  const assertionPosition = sql.indexOf('SEC-18: raw author-bearing tables must not publish Realtime changes')

  assert.notEqual(dropPosition, -1)
  assert.notEqual(assertionPosition, -1)
  assert.ok(dropPosition < assertionPosition)
})
