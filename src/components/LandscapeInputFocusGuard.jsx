import { useEffect } from 'react'

const LANDSCAPE_QUERY = '(orientation: landscape) and (pointer: coarse)'
const TEXT_CONTROL_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"])',
  'textarea',
  'select',
].join(', ')
const ZOOM_SAFE_FONT_SIZE = 16

function resolveTextControl(target) {
  if (!(target instanceof Element)) return null
  const directControl = target.closest(TEXT_CONTROL_SELECTOR)
  if (directControl) return directControl

  const label = target.closest('label')
  if (label) return label.querySelector(TEXT_CONTROL_SELECTOR) || label.control || null

  return target.closest('.registration-field, .input-focus-frame')
    ?.querySelector(TEXT_CONTROL_SELECTOR) || null
}

function addZoomGuard(control) {
  if (!(control instanceof HTMLElement) || control.classList.contains('landscape-focus-zoom-guard')) return
  if (control instanceof HTMLSelectElement) return
  if (control instanceof HTMLInputElement && ![
    'email', 'number', 'password', 'search', 'tel', 'text', 'url',
  ].includes(control.type)) return

  const fontSize = Number.parseFloat(window.getComputedStyle(control).fontSize)
  if (!Number.isFinite(fontSize) || fontSize >= ZOOM_SAFE_FONT_SIZE) return

  const scale = fontSize / ZOOM_SAFE_FONT_SIZE
  const bounds = control.getBoundingClientRect()
  control.style.setProperty('--landscape-focus-scale', String(scale))
  control.style.setProperty('--landscape-focus-width', `${bounds.width / scale}px`)
  control.style.setProperty('--landscape-focus-height', `${bounds.height / scale}px`)
  control.classList.add('landscape-focus-zoom-guard')
}

function removeZoomGuard(control) {
  if (!(control instanceof HTMLElement)) return
  control.classList.remove('landscape-focus-zoom-guard')
  control.style.removeProperty('--landscape-focus-scale')
  control.style.removeProperty('--landscape-focus-width')
  control.style.removeProperty('--landscape-focus-height')
}

function captureScrollPositions(control) {
  const ancestors = []
  let element = control.parentElement

  while (element && element !== document.body && element !== document.documentElement) {
    if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) {
      ancestors.push({ element, left: element.scrollLeft, top: element.scrollTop })
    }
    element = element.parentElement
  }

  if (document.body.scrollHeight > document.body.clientHeight + 1 ||
      document.body.scrollWidth > document.body.clientWidth + 1) {
    ancestors.push({ element: document.body, left: document.body.scrollLeft, top: document.body.scrollTop })
  }

  return { ancestors, windowLeft: window.scrollX, windowTop: window.scrollY }
}

function getCenterTarget(control) {
  return control.closest('.registration-field, .input-focus-frame') || control
}

function hasFixedPositionAncestor(element) {
  while (element && element !== document.body && element !== document.documentElement) {
    if (window.getComputedStyle(element).position === 'fixed') return true
    element = element.parentElement
  }
  return false
}

function getViewportMetrics(visualViewport) {
  const top = visualViewport?.offsetTop ?? 0
  const height = visualViewport?.height ?? window.innerHeight
  return { top, bottom: top + height, height, center: top + height / 2 }
}

function isKeyboardOpen(focus, visualViewport) {
  const current = getViewportMetrics(visualViewport)
  return focus.viewportHeight - current.height > 80
}

function restoreScrollPositions(scroll) {
  for (const ancestor of scroll.ancestors) {
    if (!ancestor.element.isConnected) continue
    ancestor.element.scrollLeft = ancestor.left
    ancestor.element.scrollTop = ancestor.top
  }
  window.scrollTo({ left: scroll.windowLeft, top: scroll.windowTop, behavior: 'instant' })
}

function getInlineTranslateY(element) {
  const value = window.getComputedStyle(element).translate
  if (!value || value === 'none') return 0
  const parts = value.split(/\s+/)
  const y = parts.length > 1 ? Number.parseFloat(parts[1]) : 0
  return Number.isFinite(y) ? y : 0
}

function shiftFieldForKeyboard(focus, offset) {
  const field = getCenterTarget(focus.control)
  if (focus.shiftedField && focus.shiftedField !== field) removeKeyboardShift(focus)
  if (!focus.shiftedField) {
    focus.shiftedField = field
    focus.originalTranslate = field.style.getPropertyValue('translate')
    focus.originalTranslatePriority = field.style.getPropertyPriority('translate')
    focus.baseTranslateY = getInlineTranslateY(field)
    focus.currentTranslateY = focus.baseTranslateY
  }
  focus.currentTranslateY += offset
  field.style.setProperty('translate', `0px ${focus.currentTranslateY}px`, 'important')
}

function removeKeyboardShift(focus) {
  const field = focus?.shiftedField
  if (!field) return
  if (focus.originalTranslate) {
    field.style.setProperty('translate', focus.originalTranslate, focus.originalTranslatePriority)
  } else {
    field.style.removeProperty('translate')
  }
  focus.shiftedField = null
  focus.currentTranslateY = focus.baseTranslateY
}

function centerFocusedField(focus, visualViewport) {
  const target = getCenterTarget(focus.control)
  const viewport = getViewportMetrics(visualViewport)
  let bounds = target.getBoundingClientRect()
  let correction = (bounds.top + bounds.bottom) / 2 - viewport.center

  if (hasFixedPositionAncestor(target)) {
    shiftFieldForKeyboard(focus, -correction)
    return
  }

  // Scroll inner content first, then the document, so the surrounding screen follows the field.
  for (const ancestor of focus.scroll.ancestors) {
    if (Math.abs(correction) < 1) break
    const element = ancestor.element
    if (!element.isConnected || element === document.body || element.scrollHeight <= element.clientHeight + 1) continue
    const maxScroll = element.scrollHeight - element.clientHeight
    const nextScrollTop = Math.min(maxScroll, Math.max(0, element.scrollTop + correction))
    if (nextScrollTop === element.scrollTop) continue
    element.scrollTop = nextScrollTop
    bounds = target.getBoundingClientRect()
    correction = (bounds.top + bounds.bottom) / 2 - viewport.center
  }

  if (Math.abs(correction) >= 1) {
    const documentElement = document.documentElement
    const maxScroll = Math.max(0, documentElement.scrollHeight - documentElement.clientHeight)
    const nextScrollTop = Math.min(maxScroll, Math.max(0, window.scrollY + correction))
    if (nextScrollTop !== window.scrollY) {
      window.scrollTo({ left: window.scrollX, top: nextScrollTop, behavior: 'instant' })
      bounds = target.getBoundingClientRect()
      correction = (bounds.top + bounds.bottom) / 2 - viewport.center
    }
  }

  // Some landscape forms anchor fields with position: fixed, so scrolling cannot move them.
  if (Math.abs(correction) >= 1) shiftFieldForKeyboard(focus, -correction)
}

export default function LandscapeInputFocusGuard() {
  useEffect(() => {
    const media = window.matchMedia(LANDSCAPE_QUERY)
    const visualViewport = window.visualViewport
    let pointerFocus = null
    let activeFocus = null
    let settleTimer = 0
    let blurTimer = 0

    const clearActiveFocus = () => {
      window.clearTimeout(settleTimer)
      if (activeFocus) {
        visualViewport?.removeEventListener('resize', scheduleScrollCheck)
        window.removeEventListener('resize', scheduleScrollCheck)
        removeZoomGuard(activeFocus.control)
        removeKeyboardShift(activeFocus)
      }
      activeFocus = null
    }

    const scheduleScrollCheck = () => {
      if (!activeFocus) return
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const focus = activeFocus
        if (!focus || !media.matches) return

        const keyboardOpen = isKeyboardOpen(focus, visualViewport)
        if (keyboardOpen) {
          focus.keyboardWasOpen = true
          if (document.activeElement === focus.control && Math.abs((visualViewport?.scale ?? 1) - focus.scale) <= 0.03) {
            centerFocusedField(focus, visualViewport)
          }
          return
        }

        if (focus.keyboardWasOpen) {
          restoreScrollPositions(focus.scroll)
          removeKeyboardShift(focus)
          focus.keyboardWasOpen = false
        }
      }, 160)
    }

    const handlePointerDown = (event) => {
      if (!media.matches) {
        pointerFocus = null
        return
      }

      const control = resolveTextControl(event.target)
      if (!control) {
        pointerFocus = null
        return
      }

      const currentSession = activeFocus
      pointerFocus = {
        control,
        scroll: currentSession?.scroll ?? captureScrollPositions(control),
        scale: currentSession?.scale ?? (visualViewport?.scale ?? 1),
        viewportHeight: currentSession?.viewportHeight ?? getViewportMetrics(visualViewport).height,
      }
      window.clearTimeout(blurTimer)
      addZoomGuard(control)
    }

    const handleFocusIn = (event) => {
      if (!media.matches) return
      const control = resolveTextControl(event.target)
      if (!control) return

      const previousFocus = activeFocus
      const pointer = pointerFocus?.control === control ? pointerFocus : null
      const session = {
        control,
        scroll: pointer?.scroll ?? previousFocus?.scroll ?? captureScrollPositions(control),
        scale: pointer?.scale ?? previousFocus?.scale ?? (visualViewport?.scale ?? 1),
        viewportHeight: pointer?.viewportHeight ?? previousFocus?.viewportHeight ?? getViewportMetrics(visualViewport).height,
        keyboardWasOpen: previousFocus?.keyboardWasOpen ?? false,
      }
      clearActiveFocus()
      window.clearTimeout(blurTimer)
      addZoomGuard(control)
      activeFocus = session
      visualViewport?.addEventListener('resize', scheduleScrollCheck)
      window.addEventListener('resize', scheduleScrollCheck)
      scheduleScrollCheck()
    }

    const handleFocusOut = (event) => {
      if (event.target === pointerFocus?.control) pointerFocus = null
      if (event.target !== activeFocus?.control) return

      const blurredFocus = activeFocus
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        if (activeFocus !== blurredFocus || resolveTextControl(document.activeElement)) return
        restoreScrollPositions(blurredFocus.scroll)
        clearActiveFocus()
      }, 350)
    }

    const handleOrientationChange = () => {
      if (!media.matches) {
        if (activeFocus?.keyboardWasOpen) restoreScrollPositions(activeFocus.scroll)
        clearActiveFocus()
        if (pointerFocus) removeZoomGuard(pointerFocus.control)
        pointerFocus = null
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('focusout', handleFocusOut, true)
    media.addEventListener('change', handleOrientationChange)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('focusout', handleFocusOut, true)
      media.removeEventListener('change', handleOrientationChange)
      window.clearTimeout(blurTimer)
      if (activeFocus?.keyboardWasOpen) restoreScrollPositions(activeFocus.scroll)
      clearActiveFocus()
      if (pointerFocus) removeZoomGuard(pointerFocus.control)
    }
  }, [])

  return null
}
