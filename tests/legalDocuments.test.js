import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGAL_DOCUMENT_VERSION, legalDocuments } from '../src/content/legalDocuments.js'

test('each legal document has complete English and Korean versions under one version number', () => {
  assert.match(LEGAL_DOCUMENT_VERSION, /^\d{4}-\d{2}-\d{2}-\d+$/)

  for (const key of ['terms', 'privacy', 'community']) {
    const document = legalDocuments[key]
    assert.ok(document.title)
    assert.ok(document.body.length > 1000)
    assert.ok(document.ko?.title)
    assert.ok(document.ko?.effectiveDate)
    assert.ok(document.ko?.body.length > 1000)
    assert.match(document.ko.body, /[가-힣]/)
    assert.ok(document.ko.body.includes('2026년 10월 24일'))
    assert.ok(document.body.includes('The English version is the original and prevails'))
    assert.ok(document.ko.body.includes('영어 원문이 우선합니다'))
  }
})

test('Korean privacy text includes the app privacy sections and contact information', () => {
  const body = legalDocuments.privacy.ko.body
  for (const section of ['1. 개인정보 처리자', '4. 제휴 사업자와 정보 공유', '7. 정보 보유 기간', '10. 회원의 권리', '13. 문의']) {
    assert.ok(body.includes(section), `Missing Korean privacy section: ${section}`)
  }
  assert.ok(body.includes('+31 6 4271 4078'))
})

test('partner ending policy matches between English and Korean documents', () => {
  assert.match(legalDocuments.terms.body, /unredeemed reward connected to that partner expires immediately/i)
  assert.match(legalDocuments.terms.ko.body, /미사용 리워드는 즉시 만료/)
  assert.match(legalDocuments.terms.body, /Reward records are retained for 12 months after the partnership ends/)
  assert.match(legalDocuments.terms.ko.body, /리워드 기록은 제휴 종료 후 12개월간 보관한 뒤 삭제/)
  assert.match(legalDocuments.terms.body, /non-exclusive, royalty-free licence/i)
  assert.match(legalDocuments.terms.body, /Nothing in these Terms excludes or limits liability that cannot be excluded or limited/i)
})
