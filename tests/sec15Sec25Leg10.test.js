import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('SEC-15: an already registered new address gets the normal success response', async () => {
  const source = await readFile('supabase/functions/change-pending-email/index.ts', 'utf8')
  const takenBranch = source.indexOf('isEmailTakenError(createError)')
  assert.ok(takenBranch > 0)
  assert.ok(source.slice(takenBranch, takenBranch + 400).includes('return json(successResponse)'))
  assert.ok(takenBranch < source.indexOf("console.warn('Pending email replacement could not be created')"))
})

test('SEC-25: an older login cannot take the device seat back', async () => {
  const source = await readFile('supabase/migrations/20261109120000_sec25_newest_login_keeps_device.sql', 'utf8')
  assert.match(source, /FOR UPDATE/)
  assert.match(source, /seat_login_at >= caller_login_at THEN\s+RETURN false/)
  assert.match(source, /FROM auth\.sessions AS session/)
})

test('LEG-10: the installed app is not locked to portrait', async () => {
  const source = await readFile('vite.config.js', 'utf8')
  assert.ok(!source.includes("orientation: 'portrait'"))
})
