// SEC-51, SEC-41, PERF-10, PERF-08, PERF-04 follow-ups.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('SEC-51: no CSP rule allows wasm-unsafe-eval', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const policies = config.headers.flatMap((rule) => rule.headers).filter((header) => header.key === 'Content-Security-Policy')
  assert.equal(policies.length, 3)
  for (const policy of policies) {
    assert.ok(!policy.value.includes('wasm-unsafe-eval'))
    assert.match(policy.value, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/)
  }
})

test('SEC-41 / PERF-10: comment trimming removed and auth.uid() wrapped in policies', () => {
  const sql = readFileSync('supabase/migrations/20261106120000_sec41_perf10_policy_cleanup.sql', 'utf8')
  assert.ok(sql.includes('DROP TRIGGER IF EXISTS keep_ten_restaurant_comments ON public.restaurant_comments;'))
  assert.ok(sql.includes("'( SELECT auth.uid() AS uid)'"))
  assert.ok(sql.includes("WHERE n.nspname = 'public'"))
})

test('PERF-08: device check and notes refresh once a minute while visible', () => {
  const device = readFileSync('src/hooks/useSingleDeviceSession.js', 'utf8')
  assert.ok(device.includes('const CHECK_INTERVAL_MS = 60000'))
  assert.ok(device.includes("if (document.visibilityState === 'visible') void checkCurrentDevice()"))
  const notes = readFileSync('src/components/GoodToKnowNotesPanel.jsx', 'utf8')
  assert.ok(!notes.includes('setInterval(loadNotes, 15000)'))
  assert.ok(notes.includes("if (document.visibilityState === 'visible') loadNotes()"))
})

test('PERF-04: check-in answers before the Google Sheets writes finish', () => {
  const source = readFileSync('supabase/functions/log-redemption/index.ts', 'utf8')
  assert.ok(source.includes('edgeRuntime.waitUntil(sheetSync)'))
  assert.ok(source.includes("sheetSync: 'background'"))
  assert.ok(!source.includes('const sheetResults = await Promise.all'))
})
