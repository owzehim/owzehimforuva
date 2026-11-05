import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  didRedeemRewardForCurrentScan,
  getScanResultIdentity,
} from '../src/features/stampCard/utils.js'

test('a reward is suppressed only for the scan where it was redeemed', () => {
  const firstScan = { redemptionId: 'redemption-1' }
  const nextScan = { redemptionId: 'redemption-2' }

  assert.equal(getScanResultIdentity(firstScan), 'redemption-1')
  assert.equal(didRedeemRewardForCurrentScan(firstScan, 'redemption-1'), true)
  assert.equal(didRedeemRewardForCurrentScan(nextScan, 'redemption-1'), false)
  assert.equal(didRedeemRewardForCurrentScan(null, 'redemption-1'), false)
})

test('scan objects without a redemption id use object identity safely', () => {
  const scanResult = { storeId: 'store-1' }

  assert.equal(didRedeemRewardForCurrentScan(scanResult, scanResult), true)
  assert.equal(didRedeemRewardForCurrentScan({ ...scanResult }, scanResult), false)
})
