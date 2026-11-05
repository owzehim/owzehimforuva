import test from 'node:test'
import assert from 'node:assert/strict'
import {
  InvalidRequestBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from '../supabase/functions/_shared/readJsonBody.js'

function requestWithBody(body, headers = {}) {
  return {
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
  }
}

test('reads valid JSON within the byte limit', async () => {
  const body = await readJsonBody(requestWithBody('{"redemption_id":"42"}'), 64)
  assert.deepEqual(body, { redemption_id: '42' })
})

test('enforces the actual streamed size when Content-Length is absent', async () => {
  await assert.rejects(
    readJsonBody(requestWithBody('{"value":"long"}'), 8),
    RequestBodyTooLargeError,
  )
})

test('enforces UTF-8 bytes rather than JavaScript character count', async () => {
  await assert.rejects(
    readJsonBody(requestWithBody('{"x":"한"}'), 9),
    RequestBodyTooLargeError,
  )
})

test('rejects an oversized declared Content-Length before reading the stream', async () => {
  await assert.rejects(
    readJsonBody(requestWithBody('{}', { 'content-length': '100' }), 10),
    RequestBodyTooLargeError,
  )
})

test('rejects malformed JSON', async () => {
  await assert.rejects(
    readJsonBody(requestWithBody('{not-json}'), 64),
    InvalidRequestBodyError,
  )
})
