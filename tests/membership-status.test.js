import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarDateInTimeZone, isMembershipActive } from '../supabase/functions/_shared/membershipStatus.js'

const activeMember = {
  is_member: true,
  account_status: 'active',
  identity_anonymized_at: null,
  membership_valid_until: '2026-10-05',
}

test('membership validity includes the entire Amsterdam expiry date', () => {
  assert.equal(isMembershipActive(activeMember, new Date('2026-10-05T00:30:00.000Z')), true)
  assert.equal(isMembershipActive(activeMember, new Date('2026-10-05T21:59:59.999Z')), true)
  assert.equal(isMembershipActive(activeMember, new Date('2026-10-05T22:00:00.000Z')), false)
})

test('Amsterdam date conversion respects winter and summer offsets', () => {
  assert.equal(calendarDateInTimeZone(new Date('2026-10-04T22:00:00.000Z'), 'Europe/Amsterdam'), '2026-10-05')
  assert.equal(calendarDateInTimeZone(new Date('2026-01-01T23:00:00.000Z'), 'Europe/Amsterdam'), '2026-01-02')
})

test('membership requires an active, identified member and a valid ISO date', () => {
  assert.equal(isMembershipActive({ ...activeMember, is_member: false }), false)
  assert.equal(isMembershipActive({ ...activeMember, account_status: 'expired' }), false)
  assert.equal(isMembershipActive({ ...activeMember, identity_anonymized_at: '2026-01-01T00:00:00Z' }), false)
  assert.equal(isMembershipActive({ ...activeMember, membership_valid_until: '2026-02-30' }, new Date('2026-01-01T12:00:00Z')), false)
  assert.equal(isMembershipActive({ ...activeMember, membership_valid_until: null }, new Date('2026-01-01T12:00:00Z')), false)
})
