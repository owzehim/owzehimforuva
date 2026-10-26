import { useEffect, useState } from 'react'

const ZOOM_THRESHOLD = 1.04

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
  const [touching, setTouching] = useState(false)

  useEffect(() => {
    if (!enabled || !window.visualViewport) return undefined

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setViewport(readViewport()))
    }
    const handleTouchStart = () => {
      setTouching(true)
      update()
    }
    const handleTouchMove = () => update()
    const handleTouchEnd = (event) => {
      if (event.touches.length === 0) setTouching(false)
      update()
    }
    const handleBlur = () => setTouching(false)
    const visualViewport = window.visualViewport

    update()
    visualViewport.addEventListener('resize', update)
    visualViewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true })
    document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true })
    window.addEventListener('blur', handleBlur)

    return () => {
      cancelAnimationFrame(frame)
      visualViewport.removeEventListener('resize', update)
      visualViewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('touchstart', handleTouchStart, true)
      document.removeEventListener('touchmove', handleTouchMove, true)
      document.removeEventListener('touchend', handleTouchEnd, true)
      document.removeEventListener('touchcancel', handleTouchEnd, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled])

  if (!enabled || !viewport) return null

  const isZoomed = viewport.scale > ZOOM_THRESHOLD
  const visible = isZoomed && touching
  const mapWidth = 58
  const mapHeight = Math.max(96, Math.min(150, mapWidth * viewport.layoutHeight / viewport.layoutWidth))
  const scaleCompensation = 1 / viewport.scale
  const visibleWidth = Math.max(4, Math.min(100, viewport.visibleWidth / viewport.layoutWidth * 100))
  const visibleHeight = Math.max(4, Math.min(100, viewport.visibleHeight / viewport.layoutHeight * 100))
  const left = Math.max(0, Math.min(100 - visibleWidth, viewport.offsetLeft / viewport.layoutWidth * 100))
  const top = Math.max(0, Math.min(100 - visibleHeight, viewport.offsetTop / viewport.layoutHeight * 100))
  const screenLeft = viewport.offsetLeft + (viewport.safeLeft + 10) * scaleCompensation
  const screenTop = viewport.offsetTop + (viewport.safeTop + 10) * scaleCompensation

  return (
    <div
      className={`zoom-viewport-minimap${visible ? ' is-visible' : ''}`}
      aria-hidden="true"
      style={{
        left: screenLeft,
        top: screenTop,
        width: mapWidth,
        height: mapHeight,
        '--inverse-zoom': scaleCompensation,
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
  )
}
