import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { getSessionId, hasAppAccessClaim } from '../src/domain/auth/authRules.js'

function tokenFor(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return 'header.' + payload + '.signature'
}

test('reads the stable session_id from access tokens', () => {
  const firstToken = tokenFor({ session_id: 'login-session-1', app_access: true, exp: 100 })
  const refreshedToken = tokenFor({ session_id: 'login-session-1', app_access: true, exp: 200 })

  assert.equal(getSessionId(firstToken), 'login-session-1')
  assert.equal(getSessionId(refreshedToken), 'login-session-1')
  assert.equal(hasAppAccessClaim(refreshedToken), true)
})

test('returns null for tokens without a session_id or with malformed claims', () => {
  assert.equal(getSessionId(tokenFor({ app_access: true })), null)
  assert.equal(getSessionId('not-a-jwt'), null)
  assert.equal(hasAppAccessClaim('not-a-jwt'), false)
})