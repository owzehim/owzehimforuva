import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultSecretKey } from '../supabase/functions/_shared/defaultSecretKey.js'

test('returns only the configured default secret key', () => {
  assert.equal(
    getDefaultSecretKey(JSON.stringify({ default: 'sb_secret_example', other: 'sb_secret_other' })),
    'sb_secret_example',
  )
})

test('does not fall back to another named key', () => {
  assert.equal(getDefaultSecretKey(JSON.stringify({ backup: 'sb_secret_example' })), '')
})

test('rejects malformed or non-object configuration', () => {
  assert.equal(getDefaultSecretKey('{not-json'), '')
  assert.equal(getDefaultSecretKey(JSON.stringify(['sb_secret_example'])), '')
  assert.equal(getDefaultSecretKey(JSON.stringify({ default: 123 })), '')
})
