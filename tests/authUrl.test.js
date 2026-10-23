import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoDetectSessionInUrl } from '../src/domain/auth/authUrl.js'

test('lets the password reset page handle its own one-time recovery code', () => {
  assert.equal(shouldAutoDetectSessionInUrl('/reset-password'), false)
  assert.equal(shouldAutoDetectSessionInUrl('/reset-password/'), false)
})

test('keeps automatic auth URL handling enabled on other routes', () => {
  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed'), true)
  assert.equal(shouldAutoDetectSessionInUrl('/login'), true)
})
