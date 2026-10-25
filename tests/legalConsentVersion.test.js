import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_LEGAL_DOCUMENT_VERSION,
  getConsentReceiptRows,
} from '../supabase/functions/_shared/legalConsent.js'
import { LEGAL_DOCUMENT_VERSION } from '../src/content/legalDocuments.js'

test('consent receipts preserve the version the member actually accepted', () => {
  const rows = getConsentReceiptRows('user-1', {
    privacy_policy_version: '2026-10-24-04',
    legal_documents: {
      terms: '2026-10-24-04',
      privacy: '2026-10-24-04',
      community: '2026-10-24-04',
    },
  }, '2026-10-24T10:00:00.000Z')

  assert.equal(CURRENT_LEGAL_DOCUMENT_VERSION, '2026-10-24-07')
  assert.equal(LEGAL_DOCUMENT_VERSION, CURRENT_LEGAL_DOCUMENT_VERSION)
  assert.deepEqual(rows.map((row) => row.document_version), [
    '2026-10-24-04',
    '2026-10-24-04',
    '2026-10-24-04',
  ])
})

test('consent receipts still require all three version acknowledgements', () => {
  const rows = getConsentReceiptRows('user-1', {
    privacy_policy_version: '2026-10-24-06',
    legal_documents: { terms: '2026-10-24-06', privacy: '2026-10-24-06' },
  }, '2026-10-24T10:00:00.000Z')

  assert.equal(rows, null)
})
