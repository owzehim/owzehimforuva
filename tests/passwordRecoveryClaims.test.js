import test from 'node:test'
import assert from 'node:assert/strict'
import { isPasswordRecoveryClaims } from '../src/domain/auth/recovery.js'

test('only a verified recovery AMR claim authorizes the password reset flow', () => {
  assert.equal(isPasswordRecoveryClaims({ amr: [{ method: 'recovery' }] }), true)
  assert.equal(isPasswordRecoveryClaims({ amr: [{ method: 'password' }] }), false)
  assert.equal(isPasswordRecoveryClaims({ amr: [{ method: 'otp' }] }), false)
  assert.equal(isPasswordRecoveryClaims({ amr: 'recovery' }), false)
  assert.equal(isPasswordRecoveryClaims(null), false)
})
