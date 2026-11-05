import test from 'node:test'
import assert from 'node:assert/strict'
import { constantTimeSecretEquals } from '../supabase/functions/_shared/constantTimeSecret.js'

const configuredSecret = 'a'.repeat(64)

test('retention secret comparison accepts equal strong secrets', async () => {
  assert.equal(await constantTimeSecretEquals(configuredSecret, configuredSecret), true)
})

test('retention secret comparison rejects a different secret and short configuration', async () => {
  assert.equal(await constantTimeSecretEquals(configuredSecret, `${configuredSecret}b`), false)
  assert.equal(await constantTimeSecretEquals('short', 'short'), false)
})

test('retention secret comparison rejects oversized supplied values', async () => {
  assert.equal(await constantTimeSecretEquals(configuredSecret, 'x'.repeat(513)), false)
  assert.equal(await constantTimeSecretEquals('x'.repeat(513), 'x'.repeat(513)), false)
})
