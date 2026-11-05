import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getStudentNumberRegistrationFields } from '../supabase/functions/_shared/memberStudentNumber.js'

test('registration keeps a self-reported student number pending until admin verification', () => {
  assert.deepEqual(getStudentNumberRegistrationFields('  12345678  '), {
    student_number: null,
    pending_student_number: '12345678',
  })
})

test('registration rejects a missing or oversized student number claim', () => {
  assert.equal(getStudentNumberRegistrationFields('  '), null)
  assert.equal(getStudentNumberRegistrationFields('1'.repeat(81)), null)
})
