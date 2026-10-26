import { useCallback, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { hasAdminRole } from '../lib/adminRoles'
import { sanitizeRichText } from '../lib/sanitizeHtml'
import LoadingIndicator from '../components/LoadingIndicator'
import { useNavigate } from 'react-router-dom'
import { ImageCropper } from '../components/ImageCropper'
import { Plus, MapPin, Ticket, StarFour, UserCircle } from '@phosphor-icons/react'
import StampCardEditPanel from '../features/stampCard/components/StampCardEditPanel'
import StampCardMemberPanel from '../features/stampCard/components/StampCardMemberPanel'
import { fetchConfigBySpot } from '../features/stampCard/api/config'
import { preparePublicImage } from '../lib/preparePublicImage'
import { useModalFocus } from '../hooks/useModalFocus'
import {
  getRestaurantCommercialLabel,
  getRestaurantCommercialLabelType,
  RESTAURANT_COMMERCIAL_LABEL_TYPES,
} from '../lib/restaurantCommercialLabel'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the date part "YYYY-MM-DD" from whatever Supabase returns.
 */
function toLocalDateString(isoString) {
  if (!isoString) return ''
  const s = String(isoString)
  if (s.includes('T') || s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(d.getDate()).padStart(2, '0')}`
    }
  }
  return s.slice(0, 10)
}

function formatNoteDisplayDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

/**
 * Extract the time part "HH:MM" from whatever Supabase returns.
 * Converts timestamptz to local time; if already local, slice it.
 */
function toLocalTimeString(isoString) {
  if (!isoString) return ''
  const s = String(isoString)
  if (s.includes('+') || s.endsWith('Z') || s.includes('Z')) {
    const d = new Date(s)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  return s.length >= 16 ? s.slice(11, 16) : ''
}

function toEventEndTimeInput(event) {
  const endTime = toLocalTimeString(event?.event_end_date)
  if (!endTime) return ''

  const startDate = toLocalDateString(event?.event_date)
  const endDate = toLocalDateString(event?.event_end_date)

  if (endTime === '00:00' && (!endDate || endDate === startDate)) {
    return ''
  }

  return endTime
}

/**
 * Combine local date "YYYY-MM-DD" and time "HH:MM" into ISO string.
 */
function combineDateTime(dateStr, timeStr, fallbackTime = '00:00') {
  if (!dateStr) return null
  const time = timeStr || fallbackTime
  if (!time) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const local = new Date(y, mo - 1, d, h, mi, 0)
  return local.toISOString()
}

function getEventDateInputs(event) {
  const dates = Array.isArray(event?.event_dates) ? event.event_dates : []
  const fromList = dates.map((value) => toLocalDateString(value)).filter(Boolean)
  const fallback = toLocalDateString(event?.event_date)
  const uniqueDates = Array.from(new Set([...fromList, fallback].filter(Boolean)))
  return uniqueDates.length ? uniqueDates : ['']
}

/**
 * Validate & normalise a typed time string into "HH:MM".
 */
function normaliseTime(raw) {
  const s = raw.trim().replace(/[^0-9:]/g, '')
  const noColon = s.replace(':', '')
  if (noColon.length === 4) {
    const h = parseInt(noColon.slice(0, 2), 10)
    const m = parseInt(noColon.slice(2, 4), 10)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  const parts = s.split(':')
  if (parts.length === 2) {
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10)
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  return ''
}

function koreanSort(arr, key) {
  return [...arr].sort((a, b) =>
    (a[key] || '').localeCompare(b[key] || '', ['ko', 'en'])
  )
}

// ─── Time Input ───────────────────────────────────────────────────────────────

function TimeInput({ value, onChange, className = '' }) {
  const [draft, setDraft] = useState(value || '')
  const [error, setError] = useState(false)

  useEffect(() => {
    setDraft(value || '')
  }, [value])

  const handleChange = (e) => {
    setDraft(e.target.value)
    setError(false)
  }

  const handleBlur = () => {
    if (draft === '') {
      onChange('')
      setError(false)
      return
    }
    const normalised = normaliseTime(draft)
    if (normalised) {
      setDraft(normalised)
      setError(false)
      onChange(normalised)
    } else {
      setError(true)
    }
  }

  return (
    <div>
      <input
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        className={`${className} ${
          error ? 'border-red-400 bg-red-50' : ''
        }`}
      />
      {error && (
        <p className="text-xs text-red-500 mt-1">
          올바른 시간 형식을 입력하세요 (예: 14:30)
        </p>
      )}
    </div>
  )
}

// ─── AdminPage ────────────────────────────────────────────────────────────────

const ADMIN_ACTIVE_TAB_KEY = 'uvain_admin_active_tab'
const ADMIN_TABS = ['members', 'events', 'restaurants', 'reports']
const PUBLIC_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/avif'

async function uploadSanitizedPublicImage(bucket, file) {
  const preparedFile = await preparePublicImage(file)
  const { error } = await supabase.storage.from(bucket).upload(preparedFile.name, preparedFile)
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(preparedFile.name)
  return data.publicUrl
}

function getStoredAdminTab() {
  if (typeof window === 'undefined') return 'members'
  const storedTab = window.sessionStorage.getItem(ADMIN_ACTIVE_TAB_KEY)
  return ADMIN_TABS.includes(storedTab) ? storedTab : 'members'
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState(getStoredAdminTab)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const checkAdmin = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        navigate('/login')
        return
      }

      const isAdmin = await hasAdminRole(user.id)

      if (!isAdmin) {
        navigate('/member')
        return
      }

      setLoading(false)
    }

    checkAdmin()
  }, [navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingIndicator />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Header */}
      <div
        className="bg-white border-b border-gray-100 px-4 pb-3 flex items-center justify-between"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
          minHeight: 'calc(env(safe-area-inset-top) + 56px)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/member')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 내 QR
          </button>
          <h1 className="font-bold text-gray-900">관리자 패널</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut({ scope: 'local' })}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          로그아웃
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-4 flex gap-1 overflow-x-auto">
        {[
          { key: 'members', label: '멤버 관리' },
          { key: 'events', label: '이벤트' },
          { key: 'restaurants', label: '장소' },
          { key: 'reports', label: '신고 검토' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              if (tab.key === activeTab) return

              window.sessionStorage.setItem(ADMIN_ACTIVE_TAB_KEY, tab.key)
              setActiveTab(tab.key)
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="w-full px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'members' && <MembersTab />}
          {activeTab === 'events' && <EventsTab />}
          {activeTab === 'restaurants' && <RestaurantsTab />}
          {activeTab === 'reports' && <ReportsTab />}
        </div>
      </div>
    </div>
  )
}

function ReportsTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [noticeStatus, setNoticeStatus] = useState({})
  const [sendingNotice, setSendingNotice] = useState({})
  const [noticeDraft, setNoticeDraft] = useState(null)
  const noticeDialogRef = useRef(null)
  const handleNoticeDialogKeyDown = useModalFocus(
    noticeDialogRef,
    () => setNoticeDraft(null),
    { enabled: Boolean(noticeDraft) },
  )
  const [noticeSendError, setNoticeSendError] = useState('')
  const [savingReportId, setSavingReportId] = useState(null)
  const [decisionSelections, setDecisionSelections] = useState({})

  const loadReports = useCallback(async () => {
    setLoading(true)
    setError('')
    const [commentResult, noteResult] = await Promise.all([
      supabase
        .from('restaurant_comment_reports')
        .select('id, comment_id, created_at, reviewed_at')
        .order('reviewed_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('restaurant_note_reports')
        .select('id, note_id, created_at, reviewed_at, reporter_name, reporter_email, reason, explanation, good_faith, note_snapshot, restaurant_name_snapshot, content_author_email, content_author_name_snapshot, status, decision')
        .order('reviewed_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })
    ])

    if (commentResult.error || noteResult.error) {
      setError('신고 목록을 불러오지 못했습니다.')
      setLoading(false)
      return
    }

    const commentReports = commentResult.data || []
    const noteReports = noteResult.data || []
    const commentIds = commentReports.map((report) => report.comment_id)
    const noteIds = noteReports.map((report) => report.note_id).filter(Boolean)
    const [commentsResult, notesResult] = await Promise.all([
      commentIds.length
        ? supabase
            .from('restaurant_comments')
            .select('id, username, is_anonymous, body, created_at')
            .in('id', commentIds)
        : Promise.resolve({ data: [], error: null }),
      noteIds.length
        ? supabase
            .from('restaurant_notes')
            .select('id, username, is_anonymous, body, created_at')
            .in('id', noteIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (commentsResult.error || notesResult.error) {
      setError('신고된 내용을 불러오지 못했습니다.')
      setLoading(false)
      return
    }

    const commentsById = new Map((commentsResult.data || []).map((row) => [row.id, row]))
    const notesById = new Map((notesResult.data || []).map((row) => [row.id, row]))
    setItems([
      ...commentReports.map((report) => ({
        ...report,
        kind: '리뷰',
        target: commentsById.get(report.comment_id),
      })),
      ...noteReports.map((report) => ({
        ...report,
        kind: '한마디',
        target: notesById.get(report.note_id) || (report.note_snapshot ? {
          body: report.note_snapshot,
          username: report.content_author_name_snapshot || '익명',
          is_anonymous: report.content_author_name_snapshot === '익명',
          is_snapshot: true,
        } : null),
      })),
    ].sort((a, b) => {
      const reviewStateOrder = Number(Boolean(a.reviewed_at)) - Number(Boolean(b.reviewed_at))
      return reviewStateOrder || new Date(b.created_at) - new Date(a.created_at)
    }))
    setLoading(false)
  }, [])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  const markReviewed = async (item) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('로그인이 필요합니다.')
      return
    }
    const table = item.kind === '리뷰' ? 'restaurant_comment_reports' : 'restaurant_note_reports'
    const { data: updatedReport, error: updateError } = await supabase
      .from(table)
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', item.id)
      .is('reviewed_at', null)
      .select('id')
      .maybeSingle()
    if (updateError || !updatedReport) {
      setError('신고 상태를 저장하지 못했습니다.')
      return
    }
    await loadReports()
  }

  const setNoteHidden = async (noteId, hidden) => {
    if (!noteId) return false
    const { data: updatedNote, error: updateError } = await supabase
      .from('restaurant_notes')
      .update({ hidden_at: hidden ? new Date().toISOString() : null })
      .eq('id', noteId)
      .select('id')
      .maybeSingle()
    return !updateError && Boolean(updatedNote)
  }

  const saveNoteReportDecision = async (item, decision) => {
    if (savingReportId === item.id) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('로그인이 필요합니다.')
      return
    }

    setSavingReportId(item.id)
    const previousVisibility = item.decision === 'content_hidden'
    const nextVisibility = decision === 'content_hidden'
    const visibilityChanged = Boolean(item.note_id) && previousVisibility !== nextVisibility
    if (visibilityChanged && !await setNoteHidden(item.note_id, nextVisibility)) {
      setSavingReportId(null)
      setError('댓글을 숨기지 못했습니다. 신고 상태는 변경되지 않았습니다.')
      return
    }

    const { data: updatedReport, error: updateError } = await supabase
      .from('restaurant_note_reports')
      .update({
        status: 'resolved',
        decision,
      })
      .eq('id', item.id)
      .eq('status', item.status)
      .select('id')
      .maybeSingle()

    if (updateError || !updatedReport) {
      if (visibilityChanged) await setNoteHidden(item.note_id, previousVisibility)
      setSavingReportId(null)
      setError('신고 처리 결과를 저장하지 못했습니다.')
      await loadReports()
      return
    }
    setDecisionSelections((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setSavingReportId(null)
    setError('')
    await loadReports()
  }

  const cancelNoteReportDecision = async (item) => {
    if (savingReportId === item.id) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('로그인이 필요합니다.')
      return
    }

    setSavingReportId(item.id)
    const wasHidden = item.decision === 'content_hidden'
    if (wasHidden && item.note_id && !await setNoteHidden(item.note_id, false)) {
      setSavingReportId(null)
      setError('댓글 숨김을 취소하지 못했습니다. 신고 상태는 변경되지 않았습니다.')
      return
    }

    const { data: updatedReport, error: updateError } = await supabase
      .from('restaurant_note_reports')
      .update({
        status: 'pending',
        decision: null,
      })
      .eq('id', item.id)
      .eq('status', 'resolved')
      .select('id')
      .maybeSingle()

    if (updateError || !updatedReport) {
      if (wasHidden && item.note_id) await setNoteHidden(item.note_id, true)
      setSavingReportId(null)
      setError('처리를 취소하지 못했습니다.')
      await loadReports()
      return
    }

    setDecisionSelections((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setSavingReportId(null)
    setError('')
    await loadReports()
  }

  const confirmNoteReportAction = async (item) => {
    if (savingReportId === item.id) return
    const selectedDecision = decisionSelections[item.id] ?? item.decision
    const canCancelLegacyDeletion = item.decision === 'content_deleted' && !item.note_id

    if (item.status === 'resolved' && selectedDecision === item.decision) {
      if (canCancelLegacyDeletion) return
      if (!window.confirm('처리 완료를 취소하시겠습니까? 이미 발송된 이메일은 회수되지 않습니다.')) return
      await cancelNoteReportDecision(item)
      return
    }

    if (!['content_hidden', 'no_action'].includes(selectedDecision)) {
      setError('숨김 처리 또는 조치 없음을 먼저 선택해 주세요.')
      return
    }
    if (!window.confirm('신고를 처리하시겠습니까?')) return
    await saveNoteReportDecision(item, selectedDecision)
  }

  const openReportNotice = (item, recipientKind) => {
    const deleted = item.decision === 'content_deleted'
    const previouslyHidden = item.decision === 'content_hidden'
    const subject = recipientKind === 'reporter'
      ? '[UvA-IN] 신고 처리 결과'
      : '[UvA-IN] 게시물 처리 안내'
    const intro = recipientKind === 'reporter'
      ? "안녕하세요, UvA-IN App 관리자입니다.\n'가본 사람 한마디' 장소 댓글 신고 건에 대해 안내드립니다.\n건강하고 유익한 커뮤니티 환경을 위해 제보해 주셔서 감사합니다."
      : "안녕하세요, UvA-IN App 관리자입니다.\n회원님이 작성하신 '가본 사람 한마디' 댓글에 대한 신고 검토 결과를 안내드립니다."
    const outcome = recipientKind === 'reporter'
      ? deleted
        ? '커뮤니티 운영 정책 위반으로 확인되어 삭제 조치되었습니다.'
        : previouslyHidden
          ? '해당 댓글을 다른 회원에게 보이지 않도록 숨김 처리했습니다.'
          : '검토 결과 운영 정책 위반 사항이 확인되지 않아 조치 없이 유지되었습니다.'
      : deleted
        ? '커뮤니티 운영 정책 위반으로 확인되어 삭제 조치되었습니다.'
        : previouslyHidden
          ? '회원님의 댓글을 다른 회원에게 보이지 않도록 숨김 처리했습니다.'
          : '회원님의 댓글은 숨김 처리되지 않았으며, 현재 앱에서 계속 확인할 수 있습니다.'

    setNoticeSendError('')
    setNoticeDraft({
      reportId: item.id,
      recipientKind,
      recipient: recipientKind === 'reporter' ? item.reporter_email : item.content_author_email,
      author: item.content_author_name_snapshot || (item.target?.is_anonymous ? '익명' : item.target?.username) || '익명',
      content: item.note_snapshot || item.target?.body || '',
      createdAt: formatNoteDisplayDate(item.target?.created_at),
      subject,
      intro,
      outcome,
      contact: 'uvaksa16@gmail.com',
    })
  }

  const sendReportNotice = async () => {
    if (!noticeDraft) return
    const { reportId, recipientKind, subject, intro, outcome, contact } = noticeDraft
    const key = `${reportId}:${recipientKind}`
    if (sendingNotice[key]) return
    setSendingNotice((current) => ({ ...current, [key]: true }))
    setNoticeSendError('')
    const { data, error: sendError } = await supabase.functions.invoke('send-content-report-notice', {
      body: { reportId, recipientKind, subject, intro, outcome, contact },
    })
    setSendingNotice((current) => ({ ...current, [key]: false }))
    if (sendError || !data?.success) {
      setNoticeSendError(data?.message || '이메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setNoticeStatus((current) => ({ ...current, [key]: 'sent' }))
    setNoticeDraft(null)
  }

  const reportReasonLabel = (reason) => ({
    illegal_threat: '위협 또는 괴롭힘',
    privacy: '개인정보 또는 사생활 침해',
    intellectual_property: '저작권 또는 지식재산권 침해',
    other_illegal: '그 밖의 불법 콘텐츠',
    community_guidelines: '커뮤니티 가이드라인 위반',
  }[reason] || '기존 신고')

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingIndicator /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">리뷰·한마디 신고</h2>
        <button onClick={loadReports} className="text-sm text-blue-600">새로고침</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {items.length === 0 ? (
        <p className="rounded-xl bg-white p-5 text-sm text-gray-500">접수된 신고가 없습니다.</p>
      ) : items.map((item) => {
        const selectedDecision = decisionSelections[item.id] ?? item.decision
        const isResolved = item.kind === '한마디' && item.status === 'resolved'
        const decisionChanged = isResolved && selectedDecision && selectedDecision !== item.decision
        const legacyDeletion = item.decision === 'content_deleted' && !item.note_id
        const confirmLabel = isResolved && !decisionChanged
          ? '처리 완료'
          : isResolved
            ? '변경 확인'
            : '신고 확인'

        return (
        <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {item.kind} · {new Date(item.created_at).toLocaleString('nl-NL')}
              {item.reviewed_at && <span className="ml-2 text-green-700">검토 완료</span>}
            </div>
            {item.kind === '한마디' ? (
              <div className="flex shrink-0 gap-2">
                {item.kind === '한마디' && item.note_id && (
                  <button
                    type="button"
                    aria-pressed={selectedDecision === 'content_hidden'}
                    disabled={savingReportId === item.id}
                    onClick={() => setDecisionSelections((current) => ({ ...current, [item.id]: 'content_hidden' }))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${selectedDecision === 'content_hidden' ? 'border-green-600 bg-green-600 text-white' : 'border-amber-200 text-amber-700'}`}
                  >
                    숨김 처리
                  </button>
                )}
                {!(item.decision === 'content_deleted' && !item.note_id) && (
                  <button
                    type="button"
                    aria-pressed={selectedDecision === 'no_action'}
                    disabled={savingReportId === item.id}
                    onClick={() => setDecisionSelections((current) => ({ ...current, [item.id]: 'no_action' }))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${selectedDecision === 'no_action' ? 'border-green-600 bg-green-600 text-white' : 'border-blue-200 text-blue-700'}`}
                  >
                    조치 없음
                  </button>
                )}
              </div>
            ) : !item.reviewed_at && (
              <div className="flex shrink-0 gap-2">
                {(
                  <button onClick={() => markReviewed(item)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
                    검토 완료
                  </button>
                )}
              </div>
            )}
          </div>
          {item.kind === '한마디' && (
            <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <p>사유: {reportReasonLabel(item.reason)}</p>
              {item.explanation && <p className="whitespace-pre-wrap">설명: {item.explanation}</p>}
              {item.reporter_name && <p>신고자: {item.reporter_name} · {item.reporter_email}</p>}
              <p>선의 확인: {item.good_faith ? '완료' : '기존 신고에는 기록 없음'}</p>
              {item.status === 'resolved' && (
                <p>결정: {item.decision === 'content_deleted' ? '과거 댓글 삭제' : item.decision === 'content_hidden' ? '숨김 처리' : item.decision === 'no_action' ? '조치 없음' : '기존 검토 완료'}</p>
              )}
            </div>
          )}
          {item.target ? (
            <>
              <p className="text-sm font-medium text-gray-800">
                {item.target.is_anonymous ? '익명' : item.target.username || '사용자'}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{item.target.body}</p>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-gray-500">
              {item.note_snapshot || '원문이 이미 삭제되었습니다.'}
            </p>
          )}
          {item.kind === '한마디' && item.status === 'resolved' && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.reporter_email && (
                <button type="button" onClick={() => openReportNotice(item, 'reporter')} disabled={sendingNotice[`${item.id}:reporter`] || noticeStatus[`${item.id}:reporter`] === 'sent'} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-blue-700 disabled:opacity-50">
                  {noticeStatus[`${item.id}:reporter`] === 'sent' ? '신고자 이메일 전송 완료' : '신고자에게 결과 이메일 보내기'}
                </button>
              )}
              {(item.decision === 'content_deleted' || item.decision === 'content_hidden') && item.content_author_email && (
                <button type="button" onClick={() => openReportNotice(item, 'author')} disabled={sendingNotice[`${item.id}:author`] || noticeStatus[`${item.id}:author`] === 'sent'} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-blue-700 disabled:opacity-50">
                  {noticeStatus[`${item.id}:author`] === 'sent' ? '작성자 이메일 전송 완료' : '작성자에게 조치 이메일 보내기'}
                </button>
              )}
            </div>
          )}
          {item.kind === '한마디' && (
            <div className="flex justify-end border-t border-gray-100 pt-2">
              <button
                type="button"
                aria-pressed={isResolved && !decisionChanged}
                disabled={savingReportId === item.id || (isResolved && legacyDeletion && !decisionChanged) || (!isResolved && !selectedDecision)}
                onClick={() => confirmNoteReportAction(item)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${isResolved && !decisionChanged ? 'bg-green-600' : 'bg-blue-600'}`}
              >
                {confirmLabel}
              </button>
            </div>
          )}
        </article>
        )
      })}
      {noticeDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setNoticeDraft(null)
        }}>
          <section
            ref={noticeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-email-title"
            tabIndex={-1}
            onKeyDown={handleNoticeDialogKeyDown}
            className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 id="report-email-title" className="font-semibold text-gray-900">이메일 미리보기 및 수정</h3>
                <p className="mt-1 text-xs text-gray-500">내용을 확인하고 필요한 문구를 수정한 뒤 보내세요.</p>
              </div>
              <button type="button" onClick={() => setNoticeDraft(null)} aria-label="닫기" className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100">닫기</button>
            </header>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:p-5">
              <div className="space-y-3">
                <p className="break-all text-xs text-gray-500">받는 사람: {noticeDraft.recipient}</p>
                <label className="block text-sm font-medium text-gray-700">
                  제목
                  <input value={noticeDraft.subject} maxLength={200} onChange={(event) => setNoticeDraft((draft) => ({ ...draft, subject: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  안내 문구
                  <textarea value={noticeDraft.intro} maxLength={4000} rows={5} onChange={(event) => setNoticeDraft((draft) => ({ ...draft, intro: event.target.value }))} className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal leading-6 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  처리 결과
                  <textarea value={noticeDraft.outcome} maxLength={3000} rows={4} onChange={(event) => setNoticeDraft((draft) => ({ ...draft, outcome: event.target.value }))} className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal leading-6 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  문의 이메일
                  <input type="email" value={noticeDraft.contact} maxLength={320} onChange={(event) => setNoticeDraft((draft) => ({ ...draft, contact: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                {noticeSendError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{noticeSendError}</p>}
              </div>
              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-100 p-3 sm:p-5">
                <p className="mb-3 text-xs font-medium text-gray-500">이메일 미리보기</p>
                <p className="mx-auto mb-3 max-w-[520px] break-words text-xs text-gray-600">제목: {noticeDraft.subject || '(제목 없음)'}</p>
                <div className="mx-auto min-h-[440px] max-w-[520px] bg-white px-7 py-9 font-sans text-[#111111] shadow-sm sm:px-8">
                  <img src="https://npvcghdzrtqrlliprtnw.supabase.co/storage/v1/object/public/public-assets/UvA-IN-logo-transparent.png" alt="UvA-IN" width="44" height="44" className="mb-11 block h-11 w-11 object-contain" />
                  <h4 className="mb-8 text-[30px] font-extrabold leading-tight tracking-tight text-[#050505]">{noticeDraft.recipientKind === 'reporter' ? '신고 처리 결과' : '게시물 처리 안내'}</h4>
                  <div className="mb-8 h-px bg-gray-200" />
                  <div className="break-words text-sm leading-7 text-gray-600">
                    {(noticeDraft.intro || '').split(/\n{2,}/).map((paragraph, index) => <p key={`intro-${index}`} className="mb-5 whitespace-pre-line">{paragraph}</p>)}
                    <h5 className="mb-3 mt-7 text-base font-bold text-gray-900">신고 대상 댓글 처리 결과</h5>
                    <article className="mb-6 flex gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                      <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f3f4f6] text-[rgba(44,42,39,0.55)]">
                        <UserCircle size={28} weight="fill" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold text-gray-700">
                            <span className="truncate">{noticeDraft.author}</span>
                          </p>
                          {noticeDraft.createdAt && <span className="flex-shrink-0 text-[10px] text-gray-400">{noticeDraft.createdAt}</span>}
                        </div>
                        <p className="mt-1 break-words whitespace-pre-wrap text-xs leading-relaxed text-gray-600">{noticeDraft.content}</p>
                      </div>
                    </article>
                    <p className="mb-6 whitespace-pre-line"><strong className="text-gray-900">처리 결과: </strong>{noticeDraft.outcome}</p>
                    <p className="mb-2">안내드린 내용과 관련하여 추가 문의가 있으시다면 아래 경로로 연락해 주세요.</p>
                    <p className="mb-6"><strong className="text-gray-900">추가 문의: </strong>{noticeDraft.contact}</p>
                    <p className="mb-1">감사합니다.</p>
                    <p className="font-medium text-gray-800">UvA-IN App 팀 드림</p>
                  </div>
                </div>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button type="button" onClick={() => setNoticeDraft(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">취소</button>
              <button type="button" onClick={sendReportNotice} disabled={!noticeDraft.subject.trim() || !noticeDraft.intro.trim() || !noticeDraft.outcome.trim() || !noticeDraft.contact.trim() || sendingNotice[`${noticeDraft.reportId}:${noticeDraft.recipientKind}`]} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                {sendingNotice[`${noticeDraft.reportId}:${noticeDraft.recipientKind}`] ? '전송 중…' : '이메일 보내기'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

// ─── Rich Text Editor ─────────────────────────────────────────────────────────

const COLORS = [
  '#000000',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ffffff',
]

function RichEditor({ value, onChange, placeholder, rows = 3 }) {
  const ref = useRef(null)
  const [showColors, setShowColors] = useState(false)
  const isInitialized = useRef(false)

  useEffect(() => {
    if (ref.current && !isInitialized.current) {
      ref.current.innerHTML = sanitizeRichText(value || '')
      isInitialized.current = true
    }
  }, [])

  useEffect(() => {
    if (ref.current && value === '') ref.current.innerHTML = ''
  }, [value])

  const exec = (cmd, val = null) => {
    if (!ref.current) return
    ref.current.focus()
    document.execCommand(cmd, false, val)
    const safeValue = sanitizeRichText(ref.current.innerHTML)
    if (ref.current.innerHTML !== safeValue) ref.current.innerHTML = safeValue
    onChange(safeValue)
  }

  const handleInput = () => {
    if (!ref.current) return
    const safeValue = sanitizeRichText(ref.current.innerHTML)
    if (ref.current.innerHTML !== safeValue) ref.current.innerHTML = safeValue
    onChange(safeValue)
  }

  const applyColor = (color) => {
    exec('foreColor', color)
    setShowColors(false)
  }

  return (
    <div className="input-focus-frame border border-gray-200 rounded-lg overflow-visible focus-within:border-orange-600">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 bg-gray-50 flex-wrap">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('bold')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded font-bold hover:bg-gray-100"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('italic')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded italic hover:bg-gray-100"
        >
          I
        </button>
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setShowColors((v) => !v)
            }}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100"
          >
            🎨
          </button>
          {showColors && (
            <div
              className="absolute top-7 left-0 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-lg flex gap-1 flex-wrap"
              style={{ width: '120px' }}
            >
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyColor(c)
                  }}
                  className="w-6 h-6 rounded-full border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('removeFormat')
          }}
          className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 text-gray-500"
        >
          ✕
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        className="px-3 py-2 text-sm outline-none"
        style={{
          minHeight: `${rows * 1.5}rem`,
          whiteSpace: 'pre-wrap',
          overflowY: 'auto',
          direction: 'ltr',
          unicodeBidi: 'plaintext',
        }}
      />
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:#9ca3af}`}</style>
    </div>
  )
}

// ─── ImageUploadPanel ────────────────────────────────────────────────────────

function ImageUploadPanel({
  imagePreviews,
  existingUrls,
  pendingReplacements,
  onAddFile,
  onAddCropped,
  onRemoveNew,
  onRemoveExisting,
  onPendingReplace,
  onReorder,
}) {
  const [cropperSource, setCropperSource] = useState(null)
  const dragIdx = useRef(null)

  const handleFileSelect = (e) => {
    Array.from(e.target.files || []).forEach((f) => onAddFile(f))
    e.target.value = ''
  }

  const handleFileSelectForCrop = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCropperSource({ type: 'file', file: e.target.files[0] })
    }
    e.target.value = ''
  }

  const handleTapExisting = (idx) => {
    setCropperSource({ type: 'url', url: existingUrls[idx], idx })
  }

  const handleCropDone = (croppedFile) => {
    if (cropperSource?.type === 'url') {
      const previewUrl = URL.createObjectURL(croppedFile)
      onPendingReplace(cropperSource.idx, croppedFile, previewUrl)
    } else {
      onAddCropped(croppedFile)
    }
    setCropperSource(null)
  }

  const handleDragStart = (idx) => {
    dragIdx.current = idx
  }

  const handleDrop = (idx) => {
    if (dragIdx.current === null || dragIdx.current === idx) return
    const reordered = [...(existingUrls || [])]
    const [moved] = reordered.splice(dragIdx.current, 1)
    reordered.splice(idx, 0, moved)
    onReorder && onReorder(reordered)
    dragIdx.current = null
  }

  const getDisplayUrl = (idx) => {
    const pending = pendingReplacements?.find((p) => p.idx === idx)
    return pending ? pending.previewUrl : existingUrls[idx]
  }

  return (
    <div className="space-y-3">
      {(existingUrls?.length > 0 || imagePreviews.length > 0) && (
        <div className="flex gap-2 flex-wrap">
          {existingUrls?.map((_, idx) => (
            <div
              key={`ex-${idx}`}
              className="relative group cursor-grab"
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(idx)}
            >
              <img
                src={getDisplayUrl(idx)}
                alt=""
                onClick={() => handleTapExisting(idx)}
                className="w-20 h-20 object-cover rounded-lg border-2 border-gray-200 cursor-pointer hover:border-blue-400 transition-colors"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition-colors pointer-events-none flex items-center justify-center">
                <span className="text-white text-xs font-semibold opacity-0 group-hover:opacity-100 drop-shadow">
                  ✂️
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveExisting(existingUrls[idx])}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 z-10"
              >
                ✕
              </button>
            </div>
          ))}
          {imagePreviews.map((preview, idx) => (
            <div key={`new-${idx}`} className="relative">
              <img
                src={preview}
                alt=""
                className="w-20 h-20 object-cover rounded-lg border-2 border-blue-200"
              />
              <button
                type="button"
                onClick={() => onRemoveNew(idx)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {existingUrls?.length > 0 && (
        <p className="text-xs text-gray-400">
          💡 기존 사진을 탭하면 자를 수 있어요 · 드래그로 순서 변경
        </p>
      )}

      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer">
          <div className="border-2 border-dashed border-gray-300 rounded-lg px-3 py-3 text-center hover:border-gray-400 transition-colors">
            <p className="text-xs font-medium text-gray-600">📁 그냥 업로드</p>
            <p className="text-xs text-gray-400 mt-0.5">자르기 없이</p>
          </div>
          <input
            type="file"
            accept={PUBLIC_IMAGE_TYPES}
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>
        <label className="flex-1 cursor-pointer">
          <div className="border-2 border-dashed border-blue-300 rounded-lg px-3 py-3 text-center hover:border-blue-400 transition-colors">
            <p className="text-xs font-medium text-blue-600">✂️ 자르기 업로드</p>
            <p className="text-xs text-gray-400 mt-0.5">비율 선택 후 자르기</p>
          </div>
          <input
            type="file"
            accept={PUBLIC_IMAGE_TYPES}
            className="hidden"
            onChange={handleFileSelectForCrop}
          />
        </label>
      </div>

      {cropperSource && (
        <ImageCropper
          file={cropperSource.type === 'file' ? cropperSource.file : null}
          imageUrl={cropperSource.type === 'url' ? cropperSource.url : null}
          onCrop={handleCropDone}
          onCancel={() => setCropperSource(null)}
          aspectRatios={['1:1', '4:5']}
        />
      )}
    </div>
  )
}

// ─── MembersTab ───────────────────────────────────────────────────────────────

const memberEditFields = [
  'first_name',
  'last_name',
  'student_number',
  'major',
  'year_of_birth',
  'gender',
  'country_of_origin',
  'University',
  'education_level',
  'year_number',
  'is_member',
  'membership_valid_until',
]

function normalizeMemberEditValue(field, value) {
  if (field === 'is_member') return value === true
  if (field === 'membership_valid_until') {
    return value ? String(value).slice(0, 10) : null
  }
  if (field === 'year_of_birth' || field === 'year_number') {
    if (value === '' || value == null) return null
    const number = Number(value)
    return Number.isInteger(number) ? number : value
  }
  if (field === 'student_number') {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  return value === '' || value == null ? null : value
}

function getAmsterdamCalendarDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null
}

async function getFunctionErrorMessage(error) {
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const body = await response.clone().json().catch(() => null)
    if (typeof body?.message === 'string' && body.message.trim()) return body.message
  }
  return error?.message || '회원 정보를 수정하지 못했습니다.'
}

function MembersTab() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

   const [form, setForm] = useState({
  name: '',
  map_label: '',
  description: '',
  address: '',
  latitude: '',
  longitude: '',
  discount_info: '',
  discount_terms: '',
  one_line_review: '',
  rating: '',
  review: '',
  reviewer_name: '',
  category: '맛집',
  price_range: '',
  is_sponsored: false,
  show_rating: true,
  stamp_card_enabled: false,
})

  const fetchMembers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('fetchMembers error:', error)
    }

    setMembers(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const handleEdit = async () => {
    const todayAmsterdam = getAmsterdamCalendarDate()
    const membershipValidUntil = normalizeMemberEditValue('membership_valid_until', form.membership_valid_until)
    if (form.is_member && (!membershipValidUntil || (todayAmsterdam && membershipValidUntil < todayAmsterdam))) {
      alert('멤버십을 활성화하려면 오늘 이후의 유효기간을 먼저 설정해 주세요.')
      return
    }

    const updates = Object.fromEntries(
      memberEditFields
        .map((field) => [
          field,
          normalizeMemberEditValue(field, form[field]),
          normalizeMemberEditValue(field, editTarget[field]),
        ])
        .filter(([, nextValue, currentValue]) => !Object.is(nextValue, currentValue))
        .map(([field, nextValue]) => [field, nextValue]),
    )

    if (Object.keys(updates).length === 0) {
      alert('변경한 내용이 없습니다.')
      return
    }

    const { data, error } = await supabase.functions.invoke('admin-update-member', {
      body: {
        memberId: editTarget.id,
        updates,
      },
    })

    if (error || !data?.success) {
      alert('수정 실패: ' + (data?.message || await getFunctionErrorMessage(error)))
      return
    }
    alert('수정 완료')
    setEditTarget(null)
    setShowForm(false)
    fetchMembers()
  }

  const openEdit = (member) => {
    setEditTarget(member)
    setForm({
      email: '',
      password: '',
      confirmPassword: '',
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      student_number: member.student_number || '',
      major: member.major || '',
      year_of_birth: member.year_of_birth || '',
      gender: member.gender || '',
      country_of_origin: member.country_of_origin || '',
      University: member.University || '',
      education_level: member.education_level || '',
      year_number: member.year_number || '',
      is_member: member.is_member,
      membership_valid_until: member.membership_valid_until
        ? String(member.membership_valid_until).slice(0, 10)
        : '',
    })
    setShowForm(true)
  }

  const sorted = koreanSort(members, 'last_name')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          멤버 목록 ({members.length}명)
        </h2>
      </div>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center"><LoadingIndicator /></div>
      ) : members.length === 0 ? (
        <p className="text-gray-500 text-sm">멤버가 없어요.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((member) => (
            <div key={member.id}>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      학번: {member.student_number || '미확정'} · 제출: {member.pending_student_number || '없음'} · {member.major}
                    </p>
                    <p className="text-xs text-gray-400">
                      유효기간:{' '}
                      {member.membership_valid_until || '없음'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openEdit(member)}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      수정
                    </button>
                  </div>
                </div>
              </div>

              {showForm && editTarget && editTarget.id === member.id && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mt-2">
                  <h3 className="font-medium text-gray-900">멤버 수정</h3>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        First Name *
                      </label>
                      <input
                        value={form.first_name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            first_name: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Last Name *
                      </label>
                      <input
                        value={form.last_name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            last_name: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        학번 (확정)
                      </label>
                      <input
                        value={form.student_number}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            student_number: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                      {member.pending_student_number && (
                        <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          <p>가입 시 제출한 학번: {member.pending_student_number}</p>
                          <button
                            type="button"
                            onClick={() => setForm({
                              ...form,
                              student_number: member.pending_student_number,
                            })}
                            className="mt-2 font-medium text-amber-800 underline"
                          >
                            확인한 제출 학번을 확정 학번으로 사용
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        전공 *
                      </label>
                      <input
                        value={form.major}
                        onChange={(e) =>
                          setForm({ ...form, major: e.target.value })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Birth year
                      </label>
                      <input
                        value={form.year_of_birth}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            year_of_birth: e.target.value,
                          })
                        }
                        placeholder="2004"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Gender
                      </label>
                      <input
                        value={form.gender}
                        onChange={(e) =>
                          setForm({ ...form, gender: e.target.value })
                        }
                        placeholder="male / female / ..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-700 block mb-1">
                      Country of origin
                    </label>
                    <input
                      value={form.country_of_origin}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          country_of_origin: e.target.value,
                        })
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        University
                      </label>
                      <input
                        value={form.University}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            University: e.target.value,
                          })
                        }
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-700 block mb-1">
                        Programme level
                      </label>
                      <input
                        value={form.education_level}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            education_level: e.target.value,
                          })
                        }
                        placeholder="bachelor / master / alumni"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-700 block mb-1">
                      Year number
                    </label>
                    <input
                      value={form.year_number}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          year_number: e.target.value,
                        })
                      }
                      placeholder="1, 2, 3..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`ism_${member.id}`}
                      checked={form.is_member}
                      onChange={(e) =>
                        setForm((currentForm) => ({
                          ...currentForm,
                          is_member: e.target.checked,
                        }))
                      }
                    />
                    <label
                      htmlFor={`ism_${member.id}`}
                      className="text-sm text-gray-700"
                    >
                      멤버십 활성화
                    </label>
                  </div>

                  <div>
                    <label className="text-sm text-gray-500 block mb-1">
                      유효기간
                    </label>
                    <input
                      type="date"
                      value={form.membership_valid_until}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          membership_valid_until: e.target.value,
                        })
                      }
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleEdit}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 font-medium"
                    >
                      수정 완료
                    </button>
                    <button
                      onClick={() => {
                        setShowForm(false)
                        setEditTarget(null)
                      }}
                      className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── EventsTab ────────────────────────────────────────────────────────────────

function EventForm({
  form,
  setForm,
  richEditorKey,
  editTarget,
  uploading,
  imagePreviews,
  pendingReplacements,
  handleAddFile,
  handleAddCropped,
  handleRemoveNew,
  handleRemoveExisting,
  handlePendingReplace,
  handleReorderImages,
  handleSave,
  resetForm,
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 mt-2">
      <h3 className="font-medium text-gray-900">
        {editTarget ? '이벤트 수정' : '새 이벤트'}
      </h3>
      <input
        placeholder="이벤트 제목"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div>
        <label className="text-sm text-gray-500 block mb-1">내용</label>
        <RichEditor
          key={richEditorKey}
          value={form.description}
          onChange={(v) => setForm((f) => ({ ...f, description: v }))}
          placeholder="내용을 입력하세요"
          rows={3}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">장소</label>
        <RichEditor
          key={richEditorKey + 50}
          value={form.location}
          onChange={(v) => setForm((f) => ({ ...f, location: v }))}
          placeholder="장소를 입력하세요"
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">장소 description</label>
        <textarea
          value={form.location_description}
          onChange={(e) =>
            setForm((f) => ({ ...f, location_description: e.target.value }))
          }
          placeholder="장소 description을 입력하세요"
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">날짜</label>
          <div className="space-y-2">
            {(form.eventDates || ['']).map((date, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) =>
                    setForm((f) => {
                      const next = [...(f.eventDates || [''])]
                      next[idx] = e.target.value
                      return { ...f, eventDates: next, eventDate: next[0] || '' }
                    })
                  }
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                {(form.eventDates || []).length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => {
                        const next = (f.eventDates || ['']).filter((_, i) => i !== idx)
                        return { ...f, eventDates: next.length ? next : [''], eventDate: next[0] || '' }
                      })
                    }
                    className="px-3 rounded-lg bg-gray-100 text-gray-500 text-sm"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({ ...f, eventDates: [...(f.eventDates || ['']), ''] }))
            }
            className="mt-2 text-xs text-orange-500 font-semibold"
          >
            + 날짜 추가
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            시작 시간 (HH:MM)
          </label>
          <TimeInput
            value={form.eventTime}
            onChange={(v) => setForm((f) => ({ ...f, eventTime: v }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">
            종료 시간 (HH:MM)
          </label>
          <TimeInput
            value={form.eventEndTime}
            onChange={(v) => setForm((f) => ({ ...f, eventEndTime: v }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        </div>
        {(form.eventDates || []).filter(Boolean).length > 1 && (
          <div>
            <label className="text-sm text-gray-500 block mb-1">
              캘린더 표시
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'separate', label: '각 날짜 따로' },
                { value: 'range', label: '날짜 연결 강조' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, calendarHighlightMode: option.value }))}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    form.calendarHighlightMode === option.value
                      ? 'border-orange-400 bg-orange-50 text-orange-600'
                      : 'border-gray-200 bg-white text-gray-500'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <input
        placeholder="인스타그램 URL (선택)"
        value={form.instagram_url}
        onChange={(e) =>
          setForm((f) => ({ ...f, instagram_url: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <input
        placeholder="Google Form 참가 링크 (선택)"
        value={form.participation_url}
        onChange={(e) =>
          setForm((f) => ({ ...f, participation_url: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">참가 마감</span>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              is_registration_closed: !f.is_registration_closed,
            }))
          }
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
            form.is_registration_closed
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {form.is_registration_closed ? '마감' : '접수중'}
        </button>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">참여하기 버튼 표시</span>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              show_participation_button: !f.show_participation_button,
            }))
          }
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
            form.show_participation_button
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {form.show_participation_button ? '표시' : '숨김'}
        </button>
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">사진</label>
        <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="text-sm text-gray-600">신청 없이 참여</span>
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                participation_without_signup: !f.participation_without_signup,
              }))
            }
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
              form.participation_without_signup
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {form.participation_without_signup ? '표시' : '해제'}
          </button>
        </div>
        <ImageUploadPanel
          imagePreviews={imagePreviews}
          existingUrls={editTarget?.image_urls || []}
          pendingReplacements={pendingReplacements}
          onAddFile={handleAddFile}
          onAddCropped={handleAddCropped}
          onRemoveNew={handleRemoveNew}
          onRemoveExisting={handleRemoveExisting}
          onPendingReplace={handlePendingReplace}
          onReorder={handleReorderImages}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={uploading}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : editTarget ? '수정 완료' : '추가'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [archivedEvents, setArchivedEvents] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [showArchivedList, setShowArchivedList] = useState(false)

  const [form, setForm] = useState({
    title: '',
    description: '',
    eventDate: '',
    eventDates: [''],
    eventTime: '',
    eventEndTime: '',
    calendarHighlightMode: 'separate',
    location: '',
    location_description: '',
    instagram_url: '',
    participation_url: '',
    is_registration_closed: false,
    participation_without_signup: false,
    show_participation_button: true,
  })

  const [imageFiles, setImageFiles] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [pendingReplacements, setPendingReplacements] = useState([])
  const [uploading, setUploading] = useState(false)
  const [richEditorKey, setRichEditorKey] = useState(0)

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('is_archived', false)
      .order('event_date', { ascending: false })
    setEvents(data || [])
  }

  const fetchArchivedEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('is_archived', true)
      .order('event_date', { ascending: false })
    setArchivedEvents(data || [])
  }

  useEffect(() => {
    fetchEvents()
    fetchArchivedEvents()
  }, [])

  const handleAddFile = (file) => {
    setImageFiles((prev) => [...prev, file])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(file)])
  }

  const handleAddCropped = (croppedFile) => {
    setImageFiles((prev) => [...prev, croppedFile])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(croppedFile)])
  }

  const handleRemoveNew = (idx) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx))
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleRemoveExisting = async (url) => {
    if (!confirm('이 사진을 삭제할까요?')) return
    const fileName = url.split('/').pop()
    await supabase.storage.from('event-images').remove([fileName])
    const idx = (editTarget?.image_urls || []).indexOf(url)
    setPendingReplacements((prev) => prev.filter((p) => p.idx !== idx))
    setEditTarget((prev) => ({
      ...prev,
      image_urls: (prev.image_urls || []).filter((u) => u !== url),
    }))
  }

  const handlePendingReplace = (idx, file, previewUrl) => {
    setPendingReplacements((prev) => {
      const next = prev.filter((p) => p.idx !== idx)
      return [...next, { idx, file, previewUrl }]
    })
  }

  const handleReorderImages = (reorderedUrls) => {
    if (editTarget) {
      setEditTarget((prev) => ({ ...prev, image_urls: reorderedUrls }))
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm({
      title: '',
      description: '',
      eventDate: '',
      eventDates: [''],
      eventTime: '',
      eventEndTime: '',
      calendarHighlightMode: 'separate',
      location: '',
      location_description: '',
      instagram_url: '',
      participation_url: '',
      is_registration_closed: false,
      show_participation_button: true,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
  }

  const handleSave = async () => {
    if (!form.title) {
      alert('제목을 입력해주세요.')
      return
    }
    setUploading(true)
    const eventDates = Array.from(new Set((form.eventDates || [form.eventDate]).filter(Boolean))).sort()
    const primaryDate = eventDates[0] || form.eventDate
    const event_date = combineDateTime(primaryDate, form.eventTime)
    const event_end_date = combineDateTime(primaryDate, form.eventEndTime, '')
    const event_dates = eventDates
      .map((date) => combineDateTime(date, form.eventTime))
      .filter(Boolean)
    let image_urls = [...(editTarget?.image_urls || [])]

    for (const { idx, file } of pendingReplacements) {
      try {
        const imageUrl = await uploadSanitizedPublicImage('event-images', file)
        const oldFileName = image_urls[idx]?.split('/').pop()
        if (oldFileName) await supabase.storage.from('event-images').remove([oldFileName])
        image_urls[idx] = imageUrl
      } catch (error) {
        alert('이미지 업로드 실패: ' + (error?.message || '이미지 파일을 처리하지 못했습니다.'))
        setUploading(false)
        return
      }
    }

    for (const file of imageFiles) {
      try {
        image_urls = [...image_urls, await uploadSanitizedPublicImage('event-images', file)]
      } catch (error) {
        alert('이미지 업로드 실패: ' + (error?.message || '이미지 파일을 처리하지 못했습니다.'))
        setUploading(false)
        return
      }
    }

    const payload = {
      title: form.title,
      description: form.description,
      event_date: event_date || null,
      event_end_date: event_end_date || null,
      event_dates,
      calendar_highlight_mode: form.calendarHighlightMode || 'separate',
      location: form.location,
      location_description: form.location_description,
      instagram_url: form.instagram_url,
      participation_url: form.participation_url,
      is_registration_closed: form.is_registration_closed,
      participation_without_signup: form.participation_without_signup,
      show_participation_button: form.show_participation_button,
      image_urls,
    }

    let saveError = null
    if (editTarget) {
      const { error } = await supabase
        .from('events')
        .update(payload)
        .eq('id', editTarget.id)
      saveError = error
    } else {
      const { error } = await supabase.from('events').insert(payload)
      saveError = error
    }

    if (saveError) {
      alert('저장 실패: ' + saveError.message)
      setUploading(false)
      return
    }

    setUploading(false)
    resetForm()
    fetchEvents()
  }

  const handleDelete = async (id) => {
    if (!confirm('삭제할까요?')) return
    await supabase.from('events').delete().eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const handleArchive = async (id) => {
    await supabase.from('events').update({ is_archived: true }).eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const handleRestore = async (id) => {
    await supabase.from('events').update({ is_archived: false }).eq('id', id)
    fetchEvents()
    fetchArchivedEvents()
  }

  const openEdit = (event) => {
    setEditTarget(event)
    setForm({
      title: event.title,
      description: event.description || '',
      eventDate: toLocalDateString(event.event_date),
      eventDates: getEventDateInputs(event),
      eventTime: toLocalTimeString(event.event_date),
      eventEndTime: toEventEndTimeInput(event),
      calendarHighlightMode: event.calendar_highlight_mode || 'separate',
      location: event.location || '',
      location_description: event.location_description || '',
      instagram_url: event.instagram_url || '',
      participation_url: event.participation_url || '',
      is_registration_closed: !!event.is_registration_closed,
      participation_without_signup: !!event.participation_without_signup,
      show_participation_button: event.show_participation_button !== false,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
    setShowForm(true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({
      title: '',
      description: '',
      eventDate: '',
      eventDates: [''],
      eventTime: '',
      eventEndTime: '',
      calendarHighlightMode: 'separate',
      location: '',
      location_description: '',
      instagram_url: '',
      participation_url: '',
      is_registration_closed: false,
      participation_without_signup: false,
      show_participation_button: true,
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
    setShowForm(true)
  }

  const getPrimaryEventDate = (event) => {
    const dates = Array.isArray(event?.event_dates) ? event.event_dates : []
    return dates[0] || event?.event_date
  }

  const groupByYearMonth = (arr) => {
    const grouped = {}
    arr.forEach((ev) => {
      const eventDate = getPrimaryEventDate(ev)
      const label = eventDate
        ? `${new Date(eventDate).getFullYear()}.${String(
            new Date(eventDate).getMonth() + 1,
          ).padStart(2, '0')}`
        : '날짜 미정'
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(ev)
    })
    return grouped
  }

  const formProps = {
    form,
    setForm,
    richEditorKey,
    editTarget,
    uploading,
    imagePreviews,
    pendingReplacements,
    handleAddFile,
    handleAddCropped,
    handleRemoveNew,
    handleRemoveExisting,
    handlePendingReplace,
    handleReorderImages,
    handleSave,
    resetForm,
  }

  const renderCard = (event, isArchived = false) => (
    <div key={event.id}>
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">
              {event.title}
            </p>
            {event.location && (
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <MapPin size={12} weight="fill" />
                {event.location.replace(/<[^>]+>/g, '')}
              </p>
            )}
            {event.event_date && (
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(event.event_date).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {isArchived ? (
              <>
                <button
                  onClick={() => handleRestore(event.id)}
                  className="text-xs text-green-600 hover:underline whitespace-nowrap"
                >
                  복원
                </button>
                <button
                  onClick={() => openEdit(event)}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(event.id)}
                  className="text-xs text-red-500 hover:underline whitespace-nowrap"
                >
                  삭제
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleArchive(event.id)}
                  className="text-xs text-green-600 hover:underline whitespace-nowrap"
                >
                  보관
                </button>
                <button
                  onClick={() => openEdit(event)}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(event.id)}
                  className="text-xs text-red-500 hover:underline whitespace-nowrap"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {showForm && editTarget && editTarget.id === event.id && (
        <EventForm {...formProps} />
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold text-gray-900">이벤트 관리</h2>
        <div className="flex gap-2">
          {showArchivedList ? (
            <button
              onClick={() => setShowArchivedList(false)}
              className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 whitespace-nowrap"
            >
              ← 이벤트 목록
            </button>
          ) : (
            <button
              onClick={() => setShowArchivedList(true)}
              className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 whitespace-nowrap"
            >
              보관된 이벤트
            </button>
          )}
          {!showForm && !showArchivedList && (
            <button
              onClick={openAdd}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
            >
              <Plus size={16} weight="bold" />
              이벤트 추가
            </button>
          )}
        </div>
      </div>

      {showArchivedList ? (
        <div className="space-y-3">
          {archivedEvents.length === 0 ? (
            <p className="text-gray-500 text-sm">
              보관된 이벤트가 없어요.
            </p>
          ) : (
            Object.entries(groupByYearMonth(archivedEvents)).map(
              ([month, evs]) => (
                <div key={month} className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                    {month}
                  </p>
                  {evs.map((e) => renderCard(e, true))}
                </div>
              )
            )
          )}
        </div>
      ) : (
        <>
          {showForm && !editTarget && <EventForm {...formProps} />}
          {events.length === 0 ? (
            <p className="text-gray-500 text-sm">이벤트가 없어요.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(groupByYearMonth(events)).map(
                ([month, evs]) => (
                  <div key={month} className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                      {month}
                    </p>
                    {evs.map((e) => renderCard(e, false))}
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── RestaurantsTab ───────────────────────────────────────────────────────────

const SPOT_CATEGORIES = [
  '맛집',
  '카페',
  '마트',
  '스터디',
  '학교',
  '의료',
  '운동',
  '미용/뷰티',
  '여가',
  '쇼핑',
  '기타',
]

function RestaurantForm({
  form,
  setForm,
  richEditorKey,
  editTarget,
  uploading,
  imagePreviews,
  pendingReplacements,
  handleAddFile,
  handleAddCropped,
  handleRemoveNew,
  handleRemoveExisting,
  handlePendingReplace,
  handleReorderImages,
  handleSave,
  resetForm,
  setStampCardEditOpen,
  setStampCardMemberOpen,
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 mt-2">
      <h3 className="font-medium text-gray-900">
        {editTarget ? '장소 수정' : '새 장소 추가'}
      </h3>
      <input
        placeholder="장소 이름"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <input
        placeholder="지도 표시 이름"
        value={form.map_label}
        onChange={(e) =>
          setForm((f) => ({ ...f, map_label: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <select
        value={form.category}
        onChange={(e) =>
          setForm((f) => ({ ...f, category: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
      >
        {SPOT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <textarea
        placeholder="설명"
        value={form.description}
        onChange={(e) =>
          setForm((f) => ({ ...f, description: e.target.value }))
        }
        rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
      />
      <input
        placeholder="주소"
        value={form.address}
        onChange={(e) =>
          setForm((f) => ({ ...f, address: e.target.value }))
        }
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm text-gray-500 block mb-1">위도</label>
          <input
            placeholder="위도"
            value={form.latitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, latitude: e.target.value }))
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-500 block mb-1">경도</label>
          <input
            placeholder="경도"
            value={form.longitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, longitude: e.target.value }))
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">할인 정보</label>
        <RichEditor
          key={richEditorKey}
          value={form.discount_info}
          onChange={(v) =>
            setForm((f) => ({ ...f, discount_info: v }))
          }
          placeholder="할인 정보 (예: 10% 할인)"
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">할인 조건</label>
        <RichEditor
          key={richEditorKey + 100}
          value={form.discount_terms}
          onChange={(v) =>
            setForm((f) => ({ ...f, discount_terms: v }))
          }
          placeholder="할인 조건 (예: 주말 제외)"
          rows={2}
        />
      </div>
      {/* 별점 표시 토글 */}
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-500">별점 표시</span>
  <button
    type="button"
    onClick={() =>
      setForm((f) => ({ ...f, show_rating: !f.show_rating }))
    }
    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
      form.show_rating
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}
  >
    {form.show_rating ? '켜짐' : '꺼짐'}
  </button>
</div>

{/* 스탬프 카드 사용 여부 */}
<div className="flex items-center justify-between">
  <span className="text-sm text-gray-500">Google Maps 버튼 표시</span>
  <button
    type="button"
    onClick={() =>
      setForm((f) => ({
        ...f,
        show_google_maps_button: !f.show_google_maps_button,
      }))
    }
    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
      form.show_google_maps_button
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}
  >
    {form.show_google_maps_button ? '켜짐' : '꺼짐'}
  </button>
</div>

<div>
  <label className="text-sm text-gray-500 block mb-1">
    SpotCard preview height
  </label>
  <div className="grid grid-cols-2 gap-2">
    {[
      { value: 'compact', label: 'Compact' },
      { value: 'full', label: 'Full' },
    ].map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() =>
          setForm((f) => ({ ...f, spot_card_height: option.value }))
        }
        className={
          'rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
          (form.spot_card_height === option.value
            ? 'border-orange-500 bg-orange-50 text-orange-600'
            : 'border-gray-200 bg-white text-gray-500')
        }
      >
        {option.label}
      </button>
    ))}
  </div>
</div>

<div className="flex items-center justify-between mt-3">
  <span className="text-sm text-gray-500">스탬프 카드 사용</span>
  <button
    type="button"
    onClick={() => setForm(f => ({ ...f, stamp_card_enabled: !f.stamp_card_enabled }))}
    className={
      'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ' +
      (form.stamp_card_enabled
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200')
    }
  >
    {form.stamp_card_enabled ? '켜짐' : '꺼짐'}
  </button>
</div>

{/* (수정 모드에서만) 스탬프 카드 편집 / 멤버 스탬프 관리 */}
{editTarget && (
  <div className="flex gap-2 mt-3">
    <button
      type="button"
      onClick={() => setStampCardEditOpen(true)}
      className="flex-1 text-xs bg-orange-500 text-white px-3 py-2 rounded-lg"
    >
      스탬프 카드 편집
    </button>
    <button
      type="button"
      onClick={() => setStampCardMemberOpen(true)}
      className="flex-1 text-xs bg-gray-900 text-white px-3 py-2 rounded-lg"
    >
      멤버 스탬프 현황
    </button>
  </div>
)}

{/* 가격대 */}
<div>
  <label className="text-sm text-gray-500 block mb-1">가격대</label>
  <select
    value={form.price_range}
    onChange={(e) =>
      setForm((f) => ({ ...f, price_range: e.target.value }))
    }
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
  >
    <option value="">가격대 선택</option>
    <option value="€">€ (저렴)</option>
    <option value="€€">€€ (보통)</option>
    <option value="€€€">€€€ (비쌈)</option>
    <option value="€€€€">€€€€ (고급)</option>
  </select>
</div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`sp_${editTarget ? 'edit' : 'add'}`}
          checked={form.is_sponsored}
          onChange={(e) =>
            setForm((f) => ({ ...f, is_sponsored: e.target.checked }))
          }
        />
        <label
          htmlFor={`sp_${editTarget ? 'edit' : 'add'}`}
          className="text-sm text-gray-700 flex items-center gap-1"
        >
          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          주황색 강조 마커
        </label>
      </div>

      <div>
        <label
          className="text-sm text-gray-500 block mb-1"
          htmlFor="commercial-display-type"
        >
          매장 표시 유형
        </label>
        <select
          id="commercial-display-type"
          value={form.commercial_display_type}
          onChange={(e) =>
            setForm((f) => ({ ...f, commercial_display_type: e.target.value }))
          }
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value={RESTAURANT_COMMERCIAL_LABEL_TYPES.NONE}>표시 없음</option>
          <option value={RESTAURANT_COMMERCIAL_LABEL_TYPES.MEMBER_DISCOUNT}>
            할인 제공
          </option>
          <option value={RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD}>유료 광고</option>
        </select>
        <p className="mt-1 text-xs text-gray-400">
          유료 광고는 초록색 지도 마커와 함께 표시됩니다.
        </p>
      </div>

      {/* 한 줄 평가 */}
<div>
  <label className="text-sm text-gray-500 block mb-1">한 줄 평가</label>
  <RichEditor
    key={richEditorKey + 200}
    value={form.one_line_review}
    onChange={v =>
      setForm(f => ({ ...f, one_line_review: v }))
    }
    placeholder="한 줄 평가"
    rows={2}
  />
</div>

<div>
  <label className="text-sm text-gray-500 block mb-1">우슐랭 별점</label>
  <div className="mb-2 flex items-center justify-between">
    <span className="text-xs text-gray-400">SpotCard에 표시</span>
    <button
      type="button"
      onClick={() =>
        setForm((f) => ({
          ...f,
          show_usullang_stars: !f.show_usullang_stars,
        }))
      }
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
        form.show_usullang_stars
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-gray-50 text-gray-500 border-gray-200'
      }`}
      aria-pressed={form.show_usullang_stars}
    >
      {form.show_usullang_stars ? '켜짐' : '꺼짐'}
    </button>
  </div>
  <div
    className={
      'flex items-center gap-1 ' +
      (form.show_usullang_stars ? '' : 'pointer-events-none opacity-40')
    }
    aria-label="우슐랭 별 채움 수"
  >
    {[1, 2, 3].map((star) => {
      const highlighted = star <= form.usullang_star_count
      return (
        <button
          key={star}
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              usullang_star_count: highlighted ? star - 1 : star,
            }))
          }
          className="rounded-md p-1 transition-colors hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-300"
          aria-pressed={highlighted}
          aria-label={`우슐랭 별 ${star}개${highlighted ? ' 해제' : ' 표시'}`}
        >
          <StarFour
            size={26}
            weight={highlighted ? 'fill' : 'regular'}
            className={highlighted ? 'text-orange-500' : 'text-gray-300'}
          />
        </button>
      )
    })}
  </div>
  <p className="mt-1 text-xs text-gray-400">켜진 뒤, 채울 별 개수를 선택하세요.</p>
</div>

{/* 임원 리뷰 */}
<div className="mt-3 space-y-2">
  <p className="text-sm font-medium text-gray-900">임원 리뷰</p>

  <input
    placeholder="리뷰어 이름"
    value={form.reviewer_name}
    onChange={(e) =>
      setForm((f) => ({ ...f, reviewer_name: e.target.value }))
    }
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
  />

  <textarea
    placeholder="리뷰"
    value={form.review}
    onChange={(e) =>
      setForm((f) => ({ ...f, review: e.target.value }))
    }
    rows={3}
    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
  />



</div>
      <div>
        <label className="text-sm text-gray-500 block mb-1">사진</label>
        <ImageUploadPanel
          imagePreviews={imagePreviews}
          existingUrls={editTarget?.image_urls || []}
          pendingReplacements={pendingReplacements}
          onAddFile={handleAddFile}
          onAddCropped={handleAddCropped}
          onRemoveNew={handleRemoveNew}
          onRemoveExisting={handleRemoveExisting}
          onPendingReplace={handlePendingReplace}
          onReorder={handleReorderImages}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={uploading}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '업로드 중...' : editTarget ? '수정 완료' : '추가'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm"
        >
          취소
        </button>
      </div>
    </div>
  )
}

function RestaurantsTab() {
  const [restaurants, setRestaurants] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const [form, setForm] = useState({
    name: '',
    map_label: '',
    description: '',
    address: '',
    latitude: '',
    longitude: '',
    discount_info: '',
    discount_terms: '',
    one_line_review: '',
    rating: '',
    review: '',
    reviewer_name: '',
    category: '맛집',
    price_range: '',
    is_sponsored: false,
    commercial_display_type: RESTAURANT_COMMERCIAL_LABEL_TYPES.NONE,
    show_rating: true,
    show_google_maps_button: true,
    show_usullang_stars: false,
    usullang_star_count: 0,
    stamp_card_enabled: false,
    spot_card_height: 'compact',
  })

  const [imageFiles, setImageFiles] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [pendingReplacements, setPendingReplacements] = useState([])
  const [uploading, setUploading] = useState(false)
  const [richEditorKey, setRichEditorKey] = useState(0)

  // Stamp card overlays
  const [stampCardEditOpen, setStampCardEditOpen] = useState(false)
  const [stampCardMemberOpen, setStampCardMemberOpen] = useState(false)
  const [stampCardTotalStamps, setStampCardTotalStamps] = useState(10)

  const fetchRestaurants = async () => {
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .order('created_at', { ascending: false })
    setRestaurants(data || [])
  }

  useEffect(() => {
    fetchRestaurants()
  }, [])

  // When editTarget changes, load stamp card config total_stamps (for Member panel)
  useEffect(() => {
  if (!editTarget) return

  fetchConfigBySpot(editTarget.id)
    .then((config) => {
      setStampCardTotalStamps(config?.total_stamps ?? 10)
    })
    .catch(() => setStampCardTotalStamps(10))
}, [editTarget])

  const handleAddFile = (file) => {
    setImageFiles((prev) => [...prev, file])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(file)])
  }

  const handleAddCropped = (croppedFile) => {
    setImageFiles((prev) => [...prev, croppedFile])
    setImagePreviews((prev) => [...prev, URL.createObjectURL(croppedFile)])
  }

  const handleRemoveNew = (idx) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== idx))
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleRemoveExisting = async (url) => {
    if (!confirm('이 사진을 삭제할까요?')) return
    const fileName = url.split('/').pop()
    await supabase.storage.from('place-images').remove([fileName])
    const idx = (editTarget?.image_urls || []).indexOf(url)
    setPendingReplacements((prev) => prev.filter((p) => p.idx !== idx))
    setEditTarget((prev) => ({
      ...prev,
      image_urls: (prev.image_urls || []).filter((u) => u !== url),
    }))
  }

  const handlePendingReplace = (idx, file, previewUrl) => {
    setPendingReplacements((prev) => {
      const next = prev.filter((p) => p.idx !== idx)
      return [...next, { idx, file, previewUrl }]
    })
  }

  const handleReorderImages = (reorderedUrls) => {
    if (editTarget) {
      setEditTarget((prev) => ({ ...prev, image_urls: reorderedUrls }))
    }
  }

  const resetForm = () => {
    setShowForm(false)
    setEditTarget(null)
    setForm({
      name: '',
      map_label: '',
      description: '',
      address: '',
      latitude: '',
      longitude: '',
      discount_info: '',
      discount_terms: '',
      one_line_review: '',
      rating: '',
      review: '',
      reviewer_name: '',
      category: '맛집',
      price_range: '',
      is_sponsored: false,
      commercial_display_type: RESTAURANT_COMMERCIAL_LABEL_TYPES.NONE,
      show_rating: true,
      show_google_maps_button: true,
      show_usullang_stars: false,
      usullang_star_count: 0,
      stamp_card_enabled: false,
      spot_card_height: 'compact',
    })
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setRichEditorKey((k) => k + 1)
  }

  const handleSave = async () => {
    if (!form.name) {
      alert('장소 이름을 입력해주세요.')
      return
    }
    setUploading(true)
    let image_urls = [...(editTarget?.image_urls || [])]

    // Apply pending replacements
    for (const { idx, file } of pendingReplacements) {
      try {
        const imageUrl = await uploadSanitizedPublicImage('place-images', file)
        const oldFileName = image_urls[idx]?.split('/').pop()
        if (oldFileName) await supabase.storage.from('place-images').remove([oldFileName])
        image_urls[idx] = imageUrl
      } catch (error) {
        alert('이미지 업로드 실패: ' + (error?.message || '이미지 파일을 처리하지 못했습니다.'))
        setUploading(false)
        return
      }
    }

    // New images
    for (const file of imageFiles) {
      try {
        image_urls = [...image_urls, await uploadSanitizedPublicImage('place-images', file)]
      } catch (error) {
        alert('이미지 업로드 실패: ' + (error?.message || '이미지 파일을 처리하지 못했습니다.'))
        setUploading(false)
        return
      }
    }

    const payload = {
      name: form.name,
      map_label: form.map_label,
      description: form.description,
      address: form.address,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      discount_info: form.discount_info,
      discount_terms: form.discount_terms,
      one_line_review: form.one_line_review,
      rating: form.rating ? parseFloat(form.rating) : 0,
      review: form.review,
      reviewer_name: form.reviewer_name,
      category: form.category,
      price_range: form.price_range,
      is_sponsored: form.is_sponsored,
      commercial_display_type: form.commercial_display_type,
      show_rating: form.show_rating,
      show_google_maps_button: form.show_google_maps_button,
      show_usullang_stars: form.show_usullang_stars,
      usullang_star_count: form.usullang_star_count,
      stamp_card_enabled: form.stamp_card_enabled,
      spot_card_height:
        form.spot_card_height === 'full' ? 'full' : 'compact',
      image_urls,
    }

    let saveError = null
    if (editTarget) {
      const { error } = await supabase
        .from('restaurants')
        .update(payload)
        .eq('id', editTarget.id)
      saveError = error
    } else {
      const { error } = await supabase.from('restaurants').insert(payload)
      saveError = error
    }

    if (saveError) {
      alert('저장 실패: ' + saveError.message)
      setUploading(false)
      return
    }

    setUploading(false)
    resetForm()
    fetchRestaurants()
  }

  const handleArchive = async (id) => {
    if (!confirm('제휴를 종료할까요? 매장은 앱에서 숨겨지고 미사용 리워드는 즉시 만료되어 12개월 뒤 삭제됩니다. 댓글·노트·스탬프 기록은 보존됩니다.')) return
    const { data, error } = await supabase
      .from('restaurants')
      .update({ is_archived: true })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error || !data) {
      alert('제휴 종료 처리 실패: ' + (error?.message || '매장을 찾을 수 없습니다.'))
      return
    }
    fetchRestaurants()
  }

  const handleRestore = async (id) => {
    const { data, error } = await supabase
      .from('restaurants')
      .update({ is_archived: false })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error || !data) {
      alert('매장을 복원하지 못했습니다: ' + (error?.message || '매장을 찾을 수 없습니다.'))
      return
    }
    fetchRestaurants()
  }

  const openEdit = (r) => {
    setEditTarget(r)
    setForm({
      name: r.name,
      map_label: r.map_label || '',
      description: r.description || '',
      address: r.address || '',
      latitude: r.latitude || '',
      longitude: r.longitude || '',
      discount_info: r.discount_info || '',
      discount_terms: r.discount_terms || '',
      one_line_review: r.one_line_review || '',
      rating: r.rating || '',
      review: r.review || '',
      reviewer_name: r.reviewer_name || '',
      category: r.category || '맛집',
      price_range: r.price_range || '',
      is_sponsored: r.is_sponsored || false,
      commercial_display_type: getRestaurantCommercialLabelType(r),
      show_rating: typeof r.show_rating === 'boolean' ? r.show_rating : true,
      show_google_maps_button:
        typeof r.show_google_maps_button === 'boolean'
          ? r.show_google_maps_button
          : true,
      show_usullang_stars: r.show_usullang_stars === true,
      usullang_star_count: Math.max(
        0,
        Math.min(3, Number(r.usullang_star_count) || 0),
      ),
      stamp_card_enabled: r.stamp_card_enabled || false,
      spot_card_height: r.spot_card_height === 'full' ? 'full' : 'compact',
    })

    setRichEditorKey((k) => k + 1)
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setShowForm(true)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({
      name: '',
      map_label: '',
      description: '',
      address: '',
      latitude: '',
      longitude: '',
      discount_info: '',
      discount_terms: '',
      one_line_review: '',
      rating: '',
      review: '',
      reviewer_name: '',
      category: '맛집',
      price_range: '',
      is_sponsored: false,
      commercial_display_type: RESTAURANT_COMMERCIAL_LABEL_TYPES.NONE,
      show_rating: true,
      show_google_maps_button: true,
      show_usullang_stars: false,
      usullang_star_count: 0,
      stamp_card_enabled: false,
      spot_card_height: 'compact',
    })
    setRichEditorKey((k) => k + 1)
    setImageFiles([])
    setImagePreviews([])
    setPendingReplacements([])
    setShowForm(true)
  }

  const visibleRestaurants = restaurants.filter((restaurant) => Boolean(restaurant.is_archived) === showArchived)
  const sorted = koreanSort(visibleRestaurants, 'name')

  const formProps = {
    form,
    setForm,
    richEditorKey,
    editTarget,
    uploading,
    imagePreviews,
    pendingReplacements,
    handleAddFile,
    handleAddCropped,
    handleRemoveNew,
    handleRemoveExisting,
    handlePendingReplace,
    handleReorderImages,
    handleSave,
    resetForm,
    setStampCardEditOpen,
    setStampCardMemberOpen,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">장소 관리</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowArchived(false)}
            className={`text-xs ${!showArchived ? 'font-semibold text-blue-600' : 'text-gray-500'}`}
          >
            운영 중
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className={`text-xs ${showArchived ? 'font-semibold text-blue-600' : 'text-gray-500'}`}
          >
            보관됨
          </button>
        {!showForm && !showArchived && (
          <button
            onClick={openAdd}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-1 whitespace-nowrap"
          >
            <Plus size={16} weight="bold" />
            장소 추가
          </button>
        )}
        </div>
      </div>

      {showForm && !editTarget && <RestaurantForm {...formProps} />}

      {visibleRestaurants.length === 0 ? (
        <p className="text-gray-500 text-sm">{showArchived ? '보관된 장소가 없어요.' : '등록된 장소가 없어요.'}</p>
      ) : (
        (() => {
          const grouped = {}
          sorted.forEach((r) => {
            const key = r.category || '기타'
            if (!grouped[key]) grouped[key] = []
            grouped[key].push(r)
          })
          return Object.entries(grouped).map(([cat, places]) => (
            <div key={cat} className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">
                {cat} ({places.length})
              </p>
              {places.map((r) => (
                <div key={r.id}>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-900 text-sm">
                            {r.name}
                          </p>
                        </div>
                        {getRestaurantCommercialLabel(
                          getRestaurantCommercialLabelType(r),
                        ) && (
                          <span
                            className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              getRestaurantCommercialLabelType(r) ===
                              RESTAURANT_COMMERCIAL_LABEL_TYPES.PAID_AD
                                ? 'bg-green-50 text-[#16A34A]'
                                : 'bg-orange-50 text-orange-700'
                            }`}
                          >
                            {getRestaurantCommercialLabel(
                              getRestaurantCommercialLabelType(r),
                            )}
                          </span>
                        )}
                        {r.address && (
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <MapPin size={12} weight="fill" /> {r.address}
                          </p>
                        )}
                        {r.discount_info && (
                          <p className="text-xs text-orange-500 mt-0.5 flex items-center gap-1">
                            <Ticket
                              size={12}
                              weight="fill"
                              color="#FF5252"
                            />{' '}
                            {r.discount_info.replace(/<[^>]+>/g, '')}
                          </p>
                        )}
                        {r.rating > 0 && (
                          <p className="text-xs text-amber-500 mt-0.5">
                            ★ {r.rating}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                        >
                          수정
                        </button>
                        {showArchived ? (
                          <button
                            onClick={() => handleRestore(r.id)}
                            className="text-xs text-green-600 hover:underline whitespace-nowrap"
                          >
                            복원
                          </button>
                        ) : (
                          <button
                            onClick={() => handleArchive(r.id)}
                            className="text-xs text-red-500 hover:underline whitespace-nowrap"
                          >
                            제휴 종료
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {showForm && editTarget && editTarget.id === r.id && (
                    <RestaurantForm {...formProps} />
                  )}
                </div>
              ))}
            </div>
          ))
        })()
      )}

      {/* Stamp card overlay panels */}
      {stampCardEditOpen && editTarget && (
        <StampCardEditPanel
          restaurantId={editTarget.id}
          spotName={editTarget.name}
          onClose={() => setStampCardEditOpen(false)}
        />
      )}

      {stampCardMemberOpen && editTarget && (
        <StampCardMemberPanel
          restaurantId={editTarget.id}
          spotName={editTarget.name}
          totalStamps={stampCardTotalStamps}
          onClose={() => setStampCardMemberOpen(false)}
        />
      )}
    </div>
  )
}
