// OPS-04 / SEC-63: single-device check, and its one test-account exemption.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { hasActiveDeviceSession } from '../supabase/functions/_shared/requireVerifiedLogin.ts'

const USER = '11111111-1111-4111-8111-111111111111'

function token(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

// Minimal stand-in for the service-role client: returns fixed rows per table.
function fakeAdmin({ adminRole = null, member = null, exemption = null } = {}) {
  const rows = { admin_roles: adminRole, members: member, login_otp_exempt_users: exemption }
  return {
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      }
      return query
    },
  }
}

const memberToken = token({ sub: USER, app_access: true, session_id: 'device-a' })

test('the current device passes and another device is rejected', async () => {
  const admin = fakeAdmin({ member: { session_token: 'device-a', is_test_account: false } })
  assert.equal(await hasActiveDeviceSession(admin, USER, memberToken), true)
  const otherDevice = token({ sub: USER, app_access: true, session_id: 'device-b' })
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice), false)
})

test('tokens without app login or for another user are rejected', async () => {
  const admin = fakeAdmin({ member: { session_token: 'device-a', is_test_account: false } })
  assert.equal(await hasActiveDeviceSession(admin, USER, token({ sub: USER, session_id: 'device-a' })), false)
  assert.equal(
    await hasActiveDeviceSession(admin, USER, token({ sub: 'someone-else', app_access: true, session_id: 'device-a' })),
    false,
  )
})

test('only test@uvain.nl skips the device check (SEC-63)', async () => {
  const admin = fakeAdmin({
    member: { session_token: 'device-a', is_test_account: true },
    exemption: { user_id: USER },
  })
  const otherDevice = token({ sub: USER, app_access: true, session_id: 'device-b' })
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice, { testAccountEmail: 'test@uvain.nl' }), true)
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice, { testAccountEmail: 'Test@UvAIN.nl ' }), true)
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice, { testAccountEmail: 'other-test@uvain.nl' }), false)
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice), false)
})

test('test@uvain.nl still needs the test flag and the exemption row', async () => {
  const otherDevice = token({ sub: USER, app_access: true, session_id: 'device-b' })
  const notTest = fakeAdmin({ member: { session_token: 'device-a', is_test_account: false }, exemption: { user_id: USER } })
  assert.equal(await hasActiveDeviceSession(notTest, USER, otherDevice, { testAccountEmail: 'test@uvain.nl' }), false)
  const noRow = fakeAdmin({ member: { session_token: 'device-a', is_test_account: true } })
  assert.equal(await hasActiveDeviceSession(noRow, USER, otherDevice, { testAccountEmail: 'test@uvain.nl' }), false)
})

test('SEC-25: an admin with a members row holds one device seat like a member', async () => {
  const admin = fakeAdmin({
    adminRole: { user_id: USER },
    member: { session_token: 'device-a', is_test_account: false },
  })
  assert.equal(await hasActiveDeviceSession(admin, USER, memberToken), true)
  const otherDevice = token({ sub: USER, app_access: true, session_id: 'device-b' })
  assert.equal(await hasActiveDeviceSession(admin, USER, otherDevice), false)
})

test('SEC-25: only an admin without a members row skips the seat check', async () => {
  const otherDevice = token({ sub: USER, app_access: true, session_id: 'device-b' })
  assert.equal(await hasActiveDeviceSession(fakeAdmin({ adminRole: { user_id: USER } }), USER, otherDevice), true)
  assert.equal(await hasActiveDeviceSession(fakeAdmin(), USER, otherDevice), false)
})
