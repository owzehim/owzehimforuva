import assert from 'node:assert/strict'
import test from 'node:test'

let projectRef = 'smesebnighdcwqcgokhg'
globalThis.Deno = {
  env: {
    get(name) {
      return name === 'SUPABASE_URL' ? `https://${projectRef}.supabase.co` : ''
    },
  },
}

const { isAllowedCorsOrigin } = await import('../supabase/functions/_shared/cors.js')

test('keeps DEV and production browser origins separate', () => {
  assert.equal(isAllowedCorsOrigin('http://localhost:5173'), true)
  assert.equal(isAllowedCorsOrigin('https://app.uva-in.nl'), false)

  projectRef = 'npvcghdzrtqrlliprtnw'
  assert.equal(isAllowedCorsOrigin('https://app.uva-in.nl'), true)
  assert.equal(isAllowedCorsOrigin('https://uvain-app.vercel.app'), true)
  assert.equal(isAllowedCorsOrigin('http://localhost:5173'), false)
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', 'http://localhost:5173'), false)
})
