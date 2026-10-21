import test from 'node:test'
import assert from 'node:assert/strict'
import { hasRecentAuthTime } from '../supabase/functions/_shared/recentAuth.js'

const NOW = 1_800_000_000_000

test('allows account deletion only after authentication within ten minutes', () => {
  assert.equal(hasRecentAuthTime({ auth_time: NOW / 1000 - 600 }, NOW), true)
  assert.equal(hasRecentAuthTime({ auth_time: NOW / 1000 - 601 }, NOW), false)
  assert.equal(hasRecentAuthTime({}, NOW), false)
  assert.equal(hasRecentAuthTime({ auth_time: '1800000000' }, NOW), false)
})

test('allows small clock skew but rejects future authentication timestamps', () => {
  assert.equal(hasRecentAuthTime({ auth_time: NOW / 1000 + 60 }, NOW), true)
  assert.equal(hasRecentAuthTime({ auth_time: NOW / 1000 + 61 }, NOW), false)
})
