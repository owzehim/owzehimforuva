import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const sec12Migration = read('../supabase/migrations/20261005030000_sec12_require_aal2.sql')

const privilegedFunctions = [
  '../supabase/functions/admin-add-stamp/index.ts',
  '../supabase/functions/admin-create-member/index.ts',
  '../supabase/functions/admin-update-member/index.ts',
  '../supabase/functions/log-redemption/index.ts',
  '../supabase/functions/redeem-stamp-card-reward/index.ts',
  '../supabase/functions/sync-to-sheets/index.ts',
]

test('SEC-12 applies a restrictive AAL2 policy to every RLS table and Storage objects', () => {
  assert.match(sec12Migration, /pg_tables[\s\S]*rowsecurity IS TRUE/i)
  assert.match(sec12Migration, /AS RESTRICTIVE FOR ALL TO authenticated/i)
  assert.match(sec12Migration, /auth\.jwt\(\) ->> ''aal''\) = ''aal2''/i)
  assert.match(sec12Migration, /ON storage\.objects[\s\S]*AS RESTRICTIVE[\s\S]*FOR ALL[\s\S]*TO authenticated/i)
})

test('service-role Edge Functions verify AAL2 and active device before querying data', () => {
  for (const path of privilegedFunctions) {
    const source = read(path)
    const handlerStart = source.indexOf('serve(async')
    assert.ok(handlerStart >= 0, `${path} must expose a request handler`)
    const verifiedUserAt = source.indexOf('admin.auth.getUser(token)', handlerStart)
    const aal2At = source.indexOf('hasAal2(admin, token)', handlerStart)
    const activeSessionAt = source.indexOf('hasActiveDeviceSession(admin,', handlerStart)
    const firstPrivilegedQueryAt = Math.min(
      ...['.from(', '.rpc(']
        .map((needle) => source.indexOf(needle, handlerStart))
        .filter((index) => index >= 0),
    )

    assert.ok(verifiedUserAt >= 0, `${path} must validate the caller token`)
    assert.ok(aal2At > verifiedUserAt, `${path} must require AAL2 after validating the caller`)
    assert.ok(activeSessionAt > aal2At, `${path} must validate the active device after AAL2`)
    assert.ok(firstPrivilegedQueryAt > activeSessionAt, `${path} must gate service-role data access`)
  }
})

test('the initial confirmed-registration function remains usable before users enroll MFA', () => {
  const registration = read('../supabase/functions/complete-member-registration/index.ts')
  assert.match(registration, /admin\.auth\.getUser\(token\)/)
  assert.doesNotMatch(registration, /hasAal2\(/)
})
