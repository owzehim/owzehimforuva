// FUNC-14: pure builder for a review's Sheet rows (tested with node --test).
// Used by sync-to-sheets for the first send and by the retry job, so a
// re-sent row is built exactly like the original one.
import { sheetText } from './sheetText.js'
import { REVIEW_TAG_SLOTS, reviewCriteriaForSheet } from './reviewCriteriaSheet.js'

const VALID_TAGS = new Set(REVIEW_TAG_SLOTS)

function amsterdamDate(date) {
  return date.toLocaleDateString('en-GB', { timeZone: 'Europe/Amsterdam' })
}

/**
 * review: { rating, tags, created_at }; placeCriteria: restaurants.review_criteria.
 * The submitted date/time is the review's own, so a retry does not change it.
 */
export function buildReviewSheetPayloads({ storeId, partnership, redemptionId, review, placeCriteria, now = new Date() }) {
  const rating = Number(review.rating)
  const tags = Array.isArray(review.tags)
    ? review.tags.filter((tag) => typeof tag === 'string' && VALID_TAGS.has(tag)).slice(0, 4)
    : []
  const { criteria, tag_labels } = reviewCriteriaForSheet(placeCriteria ?? null, tags)
  const createdAt = review.created_at ? new Date(review.created_at) : null
  const submittedAt = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : now

  const master = {
    type: 'review',
    partnership_id: storeId,
    sheet_name: sheetText(partnership?.sheet_name || partnership?.name || storeId, 160),
    redemption_id: String(redemptionId),
    rating,
    tags,
    criteria,
    tag_labels,
    // GDPR-14 (option A): the free-text comment stays in the App database.
    // Sending it empty also clears a comment written by an older version.
    comment: '',
    review_submitted_at_date: amsterdamDate(submittedAt),
    review_submitted_at_time: submittedAt.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
    }),
  }
  // The partner's Operations tab: rating and tags for that visit only.
  const partner = {
    type: 'review',
    partnership_id: storeId,
    redemption_id: String(redemptionId),
    rating,
    tags,
    criteria,
    tag_labels,
    review_submitted_at_date: amsterdamDate(submittedAt),
  }
  return { master, partner }
}
