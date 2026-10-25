import { useCallback, useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModalFocus(dialogRef, onClose) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    dialogRef.current?.focus()

    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [dialogRef])

  return useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0,
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (!first) {
      event.preventDefault()
      dialog.focus()
    } else if (
      event.shiftKey &&
      (active === first || active === dialog || !dialog.contains(active))
    ) {
      event.preventDefault()
      last.focus()
    } else if (
      !event.shiftKey &&
      (active === last || active === dialog || !dialog.contains(active))
    ) {
      event.preventDefault()
      first.focus()
    }
  }, [dialogRef, onClose])
}
