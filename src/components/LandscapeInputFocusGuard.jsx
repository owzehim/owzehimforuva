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

function getViewportMetrics(visualViewport) {
  const top = visualViewport?.offsetTop ?? 0
  const height = visualViewport?.height ?? window.innerHeight
  return { top, bottom: top + height, height, center: top + height / 2 }
}

function isKeyboardOpen(focus, visualViewport) {
  const current = getViewportMetrics(visualViewport)
  return focus.viewportHeight - current.height > 80 || current.top - focus.viewportTop > 80
}

function restoreScrollPositions(scroll) {
  for (const ancestor of scroll.ancestors) {
    if (!ancestor.element.isConnected) continue
    ancestor.element.scrollLeft = ancestor.left
    ancestor.element.scrollTop = ancestor.top
  }
  window.scrollTo({ left: scroll.windowLeft, top: scroll.windowTop, behavior: 'instant' })
}

function ensureKeyboardScrollSpace(focus) {
  if (focus.keyboardScrollSpace) return
  const host = focus.control.closest('.phone-app-shell, .member-app-shell') || document.scrollingElement
  if (!(host instanceof HTMLElement)) return

  focus.keyboardScrollSpace = {
    host,
    hadClass: host.classList.contains('landscape-keyboard-scroll-host'),
    overflowY: host.style.getPropertyValue('overflow-y'),
    overflowYPriority: host.style.getPropertyPriority('overflow-y'),
    scrollSpace: host.style.getPropertyValue('--landscape-keyboard-scroll-space'),
    scrollSpacePriority: host.style.getPropertyPriority('--landscape-keyboard-scroll-space'),
  }
  host.classList.add('landscape-keyboard-scroll-host')
  host.style.setProperty('overflow-y', 'auto', 'important')
  host.style.setProperty('--landscape-keyboard-scroll-space', `${Math.max(240, focus.viewportHeight * 2)}px`)

  if (!focus.scroll.ancestors.some((ancestor) => ancestor.element === host)) {
    const bodyIndex = focus.scroll.ancestors.findIndex((ancestor) => ancestor.element === document.body)
    const hostScroll = { element: host, left: host.scrollLeft, top: host.scrollTop }
    if (bodyIndex < 0) focus.scroll.ancestors.push(hostScroll)
    else focus.scroll.ancestors.splice(bodyIndex, 0, hostScroll)
  }
}

function removeKeyboardScrollSpace(focus) {
  const space = focus?.keyboardScrollSpace
  if (!space) return
  if (!space.hadClass) space.host.classList.remove('landscape-keyboard-scroll-host')
  if (space.overflowY) {
    space.host.style.setProperty('overflow-y', space.overflowY, space.overflowYPriority)
  } else {
    space.host.style.removeProperty('overflow-y')
  }
  if (space.scrollSpace) {
    space.host.style.setProperty('--landscape-keyboard-scroll-space', space.scrollSpace, space.scrollSpacePriority)
  } else {
    space.host.style.removeProperty('--landscape-keyboard-scroll-space')
  }
  focus.keyboardScrollSpace = null
}

function centerFocusedField(focus, visualViewport) {
  const target = getCenterTarget(focus.control)
  // Make room inside fixed-height app shells, then choose one scroll container to animate.
  ensureKeyboardScrollSpace(focus)

  const viewport = getViewportMetrics(visualViewport)
  const bounds = target.getBoundingClientRect()
  const correction = (bounds.top + bounds.bottom) / 2 - viewport.center
  if (Math.abs(correction) < 2) return

  const host = focus.keyboardScrollSpace?.host
  const candidates = []
  let element = target.parentElement
  while (element && element !== document.body && element !== document.documentElement) {
    const overflowY = window.getComputedStyle(element).overflowY
    if (/(auto|scroll|hidden|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 1) {
      candidates.push(element)
    }
    if (element === host) break
    element = element.parentElement
  }

  if (host && !candidates.includes(host)) candidates.push(host)
  const scrollCapacity = (candidate) => correction > 0
    ? candidate.scrollHeight - candidate.clientHeight - candidate.scrollTop
    : candidate.scrollTop
  const scrollTarget = candidates.find((candidate) => scrollCapacity(candidate) >= Math.abs(correction) - 2)
    || [...candidates].sort((left, right) => scrollCapacity(right) - scrollCapacity(left))[0]

  if (!scrollTarget) return
  const maxScroll = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
  const nextScrollTop = Math.min(maxScroll, Math.max(0, scrollTarget.scrollTop + correction))
  scrollTarget.scrollTo({ top: nextScrollTop, behavior: 'smooth' })
}

export default function LandscapeInputFocusGuard() {
  useEffect(() => {
    const media = window.matchMedia(LANDSCAPE_QUERY)
    const visualViewport = window.visualViewport
    let pointerFocus = null
    let activeFocus = null
    let settleTimer = 0
    let blurTimer = 0

    const clearActiveFocus = (preserveKeyboardScrollSpace = false) => {
      window.clearTimeout(settleTimer)
      if (activeFocus) {
        visualViewport?.removeEventListener('resize', handleViewportResize)
        window.removeEventListener('resize', handleViewportResize)
        removeZoomGuard(activeFocus.control)
        if (!preserveKeyboardScrollSpace) removeKeyboardScrollSpace(activeFocus)
      }
      activeFocus = null
    }

    const scheduleScrollCheck = (delay = 260) => {
      if (!activeFocus) return
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        const focus = activeFocus
        if (!focus || !media.matches) return

        const keyboardOpen = isKeyboardOpen(focus, visualViewport)
        if (keyboardOpen) {
          focus.keyboardWasOpen = true
          if (!focus.centeredForKeyboard && document.activeElement === focus.control && Math.abs((visualViewport?.scale ?? 1) - focus.scale) <= 0.03) {
            centerFocusedField(focus, visualViewport)
            focus.centeredForKeyboard = true
          }
          return
        }

        if (focus.keyboardWasOpen) {
          removeKeyboardScrollSpace(focus)
          restoreScrollPositions(focus.scroll)
          focus.keyboardWasOpen = false
          focus.centeredForKeyboard = false
        }
      }, delay)
    }

    const handleViewportResize = () => scheduleScrollCheck(260)

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
        viewportTop: currentSession?.viewportTop ?? getViewportMetrics(visualViewport).top,
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
        viewportTop: pointer?.viewportTop ?? previousFocus?.viewportTop ?? getViewportMetrics(visualViewport).top,
        keyboardWasOpen: previousFocus?.keyboardWasOpen ?? false,
        centeredForKeyboard: false,
        keyboardScrollSpace: previousFocus?.keyboardScrollSpace ?? null,
      }
      clearActiveFocus(Boolean(session.keyboardScrollSpace))
      window.clearTimeout(blurTimer)
      addZoomGuard(control)
      activeFocus = session
      visualViewport?.addEventListener('resize', handleViewportResize)
      window.addEventListener('resize', handleViewportResize)
      scheduleScrollCheck(450)
    }

    const handleFocusOut = (event) => {
      if (event.target === pointerFocus?.control) pointerFocus = null
      if (event.target !== activeFocus?.control) return

      const blurredFocus = activeFocus
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        if (activeFocus !== blurredFocus || resolveTextControl(document.activeElement)) return
        removeKeyboardScrollSpace(blurredFocus)
        restoreScrollPositions(blurredFocus.scroll)
        clearActiveFocus()
      }, 350)
    }

    const handleOrientationChange = () => {
      if (!media.matches) {
        if (activeFocus?.keyboardWasOpen) {
          removeKeyboardScrollSpace(activeFocus)
          restoreScrollPositions(activeFocus.scroll)
        }
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
      if (activeFocus?.keyboardWasOpen) {
        removeKeyboardScrollSpace(activeFocus)
        restoreScrollPositions(activeFocus.scroll)
      }
      clearActiveFocus()
      if (pointerFocus) removeZoomGuard(pointerFocus.control)
    }
  }, [])

  return null
}
