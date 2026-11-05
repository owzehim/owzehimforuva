import assert from 'node:assert/strict'
import test from 'node:test'
import { apiKeyOnlyFetch } from '../supabase/functions/_shared/apiKeyOnlyFetch.js'

async function captureFetch(key, authorization) {
  const originalFetch = globalThis.fetch
  let capturedRequest
  globalThis.fetch = async (input, init) => {
    capturedRequest = new Request(input, init)
    return new Response('ok')
  }

  try {
    const headers = { apikey: key }
    if (authorization) headers.Authorization = authorization
    await apiKeyOnlyFetch(key)('https://example.test/resource', { headers })
    return capturedRequest.headers
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('new Supabase secret keys remain in apikey and are not sent as bearer JWTs', async () => {
  const secretKey = 'sb_secret_example'
  const headers = await captureFetch(secretKey, `Bearer ${secretKey}`)

  assert.equal(headers.get('apikey'), secretKey)
  assert.equal(headers.has('Authorization'), false)
})

test('user bearer authorization is preserved when the SDK key is a secret key', async () => {
  const secretKey = 'sb_secret_example'
  const userToken = 'eyJ.user-token.signature'
  const headers = await captureFetch(secretKey, `Bearer ${userToken}`)

  assert.equal(headers.get('apikey'), secretKey)
  assert.equal(headers.get('Authorization'), `Bearer ${userToken}`)
})
