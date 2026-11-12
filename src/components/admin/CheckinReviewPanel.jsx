import { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'

const CHECKIN_REVIEW_REASONS = {
  quick_switch: '10분 안에 다른 매장 2곳',
  daily_limit: '하루 3곳 Check-IN',
  same_store_frequent: '같은 매장 15일 이상',
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
}

/**
 * Admin 회원 tab: members whose Check-INs in the last 30 days look unusual
 * (store QR codes are not secret, so remote Check-INs are possible).
 * Renders nothing when there is nothing to review or the lookup fails.
 */
export default function CheckinReviewPanel() {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_checkin_review', { p_days: 30 }).then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return
      setRows(data)
    })
    return () => { cancelled = true }
  }, [])

  if (rows.length === 0) return null

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
        확인이 필요한 Check-IN
      </h3>
      <p className="mt-0.5 break-keep text-xs leading-snug text-amber-800 dark:text-amber-200/80">
        최근 30일 동안 아래 패턴이 보인 회원이에요. 부정 사용이 아닐 수도 있으니 매장 기록과 비교해 확인해 주세요.
      </p>
      <ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-500/20">
        {rows.map((row) => (
          <li key={row.user_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{row.member_name}</span>
            {row.student_number && <span className="text-gray-500 dark:text-gray-400">{row.student_number}</span>}
            {(row.reasons || []).map((reason) => (
              <span key={reason} className="rounded-full bg-white px-2 py-0.5 font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-transparent dark:text-amber-200 dark:ring-amber-500/40">
                {CHECKIN_REVIEW_REASONS[reason] || reason}
              </span>
            ))}
            <span className="ml-auto text-gray-500 dark:text-gray-400">{formatDate(row.latest_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
