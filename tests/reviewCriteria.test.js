import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_REVIEW_CRITERIA,
  criteriaEqual,
  getPlaceReviewCriteria,
  normalizeReviewCriteria,
  tagsToPlaceLabels,
} from '../src/domain/reviewCriteria.js'
import { reviewCriteriaForSheet } from '../supabase/functions/_shared/reviewCriteriaSheet.js'
import { searchIconNames } from '../src/components/icons/iconKeywords.js'

const CAFE = [
  { label: '커피 맛', icon: 'Coffee' },
  { label: '공부하기 좋아요', icon: 'Armchair' },
  { label: '와이파이', icon: 'WifiHigh' },
  { label: '가성비', icon: 'CoinVertical' },
]

test('멤버 평가: places without criteria keep the restaurant set and tag keys', () => {
  const criteria = getPlaceReviewCriteria({})
  assert.deepEqual(criteria.map((c) => c.key), ['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE'])
  assert.deepEqual(criteria.map((c) => c.label), DEFAULT_REVIEW_CRITERIA.map((c) => c.label))
  assert.equal(criteria[0].icon, 'BowlSteam')
})

test('멤버 평가: custom criteria rename the same 4 slots', () => {
  const criteria = getPlaceReviewCriteria({ review_criteria: CAFE })
  assert.equal(criteria[0].key, 'GREAT_FOOD')
  assert.equal(criteria[0].label, '커피 맛')
  assert.equal(criteria[2].icon, 'WifiHigh')
  assert.equal(tagsToPlaceLabels(['NICE_ATMOSPHERE', 'GREAT_FOOD'], criteria), '커피 맛, 와이파이')
})

test('멤버 평가: stored criteria are cleaned', () => {
  assert.equal(normalizeReviewCriteria(null), null)
  assert.equal(normalizeReviewCriteria([{ label: 'a', icon: 'Coffee' }]), null)
  assert.equal(normalizeReviewCriteria(DEFAULT_REVIEW_CRITERIA), null, 'same as default is stored as null')
  const cleaned = normalizeReviewCriteria([
    { label: '  아주아주아주아주 긴 이름입니다 정말로  ', icon: '<svg>' },
    { label: '', icon: 'Coffee' },
    { label: '와이파이', icon: 'WifiHigh' },
    { label: '가성비', icon: 'javascript:alert(1)' },
  ])
  assert.equal(cleaned[0].label.length, 16)
  assert.equal(cleaned[0].icon, 'BowlSteam')
  assert.equal(cleaned[1].label, DEFAULT_REVIEW_CRITERIA[1].label)
  assert.equal(cleaned[3].icon, 'CoinVertical')
  assert.ok(criteriaEqual(null, DEFAULT_REVIEW_CRITERIA))
  assert.ok(!criteriaEqual(null, CAFE))
  assert.ok(criteriaEqual(CAFE, CAFE.map((c) => ({ ...c }))))
})

test('멤버 평가: sheets get the place names for the 4 tag columns', () => {
  assert.deepEqual(reviewCriteriaForSheet(null, ['GOOD_VALUE', 'GREAT_FOOD']), {
    criteria: ['Great food', 'Friendly staff', 'Nice atmosphere', 'Good value'],
    tag_labels: 'Great food, Good value',
  })
  const cafe = reviewCriteriaForSheet(CAFE, ['NICE_ATMOSPHERE'])
  assert.deepEqual(cafe.criteria, ['커피 맛', '공부하기 좋아요', '와이파이', '가성비'])
  assert.equal(cafe.tag_labels, '와이파이')
  const formula = reviewCriteriaForSheet([{ label: '=HYPERLINK("x")' }, CAFE[1], CAFE[2], CAFE[3]], ['GREAT_FOOD'])
  assert.equal(formula.criteria[0], `'=HYPERLINK("x")`)
})

test('멤버 평가: icon search finds Korean words and English names', () => {
  const all = ['Armchair', 'Coffee', 'CoffeeBean', 'WifiHigh', 'WifiLow', 'Chair', 'Star']
  assert.deepEqual(searchIconNames('커피', all).slice(0, 2), ['Coffee', 'CoffeeBean'])
  assert.deepEqual(searchIconNames('wifi', all), ['WifiHigh', 'WifiLow'])
  assert.ok(searchIconNames('의자', all).includes('Armchair'))
  assert.equal(searchIconNames('', all).length, all.length)
})

test('멤버 평가: DB resets counts when criteria change; sheet sync and app use the place criteria', async () => {
  const sql = await readFile('supabase/migrations/20261111090000_place_review_criteria.sql', 'utf8')
  assert.match(sql, /NEW\.review_criteria IS DISTINCT FROM OLD\.review_criteria THEN\s+NEW\.review_criteria_since := now\(\)/)
  assert.match(sql, /NEW\.review_criteria_since := OLD\.review_criteria_since/)
  assert.match(sql, /review\.created_at >= criteria_reset\.since/)
  assert.match(sql, /jsonb_array_length\(review_criteria\) = 4/)
  // FUNC-14: review rows are built in one place for the first send and retries.
  const fn = await readFile('supabase/functions/_shared/reviewSheetPayload.js', 'utf8')
  assert.match(fn, /reviewCriteriaForSheet\(/)
  assert.equal((fn.match(/tag_labels,/g) || []).length, 2, 'master and partner payloads')
  const gs = await readFile('scripts/apps-script/partner-owner.gs', 'utf8')
  assert.match(gs, /labelReviewCriteriaColumns\(sheet, data\.criteria\)/)
  const modal = await readFile('src/components/ReviewModal.jsx', 'utf8')
  assert.match(modal, /criteria\.map\(\(tag\) =>/)
  const card = await readFile('src/components/SpotCard.jsx', 'utf8')
  assert.equal((card.match(/criteria=\{placeCriteria\}/g) || []).length, 2)
})
