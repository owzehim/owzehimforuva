// OPS-05: frontend error monitoring with Sentry (EU region).
//
// Sentry is loaded only on Vercel deployments that may report (see
// errorReportingEnvironment); local development never loads or sends anything.
// Reports are scrubbed (errorReportScrub.js): no user, IP, request details,
// emails, student numbers or tokens. No session replay, no performance tracing.
import { errorReportingEnvironment, scrubBreadcrumb, scrubEvent } from './errorReportScrub.js'

// Production reporting is allowed because the Privacy Policy (legal version
// 2026-11-06-01) names Sentry; tests/errorReportScrub.test.js keeps them in step.
export const PRODUCTION_REPORTING_APPROVED = true

/* global __APP_DEPLOY_ENV__, __APP_RELEASE__ */
const deployEnv = typeof __APP_DEPLOY_ENV__ === 'string' ? __APP_DEPLOY_ENV__ : ''
const release = typeof __APP_RELEASE__ === 'string' && __APP_RELEASE__ ? __APP_RELEASE__ : undefined

let sentryPromise = null

export function initErrorMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  const environment = errorReportingEnvironment(deployEnv, {
    productionApproved: PRODUCTION_REPORTING_APPROVED,
  })
  if (!dsn || !environment || sentryPromise) return

  sentryPromise = import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment,
        release,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        maxBreadcrumbs: 30,
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',
          'ResizeObserver loop completed with undelivered notifications',
        ],
      })
      // Preview-only check: open a preview with ?sentry_test=1 to send one test
      // error; its fake email and student number must arrive scrubbed.
      if (environment === 'preview' && new URLSearchParams(window.location.search).has('sentry_test')) {
        Sentry.captureException(new Error('Sentry preview test for jane.doe@example.com (12345678)'))
      }
      return Sentry
    })
    .catch(() => null)
}

/** Report an error caught by the app's error boundary (no-op when disabled). */
export function reportError(error, componentStack) {
  if (!sentryPromise) return
  sentryPromise.then((Sentry) => {
    Sentry?.captureException(error, {
      contexts: componentStack ? { react: { componentStack } } : undefined,
    })
  })
}
