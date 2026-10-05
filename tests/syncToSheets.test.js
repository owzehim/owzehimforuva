import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const syncFunction = read('../supabase/functions/sync-to-sheets/index.ts')
const compatibilityFunction = read('../supabase/functions/sync-review-to-sheets/index.ts')

test('sync-to-sheets derives store identity and redemption ownership from server records', () => {
  assert.match(syncFunction, /\.eq\('id', String\(redemption_id\)\)[\s\S]*\.eq\('user_id', userId\)/)
  assert.match(syncFunction, /\.eq\('redemption_id', redemption\.id\)[\s\S]*\.eq\('user_id', userId\)/)
  assert.match(syncFunction, /\.eq\('id', redemption\.store_id\)/)
  assert.doesNotMatch(syncFunction, /body\?\.store_id|body\.store_id|const \{[^}]*store_id[^}]*\} = await req\.json\(\)/)
})

test('sync-to-sheets validates review content and neutralizes formula-leading text', () => {
  assert.match(syncFunction, /const validTags = new Set\(/)
  assert.match(syncFunction, /rating < 1 \|\| rating > 5/)
  assert.match(syncFunction, /sheet_name:\s+sheetText\(/)
  assert.match(syncFunction, /comment:\s+sheetText\(/)
  assert.match(syncFunction, /withAppsScriptSecret\(payload, Deno\.env\.get\('APPS_SCRIPT_SHARED_SECRET'\)\)/)
})

test('legacy review-sync endpoint forwards only the redemption ID to the guarded implementation', () => {
  assert.match(compatibilityFunction, /body: JSON\.stringify\(\{ redemption_id: body\.redemption_id \}\)/)
  assert.doesNotMatch(compatibilityFunction, /store_id|rating|tags_string|comment/)
})
