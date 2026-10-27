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

function getVerticalVisibilityCorrection(control, viewportTop, viewportBottom) {
  const bounds = control.getBoundingClientRect()
  const margin = 8
  if (bounds.bottom > viewportBottom - margin) return bounds.bottom - viewportBottom + margin
  if (bounds.top < viewportTop + margin) return bounds.top - viewportTop - margin
  return 0
}

function revealFocusedControl(control, visualViewport) {
  const viewportTop = visualViewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
  let correction = getVerticalVisibilityCorrection(control, viewportTop, viewportBottom)
  if (Math.abs(correction) < 1) return

  let element = control.parentElement
  while (element && element !== document.body && element !== document.documentElement && Math.abs(correction) >= 1) {
    if (element.scrollHeight > element.clientHeight + 1) {
      const previousScrollTop = element.scrollTop
      element.scrollTop += correction
      const appliedScroll = element.scrollTop - previousScrollTop
      if (appliedScroll !== 0) {
        correction = getVerticalVisibilityCorrection(control, viewportTop, viewportBottom)
      }
    }
    element = element.parentElement
  }

  if (Math.abs(correction) >= 1) window.scrollBy(0, correction)
}

export default function LandscapeInputFocusGuard() {
  useEffect(() => {
    const media = window.matchMedia(LANDSCAPE_QUERY)
    const visualViewport = window.visualViewport
    let pointerFocus = null
    let activeFocus = null
    let settleTimer = 0

    const clearActiveFocus = () => {
      window.clearTimeout(settleTimer)
      if (activeFocus) {
        visualViewport?.removeEventListener('resize', scheduleScrollCheck)
        window.removeEventListener('resize', scheduleScrollCheck)
        removeZoomGuard(activeFocus.control)
      }
      activeFocus = null
    }

    const scheduleScrollCheck = () => {
      if (!activeFocus) return
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const focus = activeFocus
        if (!focus || document.activeElement !== focus.control || !media.matches) return
        if (Math.abs((visualViewport?.scale ?? 1) - focus.scale) > 0.03) return

        const bounds = focus.control.getBoundingClientRect()
        const currentScrollX = window.scrollX
        const currentScrollY = window.scrollY
        let restoreShiftX = currentScrollX - focus.scroll.windowLeft
        let restoreShiftY = currentScrollY - focus.scroll.windowTop
        let hasScrollMoved = currentScrollX !== focus.scroll.windowLeft || currentScrollY !== focus.scroll.windowTop

        for (const ancestor of focus.scroll.ancestors) {
          const currentLeft = ancestor.element.scrollLeft
          const currentTop = ancestor.element.scrollTop
          restoreShiftX += currentLeft - ancestor.left
          restoreShiftY += currentTop - ancestor.top
          hasScrollMoved ||= currentLeft !== ancestor.left || currentTop !== ancestor.top
        }

        const restoredLeft = bounds.left + restoreShiftX
        const restoredTop = bounds.top + restoreShiftY
        const viewportLeft = visualViewport?.offsetLeft ?? 0
        const viewportTop = visualViewport?.offsetTop ?? 0
        const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth)
        const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
        const margin = 8
        const remainsVisible =
          restoredLeft >= viewportLeft + margin &&
          restoredTop >= viewportTop + margin &&
          restoredLeft + bounds.width <= viewportRight - margin &&
          restoredTop + bounds.height <= viewportBottom - margin

        if (remainsVisible && hasScrollMoved) {
          for (const ancestor of focus.scroll.ancestors) {
            ancestor.element.scrollTo(ancestor.left, ancestor.top)
          }
          window.scrollTo(focus.scroll.windowLeft, focus.scroll.windowTop)
        }

        revealFocusedControl(focus.control, visualViewport)
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

      pointerFocus = {
        control,
        scroll: captureScrollPositions(control),
        scale: visualViewport?.scale ?? 1,
      }
      addZoomGuard(control)
    }

    const handleFocusIn = (event) => {
      if (!media.matches) return
      const control = resolveTextControl(event.target)
      if (!control) return

      clearActiveFocus()
      addZoomGuard(control)
      const pointer = pointerFocus?.control === control ? pointerFocus : null
      activeFocus = {
        control,
        scroll: pointer?.scroll ?? captureScrollPositions(control),
        scale: pointer?.scale ?? (visualViewport?.scale ?? 1),
      }
      visualViewport?.addEventListener('resize', scheduleScrollCheck)
      window.addEventListener('resize', scheduleScrollCheck)
      scheduleScrollCheck()
    }

    const handleFocusOut = (event) => {
      if (event.target === activeFocus?.control) clearActiveFocus()
      if (event.target === pointerFocus?.control) pointerFocus = null
    }

    const handleOrientationChange = () => {
      if (!media.matches) {
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
      clearActiveFocus()
      if (pointerFocus) removeZoomGuard(pointerFocus.control)
    }
  }, [])

  return null
}
