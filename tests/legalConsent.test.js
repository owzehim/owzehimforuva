import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CURRENT_LEGAL_DOCUMENT_VERSION, getConsentAcceptedAt, getConsentReceiptRows } from '../supabase/functions/_shared/legalConsent.js'

test('preserves the server signup timestamp when a pending account changes email', () => {
  assert.equal(getConsentAcceptedAt(
    { created_at: '2026-10-05T09:00:00.000Z' },
    '2026-10-04T08:00:00.000Z',
  ), '2026-10-04T08:00:00.000Z')
  assert.equal(getConsentAcceptedAt({ created_at: '2026-10-05T09:00:00.000Z' }), '2026-10-05T09:00:00.000Z')
})

test('creates one server-timestamped receipt for each required legal document', () => {
  const acceptedAt = '2026-10-05T07:20:00.000Z'
  const rows = getConsentReceiptRows('user-1', {
    privacy_policy_version: CURRENT_LEGAL_DOCUMENT_VERSION,
    legal_documents: {
      terms: CURRENT_LEGAL_DOCUMENT_VERSION,
      privacy: CURRENT_LEGAL_DOCUMENT_VERSION,
      community: CURRENT_LEGAL_DOCUMENT_VERSION,
    },
  }, acceptedAt)

  assert.deepEqual(rows.map((row) => row.document_key), ['terms', 'privacy', 'community'])
  assert.ok(rows.every((row) => row.user_id === 'user-1' && row.accepted_at === acceptedAt))
})

test('rejects incomplete, unsupported, or legacy versions without proven prior all-checkbox flow', () => {
  assert.equal(getConsentReceiptRows('user-1', { legal_documents: { terms: CURRENT_LEGAL_DOCUMENT_VERSION } }, 'now'), null)
  assert.equal(getConsentReceiptRows('user-1', {
    legal_documents: {
      terms: CURRENT_LEGAL_DOCUMENT_VERSION,
      privacy: 'old-version',
      community: CURRENT_LEGAL_DOCUMENT_VERSION,
    },
  }, 'now'), null)
  assert.equal(getConsentReceiptRows('user-1', {
    privacy_policy_version: 'different-version',
    legal_documents: {
      terms: CURRENT_LEGAL_DOCUMENT_VERSION,
      privacy: CURRENT_LEGAL_DOCUMENT_VERSION,
      community: CURRENT_LEGAL_DOCUMENT_VERSION,
    },
  }, 'now'), null)
  assert.equal(getConsentReceiptRows('user-1', { privacy_policy_version: 'unknown' }, 'now'), null)
})

test('supports pending signups from the previous versioned three-checkbox registration flow', () => {
  const rows = getConsentReceiptRows('user-1', {
    privacy_policy_version: CURRENT_LEGAL_DOCUMENT_VERSION,
  }, 'now')
  assert.equal(rows?.length, 3)
})
