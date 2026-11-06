// GDPR-07: purpose and legal basis per type of information.
// LEG-10: grey text stays readable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { legalDocuments } from '../src/content/legalDocuments.js'

test('the privacy policy lists purpose and legal basis per type of information', () => {
  const en = legalDocuments.privacy.body
  const ko = legalDocuments.privacy.ko.body
  assert.ok(en.includes('Purpose and legal basis by type of information:'))
  assert.ok(ko.includes('정보 유형별 이용 목적과 법적 근거:'))
  for (const topic of ['Account and identity information', 'Optional profile information', 'Optional year of birth, country of origin and gender', 'Check-ins, visits, stamps and rewards', 'Reports about content', 'Security, technical and error information']) {
    assert.ok(en.includes(topic), topic)
  }
  assert.equal((en.match(/Article 6\(1\)\([bcf]\)/g) || []).length >= 10, true)
  assert.ok(en.includes('Download my data'))
  assert.ok(ko.includes('내 정보 다운로드'))
})

test('global grey overrides keep light and dark text readable', () => {
  const css = readFileSync('src/index.css', 'utf8')
  assert.match(css, /html:not\(\.dark\) \.text-gray-400 \{\s*color: #6b7280;/)
  assert.match(css, /\.dark \.text-gray-400 \{\s*color: #8e8e93;/)
})

test('inline grey text uses readable colours', () => {
  const scanner = readFileSync('src/components/QRScanner.jsx', 'utf8')
  assert.ok(!scanner.includes('rgba(44,42,39,0.45)'))
  const stampBox = readFileSync('src/features/stampCard/components/ScanPageStampBox.jsx', 'utf8')
  assert.ok(!stampBox.includes("'rgba(255,255,255,0.86)' : '#9ca3af'"))
  const memberPage = readFileSync('src/pages/MemberPage.jsx', 'utf8')
  assert.ok(!memberPage.includes("color: darkMode ? '#6F6F76' : '#9ca3af'"))
})

test('GDPR-16: the policy says the password is not stored, and where it passes through', () => {
  const en = legalDocuments.privacy.body
  const ko = legalDocuments.privacy.ko.body
  assert.ok(!en.includes('does not receive or store your raw password'))
  assert.ok(en.includes('UvA-IN does not store your password.'))
  assert.ok(en.includes('pass the password through our server functions only to complete that action'))
  assert.ok(!ko.includes('비밀번호를 받거나 저장하지 않습니다'))
  assert.ok(ko.includes('UvA-IN은 회원의 비밀번호를 저장하지 않습니다.'))
})
