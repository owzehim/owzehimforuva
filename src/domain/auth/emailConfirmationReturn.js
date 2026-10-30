export const CONFIRMATION_EVENT_KEY = 'uvain-email-confirmation-result'
export const CONFIRMATION_RESULT_STATUSES = ['success', 'error', 'registration_error', 'email_change_error']

export function confirmationRedirectUrl(returnToken, origin = typeof window === 'undefined' ? 'https://app.uva-in.nl' : window.location.origin) {
  const url = new URL('/email-confirmed', origin)
  if (returnToken) url.searchParams.set('returnToken', returnToken)
  return url.toString()
}

// A display-only handoff, never an authentication/session credential. External
// browsers and installed PWAs need not share cookies or localStorage.
export function watchEmailConfirmation({ token, check, onResult, targetWindow = window, targetDocument = document }) {
  let cancelled = false
  let checking = false
  let finished = false
  let lastStatus = ''
  const accept = status => {
    if (cancelled || finished || lastStatus === status || !CONFIRMATION_RESULT_STATUSES.includes(status)) return
    lastStatus = status
    finished = status === 'success'
    onResult(status)
  }
  const readLocal = event => {
    if (event && event.key !== CONFIRMATION_EVENT_KEY) return
    try {
      const result = JSON.parse(targetWindow.localStorage.getItem(CONFIRMATION_EVENT_KEY))
      if (result?.returnToken === token && Number.isFinite(result.at) &&
          result.at <= Date.now() + 30000 && Date.now() - result.at < 60 * 60 * 1000) accept(result.status)
    } catch { /* Storage is optional; the server handoff works without it. */ }
  }
  const resume = async () => {
    if (cancelled || finished || targetDocument.visibilityState === 'hidden') return
    readLocal()
    if (finished || checking) return
    checking = true
    try { accept((await check(token))?.status) } catch {
      // Network/CAPTCHA failures are not evidence that email confirmation failed.
      // Retry on the next foreground check without interrupting the member.
    } finally { checking = false }
  }
  targetWindow.addEventListener('storage', readLocal)
  targetWindow.addEventListener('focus', resume)
  targetWindow.addEventListener('pageshow', resume)
  targetDocument.addEventListener('visibilitychange', resume)
  const timer = targetWindow.setInterval(resume, 5000)
  void resume()
  return () => {
    cancelled = true
    targetWindow.clearInterval(timer)
    targetWindow.removeEventListener('storage', readLocal)
    targetWindow.removeEventListener('focus', resume)
    targetWindow.removeEventListener('pageshow', resume)
    targetDocument.removeEventListener('visibilitychange', resume)
  }
}
