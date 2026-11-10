import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

let openPopups = 0

/**
 * Admin edit forms open in this popup instead of expanding inside the list.
 * Bottom sheet on phones, centred panel on wide screens; the content scrolls
 * inside it and the page behind stays still. Closes with the X button, the
 * form's own 취소, or Esc (not by tapping outside, so edits are not lost).
 */
export default function EditPopup({ label, onClose, children }) {
  const [shown, setShown] = useState(false)
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // Runs once per opening: focus, scroll lock and Esc. (onClose is read from
  // a ref so typing in the form never re-runs this and steals focus.)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true))
    openPopups += 1
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previousFocus = document.activeElement
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape' && !document.querySelector('.uvain-dialog-layer')) onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      openPopups -= 1
      if (openPopups === 0) document.body.style.overflow = previousOverflow
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className="admin-edit-popup fixed inset-0" style={{ zIndex: 1500 }}>
      <div
        className="absolute inset-0 bg-gray-900/45 transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-2xl flex-col rounded-t-3xl bg-gray-50 shadow-2xl outline-none transition-[opacity,transform] duration-300 sm:bottom-auto sm:top-1/2 sm:rounded-3xl"
        style={{
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 16px)',
          opacity: shown ? 1 : 0,
          // Only animate while opening: a transform at rest would make
          // position:fixed children (the photo cropper) position relative to
          // this panel instead of the screen.
          transform: shown ? undefined : 'translateY(32px)',
          transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div className="relative flex flex-shrink-0 items-center justify-center px-4 pb-1 pt-2.5">
          <div className="h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3 top-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200"
          >
            <X size={20} weight="bold" />
          </button>
        </div>
        <div
          className="admin-edit-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
