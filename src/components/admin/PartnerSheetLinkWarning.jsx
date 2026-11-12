import { useEffect, useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'

/**
 * FUNC-12: warns admins about partners whose Sheet address is set but whose
 * Apps Script secret is switched off. Their check-in and reward rows never
 * reach the partner Sheet until the secret is switched on.
 * Shows nothing when everything is linked or the lookup fails.
 */
export default function PartnerSheetLinkWarning() {
  const [names, setNames] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_partner_sheet_link_issues').then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return
      setNames(data.map((row) => row.partnership_name || row.partnership_id).filter(Boolean))
    })
    return () => { cancelled = true }
  }, [])

  if (names.length === 0) return null

  return (
    <div role="status" className="mb-4 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left dark:border-amber-500/30 dark:bg-amber-500/10">
      <WarningCircle size={22} weight="fill" className="flex-shrink-0 text-amber-500" aria-hidden="true" />
      <div className="min-w-0">
        <p className="break-keep text-sm font-semibold text-amber-900 dark:text-amber-200">
          시트에 기록이 남지 않는 파트너가 있어요
        </p>
        <p className="mt-0.5 break-keep text-xs leading-snug text-amber-800 dark:text-amber-200/80">
          {names.join(', ')}: 시트 주소는 있지만 Apps Script 비밀값이 꺼져 있어 체크인·리워드 기록이 파트너 시트로 가지 않아요.
          파트너 시트에 비밀값을 넣고 켜 주세요.
        </p>
      </div>
    </div>
  )
}
