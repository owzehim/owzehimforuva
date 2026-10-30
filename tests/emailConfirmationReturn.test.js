import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { watchEmailConfirmation, confirmationRedirectUrl, CONFIRMATION_EVENT_KEY } from '../src/domain/auth/emailConfirmationReturn.js'

const token = '11111111-1111-4111-8111-111111111111'
const otherToken = '22222222-2222-4222-8222-222222222222'
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
function monitor(check) {
  const win = new EventTarget(), doc = new EventTarget(), results = []
  let stored = null, interval, cleared = false
  doc.visibilityState = 'visible'
  win.localStorage = { getItem: () => stored }
  win.setInterval = fn => { interval = fn; return 1 }
  win.clearInterval = () => { cleared = true }
  const stop = watchEmailConfirmation({ token, check, onResult: value => results.push(value), targetWindow: win, targetDocument: doc })
  return { win, doc, results, stop, tick: () => interval(), store: value => { stored = JSON.stringify(value) }, get cleared() { return cleared } }
}

test('the email redirect carries only the opaque attempt token to the fixed confirmation page', () => {
  const url = new URL(confirmationRedirectUrl(token))
  assert.equal(url.origin + url.pathname, 'https://app.uva-in.nl/email-confirmed')
  assert.equal(url.searchParams.get('returnToken'), token)
  assert.equal(new URL(confirmationRedirectUrl()).search, '')
  assert.equal(new URL(confirmationRedirectUrl(token, 'https://dev.app.uva-in.nl')).origin, 'https://dev.app.uva-in.nl')
})

test('returning from a separate browser automatically shows success or failure, without shared storage', async () => {
  for (const status of ['success', 'error', 'registration_error', 'email_change_error']) {
    let current = 'pending', calls = 0
    const f = monitor(async value => { assert.equal(value, token); calls++; return { status: current } })
    await flush()
    f.doc.visibilityState = 'hidden'
    current = status
    f.tick()
    assert.equal(calls, 1)
    f.doc.visibilityState = 'visible'
    f.doc.dispatchEvent(new Event('visibilitychange'))
    f.win.dispatchEvent(new Event('focus'))
    await flush()
    assert.deepEqual(f.results, [status])
    assert.equal(calls, 2)
    f.stop()
    assert.equal(f.cleared, true)
  }
})

test('network errors remain pending and retry automatically; stale and unrelated local signals are ignored', async () => {
  let offline = true
  const f = monitor(async () => { if (offline) throw new Error('offline'); return { status: 'success' } })
  await flush()
  for (const result of [{ returnToken: otherToken, status: 'success', at: Date.now() }, { returnToken: token, status: 'error', at: Date.now() - 3600001 }]) {
    f.store(result)
    const event = new Event('storage'); event.key = CONFIRMATION_EVENT_KEY; f.win.dispatchEvent(event)
  }
  assert.deepEqual(f.results, [])
  offline = false
  f.tick()
  await flush()
  assert.deepEqual(f.results, ['success'])
  f.stop()
})

test('a response arriving after email editing or unmount cannot update the next attempt', async () => {
  let resolve
  const f = monitor(() => new Promise(done => { resolve = done }))
  f.stop()
  resolve({ status: 'success' })
  await flush()
  f.win.dispatchEvent(new Event('focus'))
  assert.deepEqual(f.results, [])
})

test('a resent link can replace a failed result with success automatically', async () => {
  let status = 'error'
  const f = monitor(async () => ({ status }))
  await flush()
  status = 'success'
  f.tick()
  await flush()
  assert.deepEqual(f.results, ['error', 'success'])
  f.stop()
})

test('signup, correction and resend all include the attempt token without putting email or password in the redirect', async () => {
  let signup, correction, resend
  const supabase = {
    auth: {
      signUp: async body => { signup = body; return { data: { user: { id: 'synthetic', identities: [{}] } }, error: null } },
      resend: async body => { resend = body; return { error: null } },
    },
    functions: { invoke: async (_, body) => { correction = body.body; return { data: { success: true }, error: null } } },
  }
  const context = { supabase, getCaptchaOptions: () => ({}), confirmationRedirectUrl, env: {}, URL }
  for (const file of ['memberRepository.js', 'authRepository.js']) {
    const source = (await readFile(new URL('../src/api/' + file, import.meta.url), 'utf8'))
      .replace(/^import .*\r?\n/gm, '').replace(/\bexport /g, '').replaceAll('import.meta.env', 'env')
    vm.runInNewContext(source, context)
  }
  await context.registerMember({ email: 'synthetic@example.invalid', password: 'unused-password', returnToken: token })
  await context.changeUnconfirmedRegistrationEmail({ currentEmail: 'old@example.invalid', newEmail: 'synthetic@example.invalid', password: 'unused-password', returnToken: token })
  await context.resendConfirmationEmail('synthetic@example.invalid', '', token)
  assert.equal(correction.returnToken, token)
  for (const url of [signup.options.emailRedirectTo, resend.options.emailRedirectTo]) {
    assert.equal(new URL(url).searchParams.get('returnToken'), token)
    assert.equal(url.includes('synthetic'), false)
    assert.equal(url.includes('password'), false)
  }
})

const handlerSource = stripTypeScriptTypes((await readFile(new URL('../supabase/functions/email-confirmation-return-signal/index.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, ''))
async function signalHandler({ rateLimited = false } = {}) {
  const rows = new Map()
  let handler
  const admin = {
    // Any accidental Auth access fails this test instead of authenticating.
    rpc: async () => ({ data: !rateLimited, error: null }),
    from: table => {
      assert.equal(table, 'email_confirmation_return_signals')
      let key, after
      const q = {
        delete: () => q,
        lt: async (_, before) => { for (const [key, row] of rows) if (row.expires_at < before) rows.delete(key); return { error: null } },
        upsert: async row => { rows.set(row.token_hash, row); return { error: null } },
        select: () => q, eq: (_, value) => { key = value; return q },
        gt: (_, value) => { after = value; return q },
        maybeSingle: async () => ({ data: rows.get(key)?.expires_at > after ? { status: rows.get(key).status } : null, error: null }),
      }
      return q
    },
  }
  vm.runInNewContext(handlerSource, {
    Deno: { serve: fn => { handler = fn }, env: { get: () => 'synthetic' } },
    createClient: () => admin, getCorsHeaders: () => ({}), isAllowedCorsOrigin: origin => origin !== 'https://evil.invalid',
    getSupabaseServiceKey: () => 'synthetic', apiKeyOnlyFetch: () => undefined,
    readJsonBody: req => req.json(), crypto: webcrypto, TextEncoder, Response, Date, console: { error() {} },
  })
  return { rows, send: async (body, headers = {}) => {
    const response = await handler(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(body) }))
    return { status: response.status, data: await response.json() }
  } }
}

test('handoff isolates attempts, hashes tokens, expires results, and never reads or mutates Auth', async () => {
  const f = await signalHandler()
  assert.deepEqual((await f.send({ action: 'check', token })).data, { status: 'pending' })
  assert.equal((await f.send({ action: 'complete', token, status: 'success' })).status, 200)
  assert.deepEqual((await f.send({ action: 'check', token })).data, { status: 'success' })
  assert.deepEqual((await f.send({ action: 'check', token: otherToken })).data, { status: 'pending' })
  assert.ok(!f.rows.has(token))
  for (const row of f.rows.values()) row.expires_at = '2000-01-01T00:00:00Z'
  assert.deepEqual((await f.send({ action: 'check', token })).data, { status: 'pending' })
  assert.equal(f.rows.size, 0)
})

test('handoff rejects malformed capabilities, unknown statuses, foreign origins and excessive requests', async () => {
  const f = await signalHandler()
  for (const body of [null, { action: 'complete', token: 'email@example.invalid', status: 'success' }, { action: 'complete', token, status: 'signed_in' }]) {
    assert.equal((await f.send(body)).status, 400)
  }
  assert.equal((await f.send({ action: 'check', token }, { Origin: 'https://evil.invalid' })).status, 403)
  assert.equal((await (await signalHandler({ rateLimited: true })).send({ action: 'check', token })).status, 429)
})
