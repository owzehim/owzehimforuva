// LEG-02: UvA-IN says clearly that it is not an official University of Amsterdam organisation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { legalDocuments } from '../src/content/legalDocuments.js'

test('terms and privacy policy state that UvA-IN is not an official university organisation', () => {
  for (const key of ['terms', 'privacy']) {
    assert.ok(legalDocuments[key].body.includes('UvA-IN is not an official university organisation, and the university is not responsible for the App or its content.'), key)
    assert.ok(legalDocuments[key].ko.body.includes('대학교의 공식 단체가 아닙니다. 대학교는 이 앱과 그 콘텐츠에 대해 책임지지 않습니다.'), key + ' ko')
    assert.ok(!legalDocuments[key].ko.body.includes('학생회'), key + ' ko uses 학생회')
  }
})

test('public page does not call the community UvA-exclusive', () => {
  const page = readFileSync('src/pages/PublicPage.jsx', 'utf8')
  assert.ok(!page.includes('UvA 학생 전용'))
})

test('LEG-02: the not-affiliated statement lives in the Terms and Privacy Policy, not on the public page', () => {
  const page = readFileSync('src/pages/PublicPage.jsx', 'utf8')
  // The unused MembershipTab component that used to hold the line is gone.
  assert.ok(!page.includes('function MembershipTab('))
  // UvA-IN decided (2026-11-12) not to show the line under the public carousel.
  assert.ok(!page.includes('membership-not-affiliated'))
})
