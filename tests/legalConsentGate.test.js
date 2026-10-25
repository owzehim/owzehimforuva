import test from 'node:test'
import assert from 'node:assert/strict'
import { hasCurrentLegalConsent, getRequiredLegalDocuments } from '../src/domain/legalConsent.js'

test('current consent requires all three documents at the required version', () => {
  const version = '2026-10-24-07'
  const receipts = getRequiredLegalDocuments().map((document_key) => ({
    document_key,
    document_version: version,
  }))

  assert.equal(hasCurrentLegalConsent(receipts, version), true)
})

test('old or incomplete receipts require the updated consent screen', () => {
  const receipts = [
    { document_key: 'terms', document_version: '2026-10-24-07' },
    { document_key: 'privacy', document_version: '2026-10-24-06' },
    { document_key: 'community', document_version: '2026-10-24-07' },
  ]

  assert.equal(hasCurrentLegalConsent(receipts, '2026-10-24-07'), false)
  assert.equal(hasCurrentLegalConsent([], '2026-10-24-07'), false)
})
