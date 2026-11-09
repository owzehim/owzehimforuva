import { lazy } from 'react'

const RELOAD_FLAG = 'uvain:lazy-page-reload'

/**
 * PERF-01: React.lazy for a page, with one recovery step. After a new deploy
 * a browser without the service worker cache may ask for a page file that no
 * longer exists; reload once to pick up the current version instead of
 * showing the error screen.
 */
export function lazyPage(load) {
  return lazy(async () => {
    try {
      const page = await load()
      try { window.sessionStorage.removeItem(RELOAD_FLAG) } catch { /* storage unavailable */ }
      return page
    } catch (error) {
      let alreadyReloaded = false
      try {
        alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG) === '1'
        if (!alreadyReloaded) window.sessionStorage.setItem(RELOAD_FLAG, '1')
      } catch {
        alreadyReloaded = true
      }
      if (!alreadyReloaded) {
        window.location.reload()
        return new Promise(() => {})
      }
      throw error
    }
  })
}
