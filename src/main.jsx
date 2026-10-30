import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'

if ('serviceWorker' in navigator) {
  // Download updates quietly. The waiting worker activates naturally after
  // every tab/app window using the old worker closes; never reload active work.
  registerSW({
    immediate: true,
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
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
