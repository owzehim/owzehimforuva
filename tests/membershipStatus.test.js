// OPS-04: who counts as an active member for check-ins and rewards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isMembershipActive } from '../supabase/functions/_shared/membershipStatus.js'

const base = {
  is_member: true,
  account_status: 'active',
  identity_anonymized_at: null,
  membership_valid_until: '2026-11-30',
}
const now = new Date('2026-11-05T12:00:00.000Z')

test('an active member with a future end date is active', () => {
  assert.equal(isMembershipActive(base, now), true)
})

test('the end date itself is still valid (Amsterdam calendar day)', () => {
  assert.equal(isMembershipActive({ ...base, membership_valid_until: '2026-11-05' }, now), true)
  // 23:30 UTC on 5 Nov is already 6 Nov in Amsterdam.
  assert.equal(
    isMembershipActive({ ...base, membership_valid_until: '2026-11-05' }, new Date('2026-11-05T23:30:00.000Z')),
    false,
  )
})

test('expired, inactive, suspended or anonymized members are not active', () => {
  assert.equal(isMembershipActive({ ...base, membership_valid_until: '2026-11-04' }, now), false)
  assert.equal(isMembershipActive({ ...base, is_member: false }, now), false)
  assert.equal(isMembershipActive({ ...base, account_status: 'suspended' }, now), false)
  assert.equal(isMembershipActive({ ...base, identity_anonymized_at: '2026-11-01T00:00:00Z' }, now), false)
})

test('missing or malformed end dates are not active', () => {
  assert.equal(isMembershipActive({ ...base, membership_valid_until: null }, now), false)
  assert.equal(isMembershipActive({ ...base, membership_valid_until: '2026-02-30' }, now), false)
  assert.equal(isMembershipActive({ ...base, membership_valid_until: '30-11-2026' }, now), false)
  assert.equal(isMembershipActive(null, now), false)
})
