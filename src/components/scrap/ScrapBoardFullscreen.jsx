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

  // While open, the status-bar area must not show white: darken the theme
  // colour (browser/Android bar) and the page background behind everything
  // (iPhone safe area), then restore both on close.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const previousTheme = meta?.getAttribute('content') ?? null
    meta?.setAttribute('content', '#000000')
    const html = document.documentElement
    const previousHtmlBg = html.style.backgroundColor
    const previousBodyBg = document.body.style.backgroundColor
    html.style.backgroundColor = '#000000'
    document.body.style.backgroundColor = '#000000'
    return () => {
      if (meta) {
        if (previousTheme === null) meta.removeAttribute('content')
        else meta.setAttribute('content', previousTheme)
      }
      html.style.backgroundColor = previousHtmlBg
      document.body.style.backgroundColor = previousBodyBg
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
      className="fixed inset-0 flex flex-col transition-opacity duration-200"
      // Same layer and plain background as the photo lightbox. No blur: iPhone
      // Safari leaves blurred fixed overlays out of the status-bar area, which
      // then shows the white page behind it.
      style={{ opacity: shown ? 1 : 0, zIndex: 2147483647, background: 'rgba(0, 0, 0, 0.85)' }}
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
