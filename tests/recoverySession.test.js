import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { isEmailLinkSession } from '../src/domain/auth/recoverySession.js'

const token = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const now = 1793881375

test('SEC-59: reset links accept email-link sessions (GoTrue issues amr "otp" for recovery)', () => {
  assert.equal(isEmailLinkSession(token({ amr: [{ method: 'otp', timestamp: now }] })), true)
  assert.equal(isEmailLinkSession(token({ amr: [{ method: 'recovery', timestamp: now }] })), true)
})

test('SEC-59: normal sign-in sessions and malformed tokens are rejected', () => {
  for (const value of [
    token({ amr: [{ method: 'password', timestamp: now }] }),
    token({ amr: [{ method: 'otp', timestamp: now }, { method: 'password', timestamp: now }] }),
    token({ amr: [{ method: 'oauth', timestamp: now }] }),
    token({ amr: [] }),
    token({}),
    'not-a-jwt',
    '',
    null,
  ]) assert.equal(isEmailLinkSession(value), false)
})
