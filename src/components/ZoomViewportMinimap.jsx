import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ZOOM_THRESHOLD = 1.04
const ZOOM_SETTLE_DELAY = 220
const MINIMAP_DISPLAY_DURATION = 3000

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
  const [viewport, setViewport] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled || !window.visualViewport) return undefined

    let frame = 0
    let settleTimer = 0
    let hideTimer = 0
    let disposed = false
    const update = (onUpdated) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const nextViewport = readViewport()
        if (disposed) return
        setViewport(nextViewport)
        onUpdated?.(nextViewport)
      })
    }
    const clearHideTimer = () => {
      window.clearTimeout(hideTimer)
    }
    const showForThreeSeconds = () => {
      clearHideTimer()
      setVisible(true)
      hideTimer = window.setTimeout(() => setVisible(false), MINIMAP_DISPLAY_DURATION)
    }
    const handleTouchStart = () => {
      update((nextViewport) => {
        if (nextViewport?.scale > ZOOM_THRESHOLD) showForThreeSeconds()
      })
    }
    const handleViewportChange = () => {
      // Hide while native pinch/pan is moving, then show a snapshot of the settled viewport.
      setVisible(false)
      clearHideTimer()
      window.clearTimeout(settleTimer)
      update()
      settleTimer = window.setTimeout(() => {
        update((nextViewport) => {
          if (nextViewport?.scale > ZOOM_THRESHOLD) showForThreeSeconds()
          else setVisible(false)
        })
      }, ZOOM_SETTLE_DELAY)
    }
    const handleBlur = () => {
      setVisible(false)
      clearHideTimer()
      window.clearTimeout(settleTimer)
    }
    const visualViewport = window.visualViewport

    update()
    visualViewport.addEventListener('resize', handleViewportChange)
    visualViewport.addEventListener('scroll', handleViewportChange)
    window.addEventListener('resize', handleViewportChange)
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    window.addEventListener('blur', handleBlur)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.clearTimeout(hideTimer)
      visualViewport.removeEventListener('resize', handleViewportChange)
      visualViewport.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
      document.removeEventListener('touchstart', handleTouchStart, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled])

  if (!enabled || !viewport) return null

  const isZoomed = viewport.scale > ZOOM_THRESHOLD
  const mapWidth = 58
  const mapHeight = Math.max(96, Math.min(150, mapWidth * viewport.layoutHeight / viewport.layoutWidth))
  const scaleCompensation = 1 / viewport.scale
  const visibleWidth = Math.max(4, Math.min(100, viewport.visibleWidth / viewport.layoutWidth * 100))
  const visibleHeight = Math.max(4, Math.min(100, viewport.visibleHeight / viewport.layoutHeight * 100))
  const left = Math.max(0, Math.min(100 - visibleWidth, viewport.offsetLeft / viewport.layoutWidth * 100))
  const top = Math.max(0, Math.min(100 - visibleHeight, viewport.offsetTop / viewport.layoutHeight * 100))

  return createPortal((
    <div
      className={`zoom-viewport-overlay${visible ? ' is-visible' : ''}`}
      aria-hidden="true"
    >
      <div
        className="zoom-viewport-minimap"
        style={{
          left: viewport.safeLeft + 10,
          top: viewport.safeTop + 10,
          width: mapWidth,
          height: mapHeight,
          transform: `scale(${scaleCompensation})`,
        }}
      >
        <div className="zoom-viewport-minimap-screen">
          <div
            className="zoom-viewport-minimap-window"
            style={{ left: `${left}%`, top: `${top}%`, width: `${visibleWidth}%`, height: `${visibleHeight}%` }}
          />
        </div>
        <span className="zoom-viewport-minimap-scale">{viewport.scale.toFixed(1)}×</span>
      </div>
    </div>
  ), document.body)
}
