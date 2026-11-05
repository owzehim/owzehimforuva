// OPS-05: everything sent to Sentry passes through these pure helpers first.
// Goal: an error report says what broke and where, never who it happened to.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const SUPABASE_KEY = /\bsb_(publishable|secret)_[A-Za-z0-9_-]{10,}\b/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// Student numbers and phone-like digit runs (6+ digits).
const LONG_NUMBER = /\b\d{6,}\b/g

export function scrubText(value) {
  if (typeof value !== 'string' || !value) return value
  return value
    .replace(JWT, '[token]')
    .replace(SUPABASE_KEY, '[key]')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(LONG_NUMBER, '[number]')
}

/** Keep only origin + path: query strings and hashes can hold tokens or emails. */
export function scrubUrl(value) {
  if (typeof value !== 'string' || !value) return value
  try {
    const url = new URL(value, 'https://placeholder.invalid')
    const path = scrubText(url.pathname)
    return url.origin === 'https://placeholder.invalid' ? path : `${url.origin}${path}`
  } catch {
    return scrubText(value.split(/[?#]/)[0])
  }
}

function scrubException(exception) {
  for (const entry of exception?.values || []) {
    entry.value = scrubText(entry.value)
  }
}

/** Sentry beforeSend: remove identity, request details and personal text. */
export function scrubEvent(event) {
  if (!event) return event
  delete event.user
  delete event.server_name
  if (event.request) {
    event.request = { url: scrubUrl(event.request.url) }
  }
  event.message = scrubText(event.message)
  if (event.logentry) {
    event.logentry.message = scrubText(event.logentry.message)
    delete event.logentry.params
  }
  scrubException(event.exception)
  delete event.extra
  if (event.contexts) {
    delete event.contexts.state
    delete event.contexts.profile
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean)
  }
  return event
}

/** Sentry beforeBreadcrumb: drop console/input crumbs, strip URLs and text. */
export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return null
  if (breadcrumb.category === 'console' || breadcrumb.category === 'ui.input') return null
  const next = { ...breadcrumb, message: scrubText(breadcrumb.message) }
  if (next.data) {
    const data = {}
    if (next.data.url) data.url = scrubUrl(next.data.url)
    if (next.data.from) data.from = scrubUrl(next.data.from)
    if (next.data.to) data.to = scrubUrl(next.data.to)
    if (next.data.method) data.method = next.data.method
    if (next.data.status_code) data.status_code = next.data.status_code
    next.data = data
  }
  return next
}

/**
 * Which deployment reports errors, from Vercel's build environment (VERCEL_ENV).
 * Local builds and unknown environments never report. Production only reports
 * once the privacy policy mentions Sentry (productionApproved).
 */
export function errorReportingEnvironment(deployEnv, { productionApproved }) {
  if (deployEnv === 'production') return productionApproved ? 'production' : null
  if (deployEnv === 'preview') return 'preview'
  return null
}
