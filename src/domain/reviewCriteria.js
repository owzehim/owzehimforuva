// ─────────────────────────────────────────────────────────────
// 멤버 평가 criteria per place
//
// Reviews always store the same 4 tag slots (REVIEW_TAGS keys). A place can
// rename the slots and choose their Phosphor icons in
// restaurants.review_criteria ([{ label, icon }] × 4). NULL means the
// default restaurant criteria. Changing them resets the public counts
// (handled by the database).
// ─────────────────────────────────────────────────────────────

import { REVIEW_TAGS } from './reviewTypes.js'

export const CRITERIA_LABEL_MAX = 16
const ICON_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{1,40}$/

export const DEFAULT_REVIEW_CRITERIA = REVIEW_TAGS.map((tag) => ({ label: tag.label, icon: tag.icon }))

export function isValidIconName(name) {
  return typeof name === 'string' && ICON_NAME_PATTERN.test(name)
}

/** Cleans stored criteria; returns null when they are missing or unusable (= default). */
export function normalizeReviewCriteria(raw) {
  if (!Array.isArray(raw) || raw.length !== REVIEW_TAGS.length) return null
  const criteria = raw.map((entry, index) => {
    const fallback = DEFAULT_REVIEW_CRITERIA[index]
    const label = typeof entry?.label === 'string'
      ? entry.label.replace(/\s+/g, ' ').trim().slice(0, CRITERIA_LABEL_MAX)
      : ''
    return {
      label: label || fallback.label,
      icon: isValidIconName(entry?.icon) ? entry.icon : fallback.icon,
    }
  })
  return isDefaultCriteria(criteria) ? null : criteria
}

export function isDefaultCriteria(criteria) {
  return !criteria || criteria.every((entry, index) => (
    entry.label === DEFAULT_REVIEW_CRITERIA[index].label && entry.icon === DEFAULT_REVIEW_CRITERIA[index].icon
  ))
}

/**
 * The 4 criteria for a place, each with its stored tag key:
 * [{ key, label, icon, labelEn }]. labelEn is only set for default criteria.
 */
export function getPlaceReviewCriteria(place) {
  const custom = normalizeReviewCriteria(place?.review_criteria)
  return REVIEW_TAGS.map((tag, index) => ({
    key: tag.key,
    label: custom ? custom[index].label : tag.label,
    icon: custom ? custom[index].icon : tag.icon,
    labelEn: custom ? null : tag.labelEn,
  }))
}

/** Labels of the chosen tags in this place's own words, in slot order, e.g. "커피 맛, 와이파이". */
export function tagsToPlaceLabels(tags, criteria) {
  const chosen = new Set(tags || [])
  return criteria
    .filter((entry) => chosen.has(entry.key))
    .map((entry) => entry.label)
    .join(', ')
}

export function criteriaEqual(a, b) {
  const left = normalizeReviewCriteria(a)
  const right = normalizeReviewCriteria(b)
  if (!left || !right) return !left && !right
  return left.every((entry, index) => entry.label === right[index].label && entry.icon === right[index].icon)
}
