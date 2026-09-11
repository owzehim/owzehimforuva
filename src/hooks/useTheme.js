import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'uvain_theme'
const THEME_CHANGE_EVENT = 'uvain-theme-change'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const DEFAULT_THEME = 'light'

function getStoredTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return ['light', 'dark', 'system'].includes(storedTheme)
    ? storedTheme
    : DEFAULT_THEME
}

function prefersDark() {
  if (typeof window === 'undefined') return false
  return window.matchMedia(DARK_QUERY).matches
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)

    if (theme !== 'system') return undefined

    const media = window.matchMedia(DARK_QUERY)
    const handleChange = () => applyTheme('system')
    media.addEventListener('change', handleChange)

    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  useEffect(() => {
    const syncStoredTheme = () => {
      const nextTheme = getStoredTheme()
      setThemeState(nextTheme)
      applyTheme(nextTheme)
    }

    window.addEventListener('storage', syncStoredTheme)
    window.addEventListener(THEME_CHANGE_EVENT, syncStoredTheme)

    return () => {
      window.removeEventListener('storage', syncStoredTheme)
      window.removeEventListener(THEME_CHANGE_EVENT, syncStoredTheme)
    }
  }, [])

  const setTheme = (nextTheme) => {
    const normalizedTheme = ['light', 'dark', 'system'].includes(nextTheme)
      ? nextTheme
      : DEFAULT_THEME

    setThemeState(normalizedTheme)
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme)
    applyTheme(normalizedTheme)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  return { theme, setTheme }
}
