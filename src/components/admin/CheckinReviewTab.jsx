import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import LoadingIndicator from '../LoadingIndicator'

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
 * Admin 'Check-IN 점검' tab: members whose Check-INs in the last 30 days look
 * unusual (store QR codes are not secret, so remote Check-INs are possible).
 * An admin marks a member 검토 완료; a newer flag moves them back by itself.
 */
export default function CheckinReviewTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('open')
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    const { data, error: loadError } = await supabase.rpc('admin_checkin_review', { p_days: 30 })
    if (loadError || !Array.isArray(data)) {
      setError('Check-IN 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } else {
      setRows(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Initial load; load() sets state only after the request returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const setReviewed = async (row, reviewed) => {
    setSavingId(row.user_id)
    setError('')
    const { error: saveError } = await supabase.rpc('admin_set_checkin_review', {
      p_user_id: row.user_id,
      p_reviewed: reviewed,
      p_through: reviewed ? row.latest_at : null,
    })
    if (saveError) {
      setError('저장하지 못했습니다. 다시 시도해 주세요.')
    } else {
      await load()
    }
    setSavingId(null)
  }

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingIndicator /></div>

  const openRows = rows.filter((row) => !row.reviewed_at)
  const doneRows = rows.filter((row) => row.reviewed_at)
  const visibleRows = view === 'open' ? openRows : doneRows

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">확인이 필요한 Check-IN</h2>
        <button onClick={load} className="text-sm text-blue-600">새로고침</button>
      </div>
      <p className="break-keep text-xs leading-snug text-gray-500">
        최근 30일 동안 아래 패턴이 보인 회원이에요. 부정 사용이 아닐 수도 있으니 매장 기록과 비교해 확인해 주세요.
        검토 완료한 회원도 새 패턴이 생기면 다시 검토 필요로 옮겨져요.
      </p>
      <div className="flex gap-2" role="tablist" aria-label="Check-IN 점검 상태">
        {[
          { key: 'open', label: '검토 필요', count: openRows.length },
          { key: 'done', label: '검토 완료', count: doneRows.length },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={view === tab.key}
            onClick={() => setView(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === tab.key ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600'}`}
          >
            {tab.label} {tab.count}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {visibleRows.length === 0 ? (
        <p className="rounded-xl bg-white p-5 text-sm text-gray-500">
          {view === 'open' ? '확인이 필요한 Check-IN이 없습니다.' : '검토 완료한 회원이 없습니다.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleRows.map((row) => (
            <li key={row.user_id} className="rounded-xl border border-gray-100 bg-white p-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">{row.member_name}</span>
                {row.student_number && <span className="text-gray-500">{row.student_number}</span>}
                <span className="ml-auto text-gray-500">최근 {formatDate(row.latest_at)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(row.reasons || []).map((reason) => (
                  <span key={reason} className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900 ring-1 ring-amber-200">
                    {CHECKIN_REVIEW_REASONS[reason] || reason}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-gray-400">
                  {row.reviewed_at ? `검토 완료 ${formatDate(row.reviewed_at)}` : ''}
                </span>
                <button
                  type="button"
                  disabled={savingId === row.user_id}
                  onClick={() => setReviewed(row, !row.reviewed_at)}
                  className={row.reviewed_at
                    ? 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-50'
                    : 'rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50'}
                >
                  {savingId === row.user_id ? '저장 중...' : row.reviewed_at ? '다시 검토' : '검토 완료'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
