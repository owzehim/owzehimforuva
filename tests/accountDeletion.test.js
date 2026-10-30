import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { hasFreshDeletionPasswordProof } from '../supabase/functions/_shared/deletionPasswordProof.js'

const userId = '11111111-1111-4111-8111-111111111111'
const now = Math.floor(Date.now() / 1000)
const validClaims = {
  sub: userId, session_id: 'password-proof-session', exp: now + 3600,
  amr: [{ method: 'password', timestamp: now }],
}
const tokenFor = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature'

test('deletion proof requires this account and a recent password authentication, not just a refreshed token', () => {
  assert.equal(hasFreshDeletionPasswordProof(validClaims, userId, now), true)
  for (const claims of [
    null,
    { ...validClaims, sub: 'another-user' },
    { ...validClaims, session_id: '' },
    { ...validClaims, exp: now - 1 },
    { ...validClaims, amr: [{ method: 'otp', timestamp: now }] },
    { ...validClaims, iat: now, amr: [{ method: 'password', timestamp: now - 86400 }] },
    { ...validClaims, amr: [{ method: 'password', timestamp: now + 60 }] },
    { ...validClaims, amr: [{ method: 'password', timestamp: String(now) }] },
  ]) assert.equal(hasFreshDeletionPasswordProof(claims, userId, now), false)
})

const handlerSource = stripTypeScriptTypes(
  (await readFile(new URL('../supabase/functions/delete-my-account/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, ''),
)

async function runDeletion({ proofClaims = validClaims, authRejects = false, otherUser = false, legacyRequest = false } = {}) {
  let handler
  let privacyCalls = 0
  const appToken = tokenFor({ sub: userId, app_access: true, session_id: 'existing-app-session', amr: [{ method: 'otp', timestamp: now - 7 * 86400 }] })
  const admin = {
    auth: { getUser: async token => token === appToken
      ? { data: { user: { id: userId } }, error: null }
      : { data: { user: authRejects ? null : { id: otherUser ? 'another-user' : userId } }, error: authRejects ? new Error('invalid token') : null } },
    from() {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }
      return query
    },
  }
  vm.runInNewContext(handlerSource, {
    Deno: { serve: fn => { handler = fn }, env: { get: () => 'synthetic' } },
    createClient: () => admin, getCorsHeaders: () => ({}), isAllowedCorsOrigin: () => true,
    getSupabaseServiceKey: () => 'synthetic', apiKeyOnlyFetch: () => undefined,
    hasVerifiedAppLogin: () => true, hasActiveDeviceSession: async () => true,
    hasFreshDeletionPasswordProof,
    getMasterPrivacyEndpoint: async () => { privacyCalls++; throw new Error('Stop before any external request or write') },
    Request, Response, atob, Date, AbortSignal, console: { error() {} },
  })
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { Authorization: `Bearer ${appToken}` },
    body: JSON.stringify(legacyRequest ? { confirmation: 'DELETE' } : { passwordAccessToken: tokenFor(proofClaims) }),
  }))
  return { status: response.status, privacyCalls }
}

test('legacy DELETE-only requests cannot initiate deletion', async () => {
  assert.deepEqual(await runDeletion({ legacyRequest: true }), { status: 400, privacyCalls: 0 })
})

test('invalid, wrong-account, OTP-only, and stale proofs are rejected before any privacy operation', async () => {
  for (const options of [
    { authRejects: true },
    { otherUser: true },
    { proofClaims: { ...validClaims, sub: 'another-user' } },
    { proofClaims: { ...validClaims, amr: [{ method: 'otp', timestamp: now }] } },
    { proofClaims: { ...validClaims, amr: [{ method: 'password', timestamp: now - 86400 }], iat: now } },
  ]) assert.deepEqual(await runDeletion(options), { status: 403, privacyCalls: 0 })
})

test('a fresh password proof works with an old active app login, without forcing re-login', async () => {
  // The synthetic privacy endpoint intentionally stops the handler before any
  // real cleanup; reaching it proves the old app login was accepted.
  assert.deepEqual(await runDeletion(), { status: 500, privacyCalls: 1 })
})

const clientSource = (await readFile(new URL('../src/api/authRepository.js', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.env.', 'env.')

async function runClientDeletion({ wrongPassword = false, wrongUser = false } = {}) {
  const calls = []
  const verifier = { auth: {
    signInWithPassword: async () => ({
      data: { user: { id: wrongUser ? 'another-user' : userId }, session: { access_token: 'password-proof' } },
      error: wrongPassword ? { code: 'invalid_credentials' } : null,
    }),
    signOut: async options => { calls.push({ temporarySignOut: options }); return { error: null } },
  } }
  const context = vm.createContext({
    env: { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic' },
    createClient: () => verifier, apiKeyOnlyFetch: () => undefined,
    getCaptchaOptions: token => ({ captchaToken: token }),
    supabase: { auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'synthetic@example.invalid' } }, error: null }),
      setSession: () => { throw new Error('App session must not be replaced') },
      signOut: () => { throw new Error('App session must not be signed out') },
    }, functions: { invoke: async (name, options) => { calls.push({ name, body: options.body }); return { data: { success: false }, error: null } } } },
  })
  vm.runInContext(clientSource, context)
  let error = null
  try { await context.deleteAccountWithPassword('synthetic-password', 'synthetic-captcha') } catch (failure) { error = failure.message }
  return { calls: JSON.parse(JSON.stringify(calls)), error }
}

test('wrong password or another account cannot send a deletion request or replace the app session', async () => {
  for (const options of [{ wrongPassword: true }, { wrongUser: true }]) {
    const result = await runClientDeletion(options)
    assert.ok(result.error)
    assert.deepEqual(result.calls, [{ temporarySignOut: { scope: 'local' } }])
  }
})

test('deletion sends only the password proof and revokes only its temporary session on failure', async () => {
  const result = await runClientDeletion()
  assert.equal(result.error, null)
  assert.deepEqual(result.calls, [
    { name: 'delete-my-account', body: { passwordAccessToken: 'password-proof' } },
    { temporarySignOut: { scope: 'local' } },
  ])
})
