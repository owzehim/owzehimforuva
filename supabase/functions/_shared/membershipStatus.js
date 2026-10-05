const MEMBERSHIP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function calendarDateInTimeZone(date, timeZone) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  if (!values.year || !values.month || !values.day) return null

  return `${values.year}-${values.month}-${values.day}`
}

export function isMembershipActive(member, now = new Date()) {
  const validUntil = member?.membership_valid_until
  if (
    member?.is_member !== true ||
    member?.account_status !== 'active' ||
    member?.identity_anonymized_at != null ||
    typeof validUntil !== 'string' ||
    !MEMBERSHIP_DATE_PATTERN.test(validUntil)
  ) {
    return false
  }

  const parsedDate = new Date(`${validUntil}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== validUntil) {
    return false
  }

  const todayInAmsterdam = calendarDateInTimeZone(now, 'Europe/Amsterdam')
  return todayInAmsterdam != null && validUntil >= todayInAmsterdam
}
