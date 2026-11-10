import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import ScrapBoardViewer from './ScrapBoardViewer'

/**
 * Full-screen 낙서장 for everyone: opened by tapping the board on the
 * SpotCard. Scrolls up and down; two fingers zoom.
 */
export default function ScrapBoardFullscreen({ board, placeName, darkMode = false, onClose }) {
  const [shown, setShown] = useState(false)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // The phone's status bar takes the page's theme colour (white). Make it dark
  // while the full-screen 낙서장 is open, then put the old colour back.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return undefined
    const previous = meta.getAttribute('content')
    meta.setAttribute('content', '#1f2937')
    return () => {
      if (previous === null) meta.removeAttribute('content')
      else meta.setAttribute('content', previous)
    }
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true))
    const previousFocus = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey, true)
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col bg-gray-900/90 backdrop-blur-md transition-opacity duration-200"
      // Topmost layer like the photo lightbox, so the dark backdrop also covers
      // the app's top bar and safe area in light mode.
      style={{ opacity: shown ? 1 : 0, zIndex: 2147483646 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${placeName || ''} 낙서장`}
      // Keep the map and card behind from reacting to these touches.
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <div
        className="flex flex-shrink-0 items-center gap-2 px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight text-white">낙서장</p>
          {placeName && <p className="truncate text-xs text-white/70">{placeName}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25"
        >
          <X size={20} weight="bold" />
        </button>
      </div>
      <div
        className="relative mx-auto min-h-0 w-full max-w-[520px] flex-1 overflow-hidden rounded-t-2xl transition-transform duration-300"
        style={{
          transform: shown ? undefined : 'translateY(24px)',
          transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <ScrapBoardViewer board={board} darkMode={darkMode} />
      </div>
    </div>,
    document.body,
  )
}
