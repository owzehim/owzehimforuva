import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { shouldAutoDetectSessionInUrl } from '../src/domain/auth/authUrl.js'

function tokenFor(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `header.${payload}.signature`
}

test('allows email-link handling only on the email confirmation route', () => {
  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed', '?code=pkce-code'), true)
  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed/'), true)
  assert.equal(shouldAutoDetectSessionInUrl('/login', '?code=pkce-code'), false)
  assert.equal(shouldAutoDetectSessionInUrl('/member', '', '#access_token=email-token'), false)
})

test('rejects app login tokens on the email confirmation route', () => {
  const appToken = tokenFor({ app_access: true })
  const emailToken = tokenFor({ app_access: false })

  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed', '', `#access_token=${appToken}`), false)
  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed', `?access_token=${appToken}`), false)
  assert.equal(shouldAutoDetectSessionInUrl('/email-confirmed', '', `#access_token=${emailToken}`), true)
})

test('leaves password recovery URL handling to its dedicated client', () => {
  assert.equal(shouldAutoDetectSessionInUrl('/reset-password', '?code=pkce-code'), false)
  assert.equal(shouldAutoDetectSessionInUrl('/reset-password/', '', '#type=recovery'), false)
})
