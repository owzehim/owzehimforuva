import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ZOOM_THRESHOLD = 1.04
const MINIMAP_DISPLAY_DURATION = 1500

function isDevPreview() {
  if (import.meta.env?.DEV) return true
  if (typeof window === 'undefined') return false

  const { hostname } = window.location
  return hostname === 'dev.app.uva-in.nl' ||
    (hostname.endsWith('.vercel.app') && hostname.includes('-git-dev-'))
}

function readViewport() {
  const visualViewport = window.visualViewport
  if (!visualViewport) return null

  const layoutWidth = document.documentElement.clientWidth || window.innerWidth
  const layoutHeight = document.documentElement.clientHeight || window.innerHeight
  if (!layoutWidth || !layoutHeight) return null
  const rootStyle = window.getComputedStyle(document.documentElement)
  const safeTop = Number.parseFloat(rootStyle.getPropertyValue('--safe-area-inset-top')) || 0
  const safeLeft = Number.parseFloat(rootStyle.getPropertyValue('--safe-area-inset-left')) || 0

  return {
    scale: visualViewport.scale || 1,
    layoutWidth,
    layoutHeight,
    visibleWidth: visualViewport.width,
    visibleHeight: visualViewport.height,
    offsetLeft: visualViewport.offsetLeft,
    offsetTop: visualViewport.offsetTop,
    safeLeft,
    safeTop,
  }
}

export default function ZoomViewportMinimap() {
  const enabled = isDevPreview()
  const [visible, setVisible] = useState(false)
  const minimapRef = useRef(null)
  const viewportWindowRef = useRef(null)
  const scaleLabelRef = useRef(null)

  useEffect(() => {
    if (!enabled || !window.visualViewport) return undefined

    let frame = 0
    let settleTimer = 0
    let hideTimer = 0
    let disposed = false
    const update = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const viewport = readViewport()
        const minimap = minimapRef.current
        const viewportWindow = viewportWindowRef.current
        const scaleLabel = scaleLabelRef.current
        if (!viewport || !minimap || !viewportWindow || !scaleLabel) return

        const isLandscape = viewport.layoutWidth > viewport.layoutHeight
        const mapWidth = isLandscape ? 150 : 58
        const mapHeight = isLandscape
          ? mapWidth * viewport.layoutHeight / viewport.layoutWidth + 14
          : Math.max(96, Math.min(150, mapWidth * viewport.layoutHeight / viewport.layoutWidth))
        const scaleCompensation = 1 / viewport.scale
        const mapLeft = viewport.offsetLeft + (viewport.safeLeft + 10) / viewport.scale
        const mapTop = viewport.offsetTop + (viewport.safeTop + 10) / viewport.scale
        const visibleWidth = Math.max(4, Math.min(100, viewport.visibleWidth / viewport.layoutWidth * 100))
        const visibleHeight = Math.max(4, Math.min(100, viewport.visibleHeight / viewport.layoutHeight * 100))
        const left = Math.max(0, Math.min(100 - visibleWidth, viewport.offsetLeft / viewport.layoutWidth * 100))
        const top = Math.max(0, Math.min(100 - visibleHeight, viewport.offsetTop / viewport.layoutHeight * 100))

        minimap.style.width = `${mapWidth}px`
        minimap.style.height = `${mapHeight}px`
        minimap.style.transform = `translate3d(${mapLeft}px, ${mapTop}px, 0) scale(${scaleCompensation})`
        viewportWindow.style.left = `${left}%`
        viewportWindow.style.top = `${top}%`
        viewportWindow.style.width = `${visibleWidth}%`
        viewportWindow.style.height = `${visibleHeight}%`
        scaleLabel.textContent = `${viewport.scale.toFixed(1)}×`
      })
    }
    const clearHideTimer = () => window.clearTimeout(hideTimer)
    const showForThreeSeconds = () => {
      if ((window.visualViewport?.scale ?? 1) <= ZOOM_THRESHOLD) return
      clearHideTimer()
      setVisible(true)
      hideTimer = window.setTimeout(() => setVisible(false), MINIMAP_DISPLAY_DURATION)
    }
    const scheduleSettledOverview = () => {
      setVisible(false)
      clearHideTimer()
      window.clearTimeout(settleTimer)
      update()
    }
    const handleViewportActivity = () => {
      scheduleSettledOverview()
      settleTimer = window.setTimeout(() => {
        if (disposed) return
        update()
        requestAnimationFrame(showForThreeSeconds)
      }, 220)
    }
    const handleTouchStart = () => {
      update()
      showForThreeSeconds()
    }
    const handleTouchMove = () => {
      update()
      if ((window.visualViewport?.scale ?? 1) > ZOOM_THRESHOLD) handleViewportActivity()
    }
    const handleTouchEnd = (event) => {
      update()
      if (event.touches.length === 0) handleViewportActivity()
    }
    const handleBlur = () => {
      setVisible(false)
      clearHideTimer()
      window.clearTimeout(settleTimer)
    }
    const visualViewport = window.visualViewport

    update()
    visualViewport.addEventListener('resize', handleViewportActivity)
    visualViewport.addEventListener('scroll', handleViewportActivity)
    window.addEventListener('resize', handleViewportActivity)
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true })
    document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true })
    window.addEventListener('blur', handleBlur)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.clearTimeout(hideTimer)
      visualViewport.removeEventListener('resize', handleViewportActivity)
      visualViewport.removeEventListener('scroll', handleViewportActivity)
      window.removeEventListener('resize', handleViewportActivity)
      document.removeEventListener('touchstart', handleTouchStart, true)
      document.removeEventListener('touchmove', handleTouchMove, true)
      document.removeEventListener('touchend', handleTouchEnd, true)
      document.removeEventListener('touchcancel', handleTouchEnd, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled])

  if (!enabled) return null

  return createPortal((
    <div
      className={`zoom-viewport-overlay${visible ? ' is-visible' : ''}`}
      aria-hidden="true"
    >
      <div
        ref={minimapRef}
        className="zoom-viewport-minimap"
      >
        <div className="zoom-viewport-minimap-screen">
          <div ref={viewportWindowRef} className="zoom-viewport-minimap-window" />
        </div>
        <span ref={scaleLabelRef} className="zoom-viewport-minimap-scale">1.0×</span>
      </div>
    </div>
  ), document.body)
}
