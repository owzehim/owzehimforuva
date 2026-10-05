import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const originalMigration = new URL('../supabase/migrations/20260825123000_add_restaurant_comments.sql', import.meta.url)
const sec28Migration = new URL('../supabase/migrations/20261005060000_sec28_server_created_timestamps.sql', import.meta.url)
const followupMigration = new URL('../supabase/migrations/20261005074350_sec34_fix_comment_profanity_filter.sql', import.meta.url)

test('SEC-34 comment profanity filter removes actual whitespace in fresh and existing databases', async () => {
  const [originalSql, sec28Sql, followupSql] = await Promise.all([
    readFile(originalMigration, 'utf8'),
    readFile(sec28Migration, 'utf8'),
    readFile(followupMigration, 'utf8'),
  ])

  for (const sql of [originalSql, sec28Sql, followupSql]) {
    assert.match(sql, /compact_body\s*:=\s*lower\(regexp_replace\(normalized_body, '\[\[:space:\]\]\+', '', 'g'\)\)/)
    assert.doesNotMatch(sql, /regexp_replace\(normalized_body, '\\\\s\+'/)
  }
})
