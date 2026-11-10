import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, Info, MapPin, Trash, WarningCircle, XCircle } from '@phosphor-icons/react'
import { FeedbackContext } from './feedbackContext.js'

// In-app replacements for window.alert / window.confirm. They are ordinary
// app elements, so they look the same in Safari, Chrome and the installed PWA
// (no "app.uva-in.nl says…" header, never blocked by in-app browsers), follow
// dark mode and keep clear of the notch and home indicator.

const TOAST_TIMEOUT_MS = 3200
const ACTION_TOAST_TIMEOUT_MS = 6500
const LAYER = 2000

const TOAST_ICONS = {
  success: <CheckCircle size={22} weight="fill" className="flex-shrink-0 text-green-600" aria-hidden="true" />,
  info: <Info size={22} weight="fill" className="flex-shrink-0 text-gray-500" aria-hidden="true" />,
  error: <XCircle size={22} weight="fill" className="flex-shrink-0 text-red-500" aria-hidden="true" />,
  warning: <WarningCircle size={22} weight="fill" className="flex-shrink-0 text-amber-500" aria-hidden="true" />,
}

const DIALOG_ICONS = {
  trash: <Trash size={26} weight="bold" className="text-red-500" aria-hidden="true" />,
  warning: <WarningCircle size={28} weight="fill" className="text-amber-500" aria-hidden="true" />,
  location: <MapPin size={28} weight="fill" className="text-orange-500" aria-hidden="true" />,
  gift: <span className="text-4xl leading-none" aria-hidden="true">🎁</span>,
}

let nextId = 1

function Toast({ toast, onDismiss }) {
  const { type = 'info', title, message, action } = toast
  return (
    <div
      role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
      className="uvain-toast pointer-events-auto flex w-full items-center gap-2.5 rounded-2xl bg-white px-3.5 py-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.14)] dark:bg-[#1f1f22] dark:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      onClick={() => !action && onDismiss(toast.id)}
    >
      {TOAST_ICONS[type] || TOAST_ICONS.info}
      <div className="min-w-0 flex-1">
        <p className="break-keep text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
        {message && <p className="mt-0.5 break-keep text-xs leading-snug text-gray-500 dark:text-gray-400">{message}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="flex-shrink-0 whitespace-nowrap px-1 py-2 text-sm font-bold text-orange-500"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss(toast.id)
            action.onClick?.()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

function useDialogKeys(open, onCancel, containerRef) {
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const focusFirst = window.requestAnimationFrame(() => {
      // Focus the dialog itself (announced by screen readers, Esc/Tab work)
      // without drawing a focus ring on a button for touch users.
      containerRef.current?.focus({ preventScroll: true })
    })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
      // Keep keyboard focus inside the dialog.
      if (event.key === 'Tab' && containerRef.current) {
        const buttons = [...containerRef.current.querySelectorAll('button')]
        if (buttons.length === 0) return
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(focusFirst)
      document.removeEventListener('keydown', onKey)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, onCancel, containerRef])
}

function Dialog({ dialog, onResolve }) {
  const containerRef = useRef(null)
  const [shown, setShown] = useState(false)
  const cancel = useCallback(() => onResolve(false), [onResolve])
  useDialogKeys(true, cancel, containerRef)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const {
    kind = 'confirm',
    variant = 'sheet',
    tone = 'primary',
    icon,
    title,
    message,
    confirmLabel = '확인',
    cancelLabel = '취소',
  } = dialog
  const titleId = `uvain-dialog-title-${dialog.id}`
  const messageId = `uvain-dialog-message-${dialog.id}`
  const primaryClass = tone === 'danger'
    ? 'bg-red-500 text-white active:bg-red-600'
    : 'bg-orange-500 text-white active:bg-orange-600'
  const secondaryClass = 'bg-gray-100 text-gray-900 active:bg-gray-200 dark:bg-[#2c2c2e] dark:text-white'
  const isNotice = kind === 'notice'

  const iconNode = icon && DIALOG_ICONS[icon]
  const iconWrapClass = icon === 'trash'
    ? 'mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/15'
    : icon === 'location'
      ? 'mb-3.5 flex h-13 w-13 items-center justify-center rounded-2xl bg-orange-50 dark:bg-orange-500/15'
      : 'mx-auto mb-2 flex items-center justify-center'

  const body = (
    <>
      {iconNode && <div className={iconWrapClass} style={icon === 'location' ? { width: 52, height: 52 } : undefined}>{iconNode}</div>}
      <h2 id={titleId} className="break-keep text-lg font-bold leading-snug text-gray-900 dark:text-white">{title}</h2>
      {message && (
        <p id={messageId} className="mt-2 whitespace-pre-line break-keep text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {message}
        </p>
      )}
    </>
  )

  const buttons = isNotice ? (
    <button type="button" className={`mt-5 h-[50px] w-full rounded-full text-[15px] font-semibold ${primaryClass}`} onClick={() => onResolve(true)}>
      {confirmLabel}
    </button>
  ) : variant === 'dialog' ? (
    <div className="mt-5 flex gap-2.5">
      <button type="button" className={`h-[50px] flex-1 rounded-full text-[15px] font-semibold ${secondaryClass}`} onClick={cancel}>{cancelLabel}</button>
      <button type="button" className={`h-[50px] flex-1 rounded-full text-[15px] font-semibold ${primaryClass}`} onClick={() => onResolve(true)}>{confirmLabel}</button>
    </div>
  ) : (
    <div className="mt-5 flex flex-col gap-2.5">
      <button type="button" className={`h-[50px] w-full rounded-full text-[15px] font-semibold ${primaryClass}`} onClick={() => onResolve(true)}>{confirmLabel}</button>
      <button type="button" className={`h-[50px] w-full rounded-full text-[15px] font-semibold ${secondaryClass}`} onClick={cancel}>{cancelLabel}</button>
    </div>
  )

  const centered = variant === 'dialog'
  return (
    <div className="uvain-dialog-layer fixed inset-0" style={{ zIndex: LAYER + 100 }}>
      <div
        className="absolute inset-0 bg-gray-900/45 transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={isNotice ? () => onResolve(true) : cancel}
        aria-hidden="true"
      />
      <div
        ref={containerRef}
        tabIndex={-1}
        role={isNotice ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className={centered
          ? 'uvain-dialog outline-none absolute left-1/2 top-1/2 w-[calc(100%-56px)] max-w-[340px] rounded-[22px] bg-white px-[22px] pb-5 pt-[26px] text-center shadow-xl transition-all duration-200 dark:bg-[#1f1f22]'
          : `uvain-sheet outline-none absolute bottom-0 left-1/2 w-full max-w-[480px] rounded-t-3xl bg-white px-5 pt-[26px] shadow-xl transition-transform duration-300 dark:bg-[#1f1f22] ${icon === 'location' ? 'text-left' : 'text-center'}`}
        style={centered
          ? { transform: `translate(-50%, -50%) scale(${shown ? 1 : 0.96})`, opacity: shown ? 1 : 0 }
          : {
              transform: `translate(-50%, ${shown ? '0' : '100%'})`,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
              transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
            }}
      >
        {body}
        {buttons}
      </div>
    </div>
  )
}

export default function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialogs, setDialogs] = useState([])
  const timers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const showToast = useCallback((type, title, options = {}) => {
    const id = nextId++
    const toast = { id, type, title, message: options.message, action: options.action }
    setToasts((current) => [...current.filter((item) => item.title !== title).slice(-2), toast])
    const timeout = options.action ? ACTION_TOAST_TIMEOUT_MS : (options.duration ?? TOAST_TIMEOUT_MS)
    timers.current.set(id, window.setTimeout(() => dismissToast(id), timeout))
    return id
  }, [dismissToast])

  const openDialog = useCallback((dialog) => new Promise((resolve) => {
    const id = nextId++
    setDialogs((current) => [...current, { ...dialog, id, resolve }])
  }), [])

  const resolveDialog = useCallback((id, value) => {
    setDialogs((current) => {
      const dialog = current.find((item) => item.id === id)
      dialog?.resolve(value)
      return current.filter((item) => item.id !== id)
    })
  }, [])

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer)
  }, [])

  const api = useMemo(() => ({
    toast: {
      success: (title, options) => showToast('success', title, options),
      info: (title, options) => showToast('info', title, options),
      error: (title, options) => showToast('error', title, options),
      warning: (title, options) => showToast('warning', title, options),
    },
    /** Resolves true when confirmed, false when cancelled. */
    confirm: (options) => openDialog({ ...options, kind: 'confirm' }),
    /** One-button explainer (for example a missing permission). */
    notice: (options) => openDialog({ ...options, kind: 'notice', variant: 'sheet' }).then(() => undefined),
  }), [showToast, openDialog])

  const plainToasts = toasts.filter((toast) => !toast.action)
  const actionToasts = toasts.filter((toast) => toast.action)
  const activeDialog = dialogs[0]

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="uvain-toasts-top pointer-events-none fixed left-0 right-0 mx-auto flex w-full max-w-[480px] flex-col gap-2 px-4"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', zIndex: LAYER }}
            aria-live="polite"
          >
            {plainToasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />)}
          </div>
          <div
            className="uvain-toasts-bottom pointer-events-none fixed left-0 right-0 mx-auto flex w-full max-w-[480px] flex-col gap-2 px-3"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', zIndex: LAYER }}
            aria-live="polite"
          >
            {actionToasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />)}
          </div>
          {activeDialog && (
            <Dialog
              key={activeDialog.id}
              dialog={activeDialog}
              onResolve={(value) => resolveDialog(activeDialog.id, value)}
            />
          )}
        </>,
        document.body,
      )}
    </FeedbackContext.Provider>
  )
}
