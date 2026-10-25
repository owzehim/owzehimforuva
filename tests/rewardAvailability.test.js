import test from 'node:test'
import assert from 'node:assert/strict'
import { isPendingRewardAvailable } from '../src/features/stampCard/rewardAvailability.js'

const now = new Date('2026-10-24T12:00:00.000Z')

test('active unredeemed rewards remain available', () => {
  assert.equal(isPendingRewardAvailable({ redeemed: false }, now), true)
  assert.equal(isPendingRewardAvailable({ redeemed: false, expires_at: '2026-10-24T12:01:00.000Z' }, now), true)
})

test('redeemed, expired, and invalid-date rewards are not available', () => {
  assert.equal(isPendingRewardAvailable({ redeemed: true }, now), false)
  assert.equal(isPendingRewardAvailable({ redeemed: false, expires_at: '2026-10-24T11:59:59.000Z' }, now), false)
  assert.equal(isPendingRewardAvailable({ redeemed: false, expires_at: 'invalid' }, now), false)
  assert.equal(isPendingRewardAvailable(null, now), false)
})
