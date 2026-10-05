import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultSecretKey } from '../supabase/functions/_shared/defaultSecretKey.js'

test('reads only the named default Supabase secret key', () => {
  assert.equal(getDefaultSecretKey(JSON.stringify({ default: 'sb_secret_default', another: 'sb_secret_other' })), 'sb_secret_default')
})

test('fails closed when default secret key is missing or blank', () => {
  assert.equal(getDefaultSecretKey(JSON.stringify({ another: 'sb_secret_named' })), '')
  assert.equal(getDefaultSecretKey(JSON.stringify({ default: '  ' })), '')
})

test('fails closed on malformed or non-object secret configuration', () => {
  assert.equal(getDefaultSecretKey('{'), '')
  assert.equal(getDefaultSecretKey('[]'), '')
  assert.equal(getDefaultSecretKey('null'), '')
})
