import { supabase } from './supabase'

/**
 * SEC-56: fetch short-lived photo links for the authors of the given notes.
 * Only notes the view marks with has_author_photo are sent. Returns
 * { [noteId]: signedUrl }; on any failure the notes simply show the colour
 * avatar, as before when a photo link could not be created.
 */
export async function loadNoteAuthorPhotos(notes, invoke = (body) => supabase.functions.invoke('note-author-photos', { body })) {
  const noteIds = (notes || [])
    .filter((note) => note?.has_author_photo === true && !note.is_anonymous && note.id)
    .map((note) => note.id)
    .slice(0, 50)
  if (noteIds.length === 0) return {}

  try {
    const { data, error } = await invoke({ noteIds })
    if (error || data?.success !== true || !data.photos || typeof data.photos !== 'object') return {}
    return data.photos
  } catch {
    return {}
  }
}
