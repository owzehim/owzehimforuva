import test from 'node:test'
import assert from 'node:assert/strict'
import { getCorsHeaders, isAllowedCorsOrigin } from '../supabase/functions/_shared/cors.js'

test('CORS echoes only the configured exact app origin', () => {
  const headers = getCorsHeaders('https://app.uva-in.nl')
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://app.uva-in.nl')
  assert.equal(headers.Vary, 'Origin')
})

test('CORS accepts exact project-configured preview origins', () => {
  const origin = 'https://owzehim-git-security-fix-example.vercel.app'
  const configuredOrigins = 'https://dev.example.test, https://owzehim-git-security-fix-example.vercel.app '
  assert.equal(isAllowedCorsOrigin(origin, configuredOrigins), true)
  assert.equal(getCorsHeaders(origin, configuredOrigins)['Access-Control-Allow-Origin'], origin)
})

test('CORS rejects unlisted origins and lookalike hostnames', () => {
  for (const origin of [
    'https://attacker.example',
    'https://app.uva-in.nl.attacker.example',
    'null',
  ]) {
    assert.equal(isAllowedCorsOrigin(origin), false)
    assert.equal(getCorsHeaders(origin)['Access-Control-Allow-Origin'], undefined)
  }
})

test('server-to-server requests without Origin remain supported', () => {
  assert.equal(isAllowedCorsOrigin(null), true)
  assert.equal(getCorsHeaders(null)['Access-Control-Allow-Origin'], undefined)
})
