import test from 'node:test'
import assert from 'node:assert/strict'
import { APPS_SCRIPT_AUTH_FIELD, withAppsScriptSecret } from '../supabase/functions/_shared/appsScriptAuth.js'

test('Apps Script payloads require a sufficiently long shared secret', () => {
  assert.throws(() => withAppsScriptSecret({ type: 'redemption' }, undefined), /not configured/)
  assert.throws(() => withAppsScriptSecret({ type: 'redemption' }, 'short'), /not configured/)
})

test('Apps Script auth is appended without mutating the business payload', () => {
  const payload = { type: 'redemption', user_id: 'member-id' }
  const result = withAppsScriptSecret(payload, 'x'.repeat(32))

  assert.equal(result[APPS_SCRIPT_AUTH_FIELD], 'x'.repeat(32))
  assert.equal(result.type, payload.type)
  assert.equal(payload[APPS_SCRIPT_AUTH_FIELD], undefined)
})

test('reserved auth field cannot be supplied by a caller payload', () => {
  assert.throws(
    () => withAppsScriptSecret({ [APPS_SCRIPT_AUTH_FIELD]: 'attacker' }, 'x'.repeat(32)),
    /reserved field/,
  )
})
