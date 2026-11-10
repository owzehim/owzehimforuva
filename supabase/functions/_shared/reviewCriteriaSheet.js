import { sheetText } from './sheetText.js'

// The 4 review tag slots, in sheet column order. Default names match the
// English labels already written to the sheets.
export const REVIEW_TAG_SLOTS = ['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE']
export const DEFAULT_CRITERIA_SHEET_LABELS = ['Great food', 'Friendly staff', 'Nice atmosphere', 'Good value']

/**
 * Names of a place's 4 멤버 평가 criteria for the sheets, plus the chosen
 * tags written out in those names (e.g. "커피 맛, 와이파이").
 * placeCriteria is restaurants.review_criteria (null = default criteria).
 */
export function reviewCriteriaForSheet(placeCriteria, tags) {
  const custom = Array.isArray(placeCriteria) && placeCriteria.length === 4
  const criteria = REVIEW_TAG_SLOTS.map((_, index) => {
    const label = custom && typeof placeCriteria[index]?.label === 'string'
      ? placeCriteria[index].label.replace(/\s+/g, ' ').trim().slice(0, 40)
      : ''
    return sheetText(label || DEFAULT_CRITERIA_SHEET_LABELS[index], 40)
  })
  const chosen = new Set(Array.isArray(tags) ? tags : [])
  const tagLabels = REVIEW_TAG_SLOTS
    .map((slot, index) => (chosen.has(slot) ? criteria[index] : null))
    .filter(Boolean)
    .join(', ')
  return { criteria, tag_labels: sheetText(tagLabels, 200) }
}
