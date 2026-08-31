import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChatDots, Flag, PencilSimple, Plus, Trash, Translate, X } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

const MAX_NOTE_LENGTH = 200

function formatNoteDate(value) {
  return new Intl.DateTimeFormat('nl-NL', {
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
    return 'Add a username in Settings before leaving a note.'
  }
  if (message.includes('only active members')) {
    return 'Only active members can leave notes.'
  }
  return 'Could not save your note. Please try again.'
}

export function GoodToKnowNotesPanel({
  restaurantId,
  userId,
  username,
  canComment,
  isAdmin,
  targetLanguage = 'en',
}) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [translations, setTranslations] = useState({})
  const touchStartRef = useRef(null)
  const todayKey = formatAmsterdamDay(Date.now())
  const hasNoteToday = notes.some((note) => (
    note.user_id === userId && formatAmsterdamDay(note.created_at) === todayKey
  ))
  const canCreateNote = !!userId && canComment && !hasNoteToday

  const loadNotes = useCallback(async () => {
    if (!restaurantId || !userId) {
      setLoading(false)
      return
    }

    const { data, error: loadError } = await supabase
      .from('restaurant_notes')
      .select('id, user_id, username, is_anonymous, body, created_at, updated_at')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (loadError) setError('Could not load notes.')
    else setNotes(data || [])
    setLoading(false)
  }, [restaurantId, userId])

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setNotes([])
    setLoading(true)
    setComposerOpen(false)
    setEditingNote(null)
    setBody('')
    setError('')
    setTranslations({})
    loadNotes()

    if (!restaurantId) return undefined
    const channel = supabase
      .channel(`restaurant-notes-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_notes', filter: `restaurant_id=eq.${restaurantId}` },
        loadNotes,
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [restaurantId, loadNotes])

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
      setError(errorMessage(result.error))
      return
    }

    setComposerOpen(false)
    setBody('')
    setEditingNote(null)
    loadNotes()
  }

  const deleteNote = async (noteId) => {
    if (!window.confirm('Delete this note?')) return
    const { error: deleteError } = await supabase
      .from('restaurant_notes')
      .delete()
      .eq('id', noteId)

    if (deleteError) setError('Could not delete the note.')
    else loadNotes()
  }

  const translateNote = async (noteId) => {
    setError('')
    const { data, error: translateError } = await supabase.functions.invoke('translate-note', {
      body: { noteId, targetLanguage },
    })

    if (translateError || !data?.translation) {
      setError('Could not translate this note.')
    } else {
      setTranslations((current) => ({ ...current, [noteId]: data.translation }))
    }
  }

  const reportNote = async (noteId) => {
    if (!userId || !window.confirm('Report this note?')) return
    const { error: reportError } = await supabase
      .from('restaurant_note_reports')
      .insert({ note_id: noteId, reporter_id: userId })

    if (reportError?.code === '23505') setError('You already reported this note.')
    else if (reportError) setError('Could not report this note.')
    else setError('Thanks. The note has been reported.')
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
          <p className="text-xs font-semibold text-gray-500">가본 사람 한마디</p>
          <p className="mt-0.5 text-[10px] text-gray-400">Newest 10 · one per day</p>
        </div>
        <button
          type="button"
          onClick={openNewNote}
          disabled={!canCreateNote}
          className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-100"
          aria-disabled={!canCreateNote}
          title={hasNoteToday ? 'You already left a note here today.' : undefined}
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
          <p className="py-8 text-center text-xs text-gray-400">Loading notes...</p>
        ) : !userId ? (
          <p className="py-8 text-center text-xs leading-relaxed text-gray-400">
            Log in as a member to read and leave notes.
          </p>
        ) : notes.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center text-gray-300">
            <ChatDots size={34} weight="regular" />
          </div>
        ) : notes.map((note) => {
          const isMine = note.user_id === userId
          return (
            <article key={note.id} className="rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-gray-700">
                  {note.is_anonymous ? '익명' : note.username}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400">{formatNoteDate(note.created_at)}</span>
                  {isMine && (
                    <>
                      <button type="button" aria-label="Edit note" onClick={() => openEdit(note)} className="text-gray-400"><PencilSimple size={13} /></button>
                      <button type="button" aria-label="Delete note" onClick={() => deleteNote(note.id)} className="text-gray-400"><Trash size={13} /></button>
                    </>
                  )}
                  {!isMine && userId && (
                    <button type="button" aria-label="Report note" onClick={() => reportNote(note.id)} className="text-gray-400"><Flag size={13} /></button>
                  )}
                  {isAdmin && (
                    <button type="button" aria-label="Admin delete note" onClick={() => deleteNote(note.id)} className="text-red-400"><Trash size={13} /></button>
                  )}
                </div>
              </div>
              <p className="mt-1 break-words text-xs leading-relaxed text-gray-600">{note.body}</p>
              {translations[note.id] ? (
                <p className="mt-1 break-words border-t border-gray-100 pt-1 text-xs leading-relaxed text-gray-500">{translations[note.id]}</p>
              ) : (
                <button type="button" onClick={() => translateNote(note.id)} className="mt-1 flex items-center gap-1 text-[10px] text-orange-500">
                  <Translate size={12} /> Translate
                </button>
              )}
            </article>
          )
        })}
      </div>

      {error && <p className="mt-2 text-center text-[11px] text-red-500">{error}</p>}
      {!canComment && userId && (
        <p className="mt-2 text-center text-[11px] text-gray-400">Only active members can leave notes.</p>
      )}

      {composerOpen && createPortal(
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/45 px-4"
          onClick={() => setComposerOpen(false)}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <form
            onSubmit={saveNote}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[320px] rounded-2xl bg-white p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{editingNote ? 'Edit note' : '나의 한마디'}</p>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400"
                aria-label="Close note composer"
              >
                <X size={17} weight="bold" />
              </button>
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_NOTE_LENGTH}
              rows={3}
              autoFocus
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
                  {saving ? 'Saving' : '추가'}
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
