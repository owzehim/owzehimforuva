import { useCallback, useEffect, useState } from 'react'
import { Flag, PencilSimple, Plus, Trash, Translate } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

const MAX_NOTE_LENGTH = 200

function formatNoteDate(value) {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'short',
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

  return (
    <div className="relative flex h-full min-h-0 flex-col py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500">Good to Know Notes</p>
          <p className="mt-0.5 text-[10px] text-gray-400">Newest 10 · one per day</p>
        </div>
        <button
          type="button"
          onClick={openNewNote}
          disabled={!userId || !canComment}
          className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          <Plus size={13} weight="bold" /> Note
        </button>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
      >
        {loading ? (
          <p className="py-8 text-center text-xs text-gray-400">Loading notes...</p>
        ) : !userId ? (
          <p className="py-8 text-center text-xs leading-relaxed text-gray-400">
            Log in as a member to read and leave notes.
          </p>
        ) : notes.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-gray-400">
            Share a menu pick, seat note, waiting-time note, or anything useful to know.
          </p>
        ) : notes.map((note) => {
          const isMine = note.user_id === userId
          return (
            <article key={note.id} className="rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-gray-700">
                  {note.is_anonymous ? 'Anonymous' : note.username}
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

      {composerOpen && (
        <div className="absolute inset-0 z-20 flex items-end bg-black/20" onTouchStart={(event) => event.stopPropagation()}>
          <form onSubmit={saveNote} className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{editingNote ? 'Edit note' : 'New note'}</p>
              <button type="button" onClick={() => setComposerOpen(false)} className="text-xs text-gray-400">Close</button>
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_NOTE_LENGTH}
              rows={3}
              autoFocus
              placeholder="Menu pick, seating, waiting time, payment, or anything good to know"
              className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-orange-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Anonymous
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400">{body.length}/{MAX_NOTE_LENGTH}</span>
                <button type="submit" disabled={saving || !body.trim()} className="rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? 'Saving' : 'Post'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
