import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, ClockCounterClockwise } from '@phosphor-icons/react'
import { fetchAllMemberStampData, restoreReward } from '../api/rewards'
import { adminInsertVisit } from '../api/visits'
import { isPendingRewardAvailable } from '../rewardAvailability'

export default function StampCardMemberPanel({ restaurantId, spotName, totalStamps, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [slideIn, setSlideIn] = useState(false)

  // Slide-up on mount
  useEffect(() => {
    const t = setTimeout(() => setSlideIn(true), 30)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!restaurantId || !totalStamps) return undefined
    let active = true
    const load = async () => {
      try {
        const data = await fetchAllMemberStampData(restaurantId, totalStamps)
        if (active) setRows(data)
      } catch (error) {
        if (active) console.error('fetchAllMemberStampData error:', error)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [restaurantId, totalStamps])

  const load = async () => {
    setLoading(true)
    try {
      setRows(await fetchAllMemberStampData(restaurantId, totalStamps))
    } catch (error) {
      console.error('fetchAllMemberStampData error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        transform: slideIn ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 350ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <button onClick={onClose} className="text-gray-500">
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div>
          <p className="text-sm font-semibold text-gray-900">{spotName} · 스탬프 관리</p>
          <p className="text-xs text-gray-400">총 {totalStamps}개 스탬프</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center mt-16">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-16">멤버가 없습니다</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map(({ member, stampState, latestReward }) => (
              <MemberRow
                key={member.id}
                member={member}
                stampState={stampState}
                latestReward={latestReward}
                totalStamps={totalStamps}
                restaurantId={restaurantId}
                onRefresh={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single member row ─────────────────────────────────────────────────────────
function MemberRow({ member, stampState, latestReward, totalStamps, restaurantId, onRefresh }) {
  const [addOpen, setAddOpen] = useState(false)
  const [date, setDate] = useState(todayString())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || '(이름 없음)'
  const { currentCycle, stampsInCurrentCycle } = stampState

  const handleAddStamp = async () => {
    setSubmitting(true)
    try {
      const result = await adminInsertVisit(
        member.user_id,
        restaurantId,
        totalStamps,
        `${date}T12:00:00Z`,
        note || null,
      )
      if (result?.auditLogged === false) {
        alert('스탬프는 반영됐지만 관리자 작업 기록 저장에 실패했습니다. 작업 기록을 확인해 주세요.')
      }
      if (result?.rewardPending) {
        alert('이미 적용 가능한 혜택이 있어요. 혜택 적용 완료 후 새 스탬프를 추가할 수 있습니다.')
        return
      }
      setAddOpen(false)
      setNote('')
      setDate(todayString())
      await onRefresh()
    } catch (e) {
      console.error('adminInsertVisit error:', e)
      alert('스탬프 추가 실패: ' + (e?.message || '알 수 없는 오류'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestoreReward = async () => {
    if (!latestReward) return
    if (!window.confirm('이 멤버의 리워드를 복원할까요?')) return
    setRestoring(true)
    try {
      const result = await restoreReward(latestReward.id)
      if (result?.auditLogged === false) {
        alert('리워드는 복원됐지만 관리자 작업 기록 저장에 실패했습니다. 작업 기록을 확인해 주세요.')
      }
      await onRefresh()
    } catch (e) {
      console.error('restoreReward error:', e)
    } finally {
      setRestoring(false)
    }
  }

  const rewardExpired = Boolean(
    latestReward?.expires_at && !isPendingRewardAvailable(latestReward),
  )
  const showRestore = latestReward?.redeemed === true && !latestReward.expires_at

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      {/* Member info row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{fullName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            현재 사이클: {currentCycle} · 스탬프: {stampsInCurrentCycle} / {totalStamps}
          </p>
          {latestReward && (
            <p className="text-xs mt-0.5" style={{ color: latestReward.redeemed || rewardExpired ? '#9ca3af' : '#f97316' }}>
              {rewardExpired
                ? '만료된 리워드'
                : latestReward.redeemed
                ? `리워드 사용됨 · ${latestReward.redeemed_at?.slice(0, 10)}`
                : '미사용 리워드 있음'}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setAddOpen((o) => !o)}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-600"
          >
            <Plus size={13} weight="bold" />
            스탬프 추가
          </button>

          {showRestore && (
            <button
              onClick={handleRestoreReward}
              disabled={restoring}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-600"
            >
              <ClockCounterClockwise size={13} weight="bold" />
              {restoring ? '복원 중...' : '리워드 복원'}
            </button>
          )}
        </div>
      </div>

      {/* Inline add-stamp form */}
      {addOpen && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-400">날짜</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-orange-400 focus-visible:border-orange-600 dark:focus-visible:border-orange-400"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-400">사유 (선택)</label>
              <input
                type="text"
                placeholder="사유 입력"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 outline-none focus:border-orange-400 focus-visible:border-orange-600 dark:focus-visible:border-orange-400"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddStamp}
              disabled={submitting}
              className="flex-1 py-1.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: submitting ? '#9ca3af' : '#f97316' }}
            >
              {submitting ? '추가 중...' : '확인'}
            </button>
            <button
              onClick={() => { setAddOpen(false); setNote(''); setDate(todayString()) }}
              className="flex-1 py-1.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function todayString() {
  return new Date().toISOString().slice(0, 10)
}
