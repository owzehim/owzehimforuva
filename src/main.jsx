import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import FeedbackProvider from './components/feedback/FeedbackProvider.jsx'
import { initErrorMonitoring } from './lib/errorMonitoring.js'
import { markUpdateReady } from './lib/appUpdate.js'

if ('serviceWorker' in navigator) {
  // Download updates quietly. The waiting version activates when every app
  // window closes, or earlier when the member taps 업데이트 (OPS-17). Active
  // work is never reloaded without that tap.
  // OPS-17: when a new version is waiting, offer it in the UpdatePrompt card.
  // It is only activated when the member taps 업데이트 (updateSW(true)).
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (typeof markUpdateReady === 'function') markUpdateReady(() => updateSW(true))
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const checkForUpdates = () => registration.update().catch((error) => {
        console.warn('Service worker update check failed:', error)
      })
      checkForUpdates()

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdates()
        }
      })

      setInterval(checkForUpdates, 60 * 60 * 1000)
    },
    onRegisterError(error) {
      console.error('Service worker registration failed:', error)
    },
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </AppErrorBoundary>
  </StrictMode>,
)

// OPS-05: Sentry loads in the background on deployed previews (and on
// production once approved); it never loads in local development.
initErrorMonitoring()
