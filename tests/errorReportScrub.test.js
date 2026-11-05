// OPS-05: error reports must not carry personal data or secrets.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  errorReportingEnvironment,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
} from '../src/lib/errorReportScrub.js'

test('emails, student numbers, ids and tokens are removed from text', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
  const text = `Failed for jane.doe@student.uva.nl (12345678) user 3517c753-c69b-4891-b1ee-441576778d40 ${jwt} sb_secret_abcdefghijklmnop`
  const out = scrubText(text)
  assert.ok(!out.includes('jane.doe'))
  assert.ok(!out.includes('12345678'))
  assert.ok(!out.includes('3517c753'))
  assert.ok(!out.includes('eyJ'))
  assert.ok(!out.includes('sb_secret'))
  assert.match(out, /\[email\].*\[number\].*\[id\].*\[token\].*\[key\]/)
})

test('short numbers such as counts and line numbers are kept', () => {
  assert.equal(scrubText('Stamp 3 of 10 failed at line 42'), 'Stamp 3 of 10 failed at line 42')
})

test('URLs keep only origin and path', () => {
  assert.equal(
    scrubUrl('https://app.uva-in.nl/reset-password?email=a@b.nl#access_token=eyJabc'),
    'https://app.uva-in.nl/reset-password',
  )
  assert.equal(scrubUrl('/member?tab=stamps'), '/member')
})

test('events lose user, request details and extras', () => {
  const event = scrubEvent({
    user: { id: 'u1', email: 'a@b.nl', ip_address: '1.2.3.4' },
    server_name: 'host',
    request: { url: 'https://app.uva-in.nl/scan?store_id=X', headers: { Cookie: 'c' }, cookies: 'c' },
    message: 'Error for a@b.nl',
    exception: { values: [{ type: 'Error', value: 'No member 87654321' }] },
    extra: { member: { first_name: 'Jane' } },
    breadcrumbs: [
      { category: 'console', message: 'jane@x.nl' },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/members?email=eq.a@b.nl', method: 'GET', status_code: 500, body: 'x' } },
    ],
  })
  assert.equal(event.user, undefined)
  assert.equal(event.server_name, undefined)
  assert.deepEqual(event.request, { url: 'https://app.uva-in.nl/scan' })
  assert.equal(event.message, 'Error for [email]')
  assert.equal(event.exception.values[0].value, 'No member [number]')
  assert.equal(event.extra, undefined)
  assert.equal(event.breadcrumbs.length, 1)
  assert.deepEqual(event.breadcrumbs[0].data, { url: 'https://x.supabase.co/rest/v1/members', method: 'GET', status_code: 500 })
})

test('console and input breadcrumbs are dropped', () => {
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'x' }), null)
  assert.equal(scrubBreadcrumb({ category: 'ui.input', message: 'x' }), null)
  assert.ok(scrubBreadcrumb({ category: 'navigation', data: { from: '/a?x=1', to: '/b#t' } }))
})

test('only Vercel previews report until production is approved', () => {
  assert.equal(errorReportingEnvironment('preview', { productionApproved: false }), 'preview')
  assert.equal(errorReportingEnvironment('production', { productionApproved: false }), null)
  assert.equal(errorReportingEnvironment('production', { productionApproved: true }), 'production')
  assert.equal(errorReportingEnvironment('', { productionApproved: true }), null)
  assert.equal(errorReportingEnvironment('development', { productionApproved: true }), null)
})
