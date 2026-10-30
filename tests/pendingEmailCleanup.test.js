import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { finalizePendingEmail, retryPendingEmailCleanup } from '../supabase/functions/_shared/finalizePendingEmail.js'
import { getConsentAcceptedAt, getConsentReceiptRows } from '../supabase/functions/_shared/legalConsent.js'
import { getStudentNumberRegistrationFields } from '../supabase/functions/_shared/memberStudentNumber.js'

const registration = {
  age_16_plus_confirmed: true, first_name: 'Test', last_name: 'Member',
  student_number: '12345678', major: 'Testing', university: 'UvA',
  education_level: 'bachelor', privacy_policy_version: 'test-version',
}
const user = {
  id: 'corrected-account', email: 'corrected@example.invalid', email_confirmed_at: '2026-10-30T00:00:00Z',
  created_at: '2026-10-30T00:00:00Z', user_metadata: { registration },
}
const originalCreatedAt = '2026-10-28T12:34:56Z'

function fixture({ failures = 0, existing = false, race = false, missingOld = false, noMapping = false, noMatch = false, state = 'transferred', registered = false } = {}) {
  const events = []
  let oldExists = !missingOld
  let mappingExists = !noMapping
  let deleteAttempts = 0
  let receipts
  let memberLookups = 0
  const admin = {
    rpc: async (name, args) => {
      assert.equal(name, 'complete_pending_email_change')
      assert.deepEqual(args, { p_new_user_id: user.id, p_confirmed_email: user.email })
      events.push('transfer')
      return { data: mappingExists && !noMatch ? [{ old_user_id: 'old-account', state }] : [], error: null }
    },
    auth: { getUser: async () => ({ data: { user }, error: null }), admin: {
      getUserById: async id => {
        if (id === user.id) return { data: { user: registered ? { ...user, user_metadata: {} } : user }, error: null }
        assert.equal(id, 'old-account')
        return oldExists ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { status: 404 } }
      },
      deleteUser: async id => {
        assert.equal(id, 'old-account')
        events.push('delete-old')
        if (deleteAttempts++ < failures) return { error: { status: 503 } }
        oldExists = false
        return { error: null }
      },
      updateUserById: async id => { assert.equal(id, user.id); events.push('clear-metadata'); return { error: null } },
    } },
    from: table => {
      let deleting = false
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: async () => ({ data: mappingExists ? [{ new_user_id: user.id }] : [], error: null }),
        delete: () => { deleting = true; return q },
        maybeSingle: async () => ({ data: table === 'pending_email_changes'
          ? (mappingExists ? { original_created_at: originalCreatedAt } : null)
          : ((existing || (race && memberLookups++ > 0)) ? { id: 'member' } : null), error: null }),
        insert: async () => { events.push('insert-member'); return { error: race ? { code: '23505' } : null } },
        upsert: async rows => { events.push('receipts'); receipts = rows; return { error: null } },
        then: resolve => {
          if (deleting) { events.push('clear-mapping'); mappingExists = false }
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return q
    },
  }
  return { admin, events, get mappingExists() { return mappingExists }, get receipts() { return receipts } }
}

test('cleanup uses the verified server association and automatically retries transient deletion failures', async () => {
  const f = fixture({ failures: 2 })
  const waits = []
  assert.deepEqual(await finalizePendingEmail(f.admin, user, async ms => waits.push(ms)), { changed: true })
  assert.equal(f.events.filter(e => e === 'delete-old').length, 3)
  assert.deepEqual(waits, [200, 400])
  assert.equal(f.mappingExists, true)
  await finalizePendingEmail(f.admin, user, async () => {})
  assert.equal(f.events.filter(e => e === 'delete-old').length, 3)
})

test('ordinary signup, absent old account, and unconfirmed/invalid transfers are handled safely', async () => {
  assert.deepEqual(await finalizePendingEmail(fixture({ noMapping: true }).admin, user), { changed: false })
  assert.deepEqual(await finalizePendingEmail(fixture({ missingOld: true }).admin, user), { changed: true })
  await assert.rejects(finalizePendingEmail(fixture().admin, { ...user, email_confirmed_at: null }))
  const invalid = fixture({ state: 'pending' })
  await assert.rejects(finalizePendingEmail(invalid.admin, user, async () => {}))
  assert.equal(invalid.events.includes('delete-old'), false)
})

async function runRegistration(f, body = {}) {
  let handler
  const source = stripTypeScriptTypes((await readFile(new URL('../supabase/functions/complete-member-registration/index.ts', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, ''))
  vm.runInNewContext(source, {
    Deno: { serve: fn => { handler = fn }, env: { get: () => 'synthetic' } },
    createClient: () => f.admin, getCorsHeaders: () => ({}), isAllowedCorsOrigin: () => true,
    getSupabaseServiceKey: () => 'synthetic', apiKeyOnlyFetch: () => undefined,
    finalizePendingEmail: (admin, verifiedUser) => finalizePendingEmail(admin, verifiedUser, async () => {}),
    getConsentAcceptedAt, getConsentReceiptRows, getStudentNumberRegistrationFields,
    Response, Date, console: { error() {} },
  })
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}

test('registration cleans the old identity before mapping/metadata on new, existing and raced member paths', async () => {
  for (const options of [{}, { existing: true }, { race: true }]) {
    const f = fixture(options)
    const result = await runRegistration(f)
    assert.equal(result.status, 200)
    assert.equal(result.body.success, true)
    assert.ok(f.events.indexOf('delete-old') < f.events.indexOf('clear-mapping'))
    assert.ok(f.events.indexOf('delete-old') < f.events.indexOf('clear-metadata'))
    assert.equal(f.receipts.length, 4)
    assert.ok(f.receipts.every(row => row.accepted_at === '2026-10-28T12:34:56.000Z'))
    assert.equal(f.mappingExists, false)
  }
})

test('failed cleanup retains signup metadata and mapping; a later registration attempt completes safely', async () => {
  const f = fixture({ failures: 3 })
  assert.equal((await runRegistration(f)).status, 503)
  assert.equal(f.mappingExists, true)
  assert.equal(f.events.includes('clear-metadata'), false)
  assert.equal(f.events.includes('insert-member'), false)
  assert.equal((await runRegistration(f)).body.success, true)
  assert.equal(f.mappingExists, false)
})

test('client-supplied old account IDs never initiate cleanup', async () => {
  const f = fixture()
  assert.equal((await runRegistration(f, { old_user_id: 'victim' })).status, 400)
  assert.equal(f.events.includes('delete-old'), false)
})

test('an email mismatch cannot discard a pending mapping or delete an account', async () => {
  const f = fixture({ noMatch: true })
  assert.equal((await runRegistration(f)).status, 503)
  assert.equal(f.mappingExists, true)
  assert.equal(f.events.includes('delete-old'), false)
  assert.deepEqual(await retryPendingEmailCleanup(f.admin), { completed: 0, failed: 1 })
  assert.equal(f.mappingExists, true)
})

test('scheduled retry removes the old account while retaining the original consent timestamp for unfinished registration', async () => {
  const f = fixture()
  assert.deepEqual(await retryPendingEmailCleanup(f.admin), { completed: 1, failed: 0 })
  assert.equal(f.mappingExists, true)
  assert.equal(f.events.includes('delete-old'), true)
  assert.equal((await runRegistration(f)).body.success, true)
  assert.ok(f.receipts.every(row => row.accepted_at === '2026-10-28T12:34:56.000Z'))
})

test('scheduled failures retain mappings and do not clear registration metadata', async () => {
  const f = fixture({ failures: 3 })
  // Avoid waiting for real backoff in this isolated test.
  const originalDelete = f.admin.auth.admin.deleteUser
  f.admin.auth.admin.deleteUser = async id => ({ ...(await originalDelete(id)), error: { status: 403 } })
  assert.deepEqual(await retryPendingEmailCleanup(f.admin), { completed: 0, failed: 1 })
  assert.equal(f.mappingExists, true)
  assert.equal(f.events.includes('clear-metadata'), false)
})

test('scheduled cleanup removes a completed signup mapping only after the old account is gone', async () => {
  const f = fixture({ registered: true })
  assert.deepEqual(await retryPendingEmailCleanup(f.admin), { completed: 1, failed: 0 })
  assert.ok(f.events.indexOf('delete-old') < f.events.indexOf('clear-mapping'))
  assert.equal(f.mappingExists, false)
})
