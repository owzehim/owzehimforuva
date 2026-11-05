// OPS-04: stamp counting rules shown to members and staff.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStampState,
  didRedeemRewardForCurrentScan,
  getScanResultIdentity,
} from '../src/features/stampCard/utils.js'

const visits = (count, cycleOf = (index) => Math.floor(index / 5) + 1) =>
  Array.from({ length: count }, (_, index) => ({ id: `v${index}`, card_cycle: cycleOf(index) }))

test('an empty card starts at cycle 1 with no stamps', () => {
  const state = computeStampState([], 5)
  assert.equal(state.currentCycle, 1)
  assert.equal(state.stampsInCurrentCycle, 0)
  assert.equal(state.hasPendingReward, false)
})

test('stamps count within the current cycle', () => {
  const state = computeStampState(visits(3), 5)
  assert.equal(state.currentCycle, 1)
  assert.equal(state.stampsInCurrentCycle, 3)
  assert.equal(state.currentCycleVisits.length, 3)
})

test('a redeemed full card starts the next cycle empty', () => {
  const state = computeStampState(visits(5), 5)
  assert.equal(state.currentCycle, 2)
  assert.equal(state.stampsInCurrentCycle, 0)
  assert.equal(state.isCardFull, false)
})

test('a pending reward shows a full card for that reward cycle', () => {
  const reward = { id: 'r1', card_cycle: 1, redeemed: false }
  const state = computeStampState(visits(5), 5, reward)
  assert.equal(state.isCardFull, true)
  assert.equal(state.hasPendingReward, true)
  assert.equal(state.stampsInCurrentCycle, 5)
  assert.equal(state.currentCycle, 1)
  assert.equal(state.currentCycleVisits.length, 5)
})

test('a reward claim belongs only to the scan it was made on', () => {
  const scan = { redemptionId: 'abc' }
  assert.equal(getScanResultIdentity(scan), 'abc')
  assert.equal(didRedeemRewardForCurrentScan(scan, 'abc'), true)
  assert.equal(didRedeemRewardForCurrentScan(scan, 'other'), false)
  assert.equal(didRedeemRewardForCurrentScan(scan, null), false)
  assert.equal(didRedeemRewardForCurrentScan(null, 'abc'), false)
})
