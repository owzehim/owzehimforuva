import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChatDots, Flag, PencilSimple, Plus, Trash, UserCircle, X } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { getPastelColor } from '../lib/avatarColor'
import { createProfileImageSignedUrl } from '../lib/profileImageStorage'
import AdminBadge from './AdminBadge'

const MAX_NOTE_LENGTH = 200

function formatNoteDate(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

function formatAmsterdamDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function errorMessage(error) {
  const message = String(error?.message || '').toLowerCase()
  if (message.includes('one note per restaurant per day')) {
    return 'You already left a note here today.'
  }
  if (message.includes('inappropriate language')) {
    return 'Please keep notes friendly and useful.'
  }
  if (message.includes('username is required')) {
    return '한마디를 남기려면 먼저 설정에서 닉네임을 등록해 주세요.'
  }
  if (message.includes('member name is required')) {
    return 'Add your name in Settings before leaving a note.'
  }
  if (message.includes('only active members')) {
    return 'Only active members can leave notes.'
  }
  if (message.includes('row-level security')) {
    return 'You do not have permission to save this note.'
  }
  return 'Could not save your note. Please try again.'
}

export function GoodToKnowNotesPanel({
  restaurantId,
  userId,
  userEmail,
  username,
  canComment,
  isAdmin,
  mutedAccentColor,
}) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reportTarget, setReportTarget] = useState(null)
  const [reportReason, setReportReason] = useState('community_guidelines')
  const [reportExplanation, setReportExplanation] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')
  const [reportGoodFaith, setReportGoodFaith] = useState(false)
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [todayKey, setTodayKey] = useState('')
  const touchStartRef = useRef(null)
  const hasNoteToday = notes.some((note) => (
    note.is_mine && formatAmsterdamDay(note.created_at) === todayKey
  ))
  const canCreateNote = !!userId && canComment && !hasNoteToday
  const mutedAccentStyle = mutedAccentColor ? { color: mutedAccentColor } : undefined
  const disabledNoteButtonStyle = !canCreateNote && mutedAccentColor
    ? { backgroundColor: mutedAccentColor, color: '#9ca3af' }
    : undefined

  const loadNotes = useCallback(async () => {
    if (!restaurantId || !userId) {
      setLoading(false)
      return
    }

    const { data, error: loadError } = await supabase
      .from('restaurant_notes_safe')
      .select('id, restaurant_id, is_mine, username, profile_image_url, avatar_color_seed, is_anonymous, body, created_at, updated_at, source_redemption_id, source_store_id, source_rating, source_tags, author_is_admin')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (loadError) {
      setError('Could not load notes.')
    } else {
      const notesWithImageUrls = await Promise.all((data || []).map(async (note) => ({
        ...note,
        profile_image_url: !note.is_anonymous
          ? await createProfileImageSignedUrl(note.profile_image_url)
          : null,
      })))
      setNotes(notesWithImageUrls)
    }
    setLoading(false)
  }, [restaurantId, userId])

  useEffect(() => {
    const updateTodayKey = () => setTodayKey(formatAmsterdamDay(Date.now()))
    const initialTimer = window.setTimeout(updateTodayKey, 0)
    const refreshTimer = window.setInterval(updateTodayKey, 60000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(refreshTimer)
    }
  }, [])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNotes([])
    setLoading(true)
    setComposerOpen(false)
    setEditingNote(null)
    setBody('')
    setError('')
    loadNotes()

    if (!restaurantId) return undefined
    const refreshInterval = window.setInterval(loadNotes, 15000)
    return () => window.clearInterval(refreshInterval)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restaurantId, loadNotes])

  useEffect(() => {
    if (!composerOpen) return undefined

    const root = document.documentElement
    const previousOverflow = document.body.style.overflow
    const previousWidth = document.body.style.width
    const previousRootOverflow = root.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const preventBackgroundScroll = (event) => {
      if (event.target?.closest?.('.good-to-know-note-modal')) return
      event.preventDefault()
    }

    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    document.body.style.width = '100%'
    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false })

    return () => {
      root.style.overflow = previousRootOverflow
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
      document.body.style.width = previousWidth
      document.removeEventListener('touchmove', preventBackgroundScroll)
    }
  }, [composerOpen])

  const closeComposer = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setComposerOpen(false)
  }

  const openNewNote = () => {
    if (!canCreateNote) return
    setError('')
    setEditingNote(null)
    setBody('')
    setAnonymous(false)
    setComposerOpen(true)
  }

  const openEdit = (note) => {
    setError('')
    setEditingNote(note)
    setBody(note.body)
    setAnonymous(note.is_anonymous)
    setComposerOpen(true)
  }

  const saveNote = async (event) => {
    event.preventDefault()
    const trimmedBody = body.trim()
    if (!trimmedBody || !userId) return

    setSaving(true)
    setError('')

    if (editingNote?.source_redemption_id && editingNote?.source_store_id) {
      try {
        await syncLinkedReviewNoteToSheets({
          redemptionId: editingNote.source_redemption_id,
          storeId: editingNote.source_store_id,
          rating: editingNote.source_rating,
          tags: editingNote.source_tags,
          comment: trimmedBody,
        })
      } catch (syncError) {
        console.warn('Linked review note sync failed:', syncError?.message)
        setSaving(false)
        setError('리뷰 한마디를 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
    }

    const payload = { body: trimmedBody, is_anonymous: anonymous }
    const result = editingNote
      ? await supabase.from('restaurant_notes').update(payload).eq('id', editingNote.id)
      : await supabase.from('restaurant_notes').insert({
          ...payload,
          restaurant_id: restaurantId,
          user_id: userId,
          username: username || '',
        })

    setSaving(false)
    if (result.error) {
      console.error('save restaurant note error:', result.error)
      setError(errorMessage(result.error))
      return
    }

    closeComposer()
    setBody('')
    setEditingNote(null)
    loadNotes()
  }

  const deleteNote = async (noteId) => {
    if (!window.confirm('이 한마디를 삭제할까요?')) return
    const note = notes.find((item) => item.id === noteId)
    if (note?.source_redemption_id && note?.source_store_id) {
      try {
        await syncLinkedReviewNoteToSheets({
          redemptionId: note.source_redemption_id,
          storeId: note.source_store_id,
          rating: note.source_rating,
          tags: note.source_tags,
          comment: '',
        })
      } catch (syncError) {
        console.warn('Linked review note deletion sync failed:', syncError?.message)
        setError('리뷰 한마디를 시트에서 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
    }

    const { error: deleteError } = await supabase
      .from('restaurant_notes')
      .delete()
      .eq('id', noteId)

    if (deleteError) {
      console.error('delete restaurant note error:', deleteError)
      setError('한마디를 삭제하지 못했어요.')
    } else {
      setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId))
      await loadNotes()
    }
  }

  const openReport = async (note) => {
    if (!userId) return
    setError('')
    setReportTarget(note)
    setReportReason('community_guidelines')
    setReportExplanation('')
    setReportGoodFaith(false)
    setReporterName(username || '')
    const { data } = await supabase.auth.getUser()
    setReporterEmail(data?.user?.email || '')
  }

  const reportNote = async (event) => {
    event.preventDefault()
    if (!userId || !reportTarget || reportSubmitting) return
    if (!reporterName.trim()) {
      setError('신고자 이름을 입력해 주세요.')
      return
    }
    if (!reportGoodFaith) {
      setError('신고 내용이 사실임을 확인하고 동의해 주세요.')
      return
    }
    setReportSubmitting(true)
    setError('')
    const { error: reportError } = await supabase
      .from('restaurant_note_reports')
      .insert({
        note_id: reportTarget.id,
        reporter_id: userId,
        reporter_name: reporterName.trim(),
        reason: reportReason,
        explanation: reportExplanation.trim() || null,
        good_faith: true,
      })

    setReportSubmitting(false)
    if (reportError?.code === '23505') setError('이미 신고한 한마디예요.')
    else if (reportError) setError('신고하지 못했어요. 잠시 후 다시 시도해 주세요.')
    else {
      setReportTarget(null)
      setError('신고가 접수되었습니다. 검토 결과는 계정 이메일로 안내됩니다.')
    }
  }

  const handleNotesTouchStart = (event) => {
    touchStartRef.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      axis: null,
      ownsGesture: false,
    }
  }

  const handleNotesTouchMove = (event) => {
    const touchStart = touchStartRef.current
    if (!touchStart) return

    const distanceX = event.touches[0].clientX - touchStart.x
    const distanceY = event.touches[0].clientY - touchStart.y
    const absX = Math.abs(distanceX)
    const absY = Math.abs(distanceY)

    if (!touchStart.axis && Math.max(absX, absY) > 8) {
      touchStart.axis = absX > absY * 1.5 ? 'x' : 'y'
    }

    if (touchStart.axis !== 'y') return

    const scrollTop = event.currentTarget.scrollTop || 0
    const pullingDownAtTop = distanceY > 0 && scrollTop <= 0
    const canUseSpotCardGesture = pullingDownAtTop || notes.length === 0

    if (!canUseSpotCardGesture) {
      touchStart.ownsGesture = true
      event.stopPropagation()
    }
  }

  const handleNotesTouchEnd = (event) => {
    if (touchStartRef.current?.ownsGesture) {
      event.stopPropagation()
    }
    touchStartRef.current = null
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col py-3">
      <style>{`
        .good-to-know-note-textarea::placeholder {
          font-size: 12px;
        }
      `}</style>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500">회원 한마디</p>
          <p className="mt-0.5 text-[10px] text-gray-400">최근 10개</p>
        </div>
        <button
          type="button"
          onClick={openNewNote}
          disabled={!canCreateNote}
          className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-100"
          aria-disabled={!canCreateNote}
          title={hasNoteToday ? '오늘은 이 매장에 이미 한마디를 남겼어요.' : undefined}
          style={disabledNoteButtonStyle}
        >
          <Plus size={13} weight="bold" /> 한마디
        </button>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        onTouchStart={handleNotesTouchStart}
        onTouchMove={handleNotesTouchMove}
        onTouchEnd={handleNotesTouchEnd}
        onTouchCancel={handleNotesTouchEnd}
      >
        {loading ? (
          <p className="py-8 text-center text-xs text-gray-400">불러오는 중...</p>
        ) : !userId ? (
          <div className="flex h-full min-h-[120px] items-center justify-center px-4">
            <p className="text-center text-xs leading-relaxed text-gray-400">
              회원으로 로그인하면 한마디를 읽고 남길 수 있어요.
            </p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-gray-300" style={mutedAccentStyle}>
            <ChatDots size={34} weight="regular" />
          </div>
        ) : notes.map((note) => {
          const isMine = note.is_mine
          const avatarBg = getPastelColor(note.avatar_color_seed || note.username || note.id)
          return (
            <article key={note.id} className="flex gap-2.5 rounded-xl bg-white px-3 py-2 shadow-sm">
              <div
                className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[rgba(44,42,39,0.55)] dark:text-white/70"
                style={{ backgroundColor: note.is_anonymous ? '#f3f4f6' : avatarBg }}
              >
                {!note.is_anonymous && note.profile_image_url ? (
                  <img
                    src={note.profile_image_url}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <UserCircle size={24} weight="fill" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold text-gray-700">
                    <span className="truncate">{note.is_anonymous ? '익명' : note.username}</span>
                    {!note.is_anonymous && note.author_is_admin && <AdminBadge size={13} />}
                  </p>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">{formatNoteDate(note.created_at)}</span>
                    {isMine && (
                      <>
                        <button type="button" aria-label="한마디 수정" onClick={() => openEdit(note)} className="text-gray-400"><PencilSimple size={13} /></button>
                        <button type="button" aria-label="한마디 삭제" onClick={() => deleteNote(note.id)} className="text-gray-400"><Trash size={13} /></button>
                      </>
                    )}
                    {!isMine && userId && (
                      <button type="button" aria-label="한마디 신고" onClick={() => openReport(note)} className="text-gray-400"><Flag size={13} /></button>
                    )}
                    {isAdmin && (
                      <button type="button" aria-label="관리자 한마디 삭제" onClick={() => deleteNote(note.id)} className="text-red-400"><Trash size={13} /></button>
                    )}
                  </div>
                </div>
                <p className="mt-1 break-words text-xs leading-relaxed text-gray-600">{note.body}</p>
              </div>
            </article>
          )
        })}
      </div>

      {error && <p className="mt-2 text-center text-[11px] text-red-500">{error}</p>}
      {!canComment && userId && (
        <p className="mt-2 text-center text-[11px] text-gray-400">활성 회원만 한마디를 남길 수 있어요.</p>
      )}

      {reportTarget && createPortal(
        <div
          className="fixed inset-0 z-[1450] flex items-center justify-center overflow-y-auto bg-black/45 px-4 py-6"
          onClick={() => setReportTarget(null)}
        >
          <form
            onSubmit={reportNote}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[360px] space-y-3 rounded-2xl bg-white p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">한마디 신고</p>
              <button type="button" onClick={() => setReportTarget(null)} aria-label="신고창 닫기" className="text-gray-400">
                <X size={17} weight="bold" />
              </button>
            </div>
            <p className="rounded-lg bg-gray-50 p-2 text-xs leading-relaxed text-gray-600">
              {reportTarget.body}
            </p>
            <label className="block text-xs font-medium text-gray-600">
              신고 사유
              <select
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm"
              >
                <option value="community_guidelines">커뮤니티 가이드라인 위반</option>
                <option value="illegal_threat">위협 또는 괴롭힘</option>
                <option value="privacy">개인정보 또는 사생활 침해</option>
                <option value="intellectual_property">저작권 또는 지식재산권 침해</option>
                <option value="other_illegal">그 밖의 불법 콘텐츠</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-600">
              설명 (선택)
              <textarea
                value={reportExplanation}
                onChange={(event) => setReportExplanation(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="이 콘텐츠가 문제라고 생각하는 이유를 적어 주세요"
                className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:border-orange-400"
              />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              신고자 이름
              <input
                value={reporterName}
                onChange={(event) => setReporterName(event.target.value)}
                maxLength={100}
                required
                className="mt-1.5 w-full rounded-lg border border-gray-200 p-2.5 text-sm"
              />
            </label>
            <p className="text-[11px] text-gray-500">회신 이메일: {reporterEmail || '확인할 수 없음'}</p>
            <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
              <input
                type="checkbox"
                checked={reportGoodFaith}
                onChange={(event) => setReportGoodFaith(event.target.checked)}
                required
                className="mt-0.5"
              />
              입력한 신고 내용은 사실이며, 이에 동의합니다
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setReportTarget(null)} className="rounded-full px-3 py-2 text-xs text-gray-500">
                취소
              </button>
              <button
                type="submit"
                disabled={reportSubmitting || !reporterName.trim() || !reportGoodFaith}
                className="rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {reportSubmitting ? '접수 중...' : '신고 접수'}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      )}

      {composerOpen && createPortal(
        <div
          className="fixed inset-x-0 z-[1400] flex items-center justify-center overflow-hidden bg-black/45 px-4"
          style={{
            top: 'calc(-1 * env(safe-area-inset-top, 0px))',
            bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
          onClick={closeComposer}
          onTouchStart={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.preventDefault()}
        >
          <form
            onSubmit={saveNote}
            onClick={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            className="good-to-know-note-modal w-full max-w-[320px] rounded-2xl bg-white p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{editingNote ? '나의 한마디 수정' : '나의 한마디'}</p>
              <button
                type="button"
                onClick={closeComposer}
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400"
                aria-label="작성창 닫기"
              >
                <X size={17} weight="bold" />
              </button>
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_NOTE_LENGTH}
              rows={3}
              placeholder="추천 메뉴나 매장 분위기, 다음 사람을 위한 꿀팁을 남겨주세요!"
              className="good-to-know-note-textarea w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-orange-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> 익명
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400">{body.length}/{MAX_NOTE_LENGTH}</span>
                <button type="submit" disabled={saving || !body.trim()} className="rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? '저장 중...' : '추가'}
                </button>
              </div>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  )
}

async function syncLinkedReviewNoteToSheets({ redemptionId, storeId, rating, tags, comment }) {
  if (!redemptionId || !storeId || !rating || !Array.isArray(tags)) {
    throw new Error('연결된 리뷰 정보를 찾을 수 없습니다.')
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('로그인이 필요합니다.')

  const { data, error } = await supabase.functions.invoke('sync-to-sheets', {
    body: {
      redemption_id: redemptionId,
      store_id: storeId,
      rating,
      tags,
      comment,
      update_review_comment: true,
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  })
  if (error || data?.success !== true) {
    throw error || new Error(data?.message || 'Review note sync failed')
  }
}
