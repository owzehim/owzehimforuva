import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowsClockwise, CircleNotch } from '@phosphor-icons/react'
import { applyWaitingUpdate, isUpdatePromptHiddenOn, isUpdateReady, onUpdateReady } from '../lib/appUpdate.js'

// OPS-17: "새로운 업데이트가 있어요!" card. Shows once a new version is waiting;
// 나중에 hides it until the app is opened again; 업데이트 switches versions.
export default function UpdatePrompt() {
  const location = useLocation()
  const [ready, setReady] = useState(() => isUpdateReady())
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [legalConsentOpen, setLegalConsentOpen] = useState(false)

  useEffect(() => onUpdateReady(setReady), [])

  // The policy-acceptance screen can appear on any route; it marks itself.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const check = () => setLegalConsentOpen(Boolean(document.querySelector('[data-legal-consent-screen]')))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  if (!ready || dismissed || legalConsentOpen || isUpdatePromptHiddenOn(location.pathname)) return null

  const aboveTabs = location.pathname === '/member' || location.pathname === '/public'

  const update = () => {
    if (updating) return
    setUpdating(true)
    if (!applyWaitingUpdate()) setUpdating(false)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-3 right-3 mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-[#2c2c2e] dark:shadow-none dark:bg-[#1c1c1e]"
      style={{
        bottom: aboveTabs
          ? 'calc(env(safe-area-inset-bottom) + 108px)'
          : 'calc(env(safe-area-inset-bottom) + 16px)',
        zIndex: 1100,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
          {updating
            ? <CircleNotch size={18} className="animate-spin" aria-hidden="true" />
            : <ArrowsClockwise size={18} aria-hidden="true" />}
        </div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {updating ? '업데이트 중…' : '새로운 업데이트가 있어요!'}
        </p>
      </div>
      {!updating && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-1 rounded-full border border-gray-200 py-2 text-[13px] text-gray-600 dark:border-[#3a3a3c] dark:text-gray-300"
          >
            나중에
          </button>
          <button
            type="button"
            onClick={update}
            className="flex-1 rounded-full bg-orange-500 py-2 text-[13px] font-semibold text-white"
          >
            업데이트
          </button>
        </div>
      )}
    </div>
  )
}
