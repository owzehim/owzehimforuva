// OPS-17: a new app version has finished downloading and is waiting.
// main.jsx reports it here; the UpdatePrompt card shows it. The app only
// switches versions when the member taps 업데이트 (never automatically).

let applyUpdate = null
const listeners = new Set()

export function markUpdateReady(apply) {
  if (typeof apply !== 'function') return
  applyUpdate = apply
  for (const listener of listeners) listener(true)
}

export function isUpdateReady() {
  return applyUpdate !== null
}

export function onUpdateReady(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Activate the waiting version and reload. Only called from a member's tap. */
export function applyWaitingUpdate() {
  if (!applyUpdate) return false
  applyUpdate()
  return true
}

// Screens where the card must not appear: staff look at the scan result, and
// sign-in, sign-up, password and policy screens must not be interrupted.
const HIDDEN_PATHS = ['/scan', '/login', '/register', '/reset-password', '/settings/password', '/legal-consent', '/email-confirmed']

export function isUpdatePromptHiddenOn(pathname) {
  return HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
