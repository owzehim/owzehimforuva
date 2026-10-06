import { resolveAppEnv } from './resolveAppEnv.js'

// Development-only behavior is allowed only in Vite's local dev server.
// A missing or mis-scoped Vercel variable must never enable it in a build.
export const APP_ENV = resolveAppEnv({
  isViteDev: import.meta.env.DEV,
  configuredEnv: import.meta.env.VITE_APP_ENV,
})

export const isProductionEnv = APP_ENV === 'production'
