// LEG-02: UvA-IN says clearly that it is not part of or affiliated with the University of Amsterdam.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { legalDocuments } from '../src/content/legalDocuments.js'

test('terms and privacy policy state that UvA-IN is not affiliated with the university', () => {
  for (const key of ['terms', 'privacy']) {
    assert.ok(legalDocuments[key].body.includes('not part of, recognised by or affiliated with the University of Amsterdam'), key)
    assert.ok(legalDocuments[key].ko.body.includes('대학교와 제휴한 단체가 아니고'), key + ' ko')
    assert.ok(!legalDocuments[key].ko.body.includes('학생회'), key + ' ko uses 학생회')
  }
})

test('public page does not call the community UvA-exclusive and shows the notice', () => {
  const page = readFileSync('src/pages/PublicPage.jsx', 'utf8')
  assert.ok(!page.includes('UvA 학생 전용'))
  assert.ok(page.includes('암스테르담 대학교(UvA)의 공식 단체가 아니며 대학교와 제휴 관계가 없습니다.'))
})
