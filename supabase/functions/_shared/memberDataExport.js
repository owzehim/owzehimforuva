// GDPR-04 (right of access, Art. 15 / portability, Art. 20): what a member gets
// when they download their own data. Explicit columns per table: everything
// about the member, but no internal secrets (session tokens, sheet
// references) and no other person's details (for example who reported them).

export const MEMBER_EXPORT_SECTIONS = [
  {
    key: 'profile',
    table: 'members',
    filter: 'user_id',
    single: true,
    columns: 'first_name, last_name, first_name_korean, last_name_korean, username, student_number, pending_student_number, University, education_level, year_number, major, year_of_birth, country_of_origin, gender, profile_image_url, is_member, membership_valid_until, membership_ended_at, account_status, identity_anonymized_at, privacy_policy_version, privacy_accepted_at, tutorial_completed_at, created_at',
  },
  { key: 'statistics_profile', table: 'member_analytics_profiles', filter: 'user_id', single: true, columns: 'university, region_of_origin, faculty_group, study_stage, age_group, gender, created_at, updated_at' },
  { key: 'legal_consents', table: 'legal_consent_receipts', filter: 'user_id', columns: 'document_key, document_version, accepted_at', order: 'accepted_at' },
  { key: 'check_ins', table: 'redemptions', filter: 'user_id', columns: 'id, store_id, redeemed_at', order: 'redeemed_at' },
  { key: 'stamps', table: 'stamp_card_visits', filter: 'user_id', columns: 'restaurant_id, visited_at, card_cycle, added_by_admin, admin_note', order: 'visited_at' },
  { key: 'rewards', table: 'stamp_card_rewards', filter: 'user_id', columns: 'restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at', order: 'created_at' },
  { key: 'archived_stamps', table: 'stamp_card_visits_archive', filter: 'user_id', columns: 'restaurant_id, visited_at, card_cycle, added_by_admin, admin_note, archived_at, delete_after', order: 'visited_at' },
  { key: 'archived_rewards', table: 'stamp_card_rewards_archive', filter: 'user_id', columns: 'restaurant_id, card_cycle, redeemed, redeemed_at, created_at, archived_at, delete_after', order: 'created_at' },
  { key: 'reviews', table: 'reviews', filter: 'user_id', columns: 'store_id, rating, tags, comment, created_at', order: 'created_at' },
  { key: 'review_prompts', table: 'review_prompts', filter: 'user_id', columns: 'store_id, prompt_at, status, created_at', order: 'created_at' },
  { key: 'notes', table: 'restaurant_notes', filter: 'user_id', columns: 'restaurant_id, username, is_anonymous, body, source_rating, source_tags, hidden_at, created_at, updated_at', order: 'created_at' },
  { key: 'comments', table: 'restaurant_comments', filter: 'user_id', columns: 'restaurant_id, username, is_anonymous, body, created_at, updated_at', order: 'created_at' },
  { key: 'reports_you_made', table: 'restaurant_note_reports', filter: 'reporter_id', columns: 'created_at, reason, explanation, good_faith, note_snapshot, restaurant_name_snapshot, status, decision, reviewed_at', order: 'created_at' },
  { key: 'comment_reports_you_made', table: 'restaurant_comment_reports', filter: 'reporter_id', columns: 'created_at, reviewed_at', order: 'created_at' },
  { key: 'reports_about_your_notes', table: 'restaurant_note_reports', filter: 'content_author_id', columns: 'created_at, reason, note_snapshot, restaurant_name_snapshot, status, decision, reviewed_at', order: 'created_at' },
  { key: 'pending_email_change', table: 'pending_email_changes', filter: 'old_user_id', columns: 'new_email, state, created_at', order: 'created_at' },
]

// GDPR-24: the API returns at most 1,000 rows per request, so lists are read
// page by page instead of being cut off silently.
export const EXPORT_PAGE_SIZE = 1000

/** Collect one member's data with the service-role client. Throws on errors. */
export async function collectMemberData(admin, userId, pageSize = EXPORT_PAGE_SIZE) {
  const data = {}
  for (const section of MEMBER_EXPORT_SECTIONS) {
    const buildQuery = () => {
      let query = admin.from(section.table).select(section.columns).eq(section.filter, userId)
      if (section.order) query = query.order(section.order, { ascending: true })
      return query
    }
    if (section.single) {
      const { data: row, error } = await buildQuery().maybeSingle()
      if (error) throw new Error(`Export of ${section.key} failed`)
      data[section.key] = row ?? null
      continue
    }
    const rows = []
    for (let from = 0; ; from += pageSize) {
      const { data: page, error } = await buildQuery().range(from, from + pageSize - 1)
      if (error) throw new Error(`Export of ${section.key} failed`)
      rows.push(...(page || []))
      if (!page || page.length < pageSize) break
    }
    data[section.key] = rows
  }
  return data
}

/** Account sign-up details kept by Auth, without anything secret-looking. */
export function exportableAuthMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const SECRET_KEY = /token|secret|password|hash|otp/i
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, inner]) => [key, clean(inner)]))
    }
    return value
  }
  return clean(metadata)
}

/** Names for the places referenced in the export, so the file is readable. */
export function referencedPlaceIds(data) {
  const ids = new Set()
  for (const key of ['stamps', 'rewards', 'archived_stamps', 'archived_rewards', 'notes', 'comments']) {
    for (const row of data[key] || []) if (row.restaurant_id) ids.add(row.restaurant_id)
  }
  return [...ids]
}

export function referencedStoreIds(data) {
  const ids = new Set()
  for (const key of ['check_ins', 'reviews', 'review_prompts']) {
    for (const row of data[key] || []) if (row.store_id) ids.add(row.store_id)
  }
  return [...ids]
}
