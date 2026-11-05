import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeGenderForDb, validateRegistrationForm } from '../src/domain/member/memberRegistration.js'

test('registration accepts omitted optional demographic fields', () => {
  assert.equal(validateRegistrationForm({
    firstName: 'Test',
    lastName: 'Member',
    email: 'test@example.org',
    studentNumber: '12345678',
    educationLevel: 'alumni',
    yearNumber: null,
  }), '')
  assert.equal(normalizeGenderForDb(''), null)
})

test('supported gender answers map to database enum values', () => {
  assert.equal(normalizeGenderForDb('non-binary'), 'non_binary')
  assert.equal(normalizeGenderForDb('prefer not to say'), 'prefer_not_to_say')
  assert.equal(normalizeGenderForDb('unrecognized'), null)
})
