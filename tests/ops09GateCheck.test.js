// OPS-09 gate check: this test fails on purpose. A PR containing it must not
// be mergeable into main. Delete this branch after the check.
import test from 'node:test'
import assert from 'node:assert/strict'

test('OPS-09: intentionally failing test (must block the merge)', () => {
  assert.equal(1, 2)
})
