// PERF-15: import only the Sentry functions the app uses, so the bundler can
// leave out the rest (session replay, user feedback, tracing). This file is
// loaded on demand by errorMonitoring.js.
export { init, captureException } from '@sentry/react'
