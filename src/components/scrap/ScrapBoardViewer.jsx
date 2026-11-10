import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowsIn } from '@phosphor-icons/react'
import { SCRAP_WIDTH } from '../../domain/scrapBoard'
import ScrapPaper from './ScrapPaper'

const MAX_ZOOM = 3

/**
 * Read-only 낙서장 board that fills its parent. The page is scaled to the
 * parent's width and scrolls vertically (webtoon style). Two fingers zoom
 * in and out inside the box only.
 */
export default function ScrapBoardViewer({ board, darkMode = false }) {
  const scrollerRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const pinchRef = useRef(null)
  const pendingScrollRef = useRef(null)

  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (!element) return undefined
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = scrollerRef.current
    const pending = pendingScrollRef.current
    if (!element || !pending) return
    pendingScrollRef.current = null
    element.scrollLeft = Math.max(0, pending.left)
    element.scrollTop = Math.max(0, pending.top)
  }, [zoom])

  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return undefined

    const distance = (touches) => Math.hypot(
      touches[1].clientX - touches[0].clientX,
      touches[1].clientY - touches[0].clientY,
    )
    const midpoint = (touches, rect) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
      y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
    })

    const onTouchStart = (event) => {
      if (event.touches.length !== 2) return
      event.stopPropagation()
      const rect = element.getBoundingClientRect()
      const mid = midpoint(event.touches, rect)
      pinchRef.current = {
        startDistance: distance(event.touches) || 1,
        startZoom: zoomRef.current,
        anchorX: (element.scrollLeft + mid.x) / zoomRef.current,
        anchorY: (element.scrollTop + mid.y) / zoomRef.current,
      }
    }

    const onTouchMove = (event) => {
      const pinch = pinchRef.current
      if (!pinch) return
      event.stopPropagation()
      if (event.touches.length !== 2) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const mid = midpoint(event.touches, rect)
      const next = Math.min(MAX_ZOOM, Math.max(1, pinch.startZoom * (distance(event.touches) / pinch.startDistance)))
      pendingScrollRef.current = {
        left: pinch.anchorX * next - mid.x,
        top: pinch.anchorY * next - mid.y,
      }
      zoomRef.current = next
      setZoom(next)
    }

    const onTouchEnd = (event) => {
      if (!pinchRef.current || event.touches.length >= 2) return
      pinchRef.current = null
      if (zoomRef.current < 1.05) {
        zoomRef.current = 1
        setZoom(1)
      }
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const resetZoom = () => {
    const element = scrollerRef.current
    if (element) {
      pendingScrollRef.current = { left: 0, top: element.scrollTop / zoomRef.current }
    }
    zoomRef.current = 1
    setZoom(1)
  }

  const base = size.width > 0 ? size.width / SCRAP_WIDTH : 1
  const logicalHeight = Math.max(board.h, size.height / base)
  const scale = base * zoom
  const zoomed = zoom > 1.001

  return (
    <>
      <div
        ref={scrollerRef}
        className="spot-card-scrap-scroller absolute inset-0 overflow-y-auto overscroll-contain"
        data-zoomed={zoomed ? 'true' : 'false'}
        aria-label="낙서장"
        style={{
          overflowX: zoomed ? 'auto' : 'hidden',
          touchAction: zoomed ? 'pan-x pan-y' : 'pan-y',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin',
          filter: darkMode ? 'brightness(0.86)' : undefined,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: SCRAP_WIDTH * scale,
            height: logicalHeight * scale,
            visibility: size.width > 0 ? 'visible' : 'hidden',
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <ScrapPaper board={board} height={logicalHeight} />
          </div>
        </div>
      </div>
      {zoomed && (
        <button
          type="button"
          onClick={resetZoom}
          className="scrap-pill absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center"
          aria-label="원래 크기로"
        >
          <ArrowsIn size={14} weight="bold" />
        </button>
      )}
    </>
  )
}
