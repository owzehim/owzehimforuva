// The server signs photo links for 1 hour. Reuse a link for 50 minutes, so the
// panel's once-a-minute refresh does not swap every avatar's address (which
// made the phone download each photo again and show it blank or half drawn).
export const PHOTO_LINK_REUSE_MS = 50 * 60 * 1000

const sharedCache = new Map()

/**
 * SEC-56: fetch short-lived photo links for the authors of the given notes.
 * Only notes the view marks with has_author_photo are sent, and only those
 * without a fresh link in the cache. Returns { [noteId]: signedUrl }; on a
 * failure, notes keep a still-fresh cached link or show the colour avatar.
 */
export async function loadNoteAuthorPhotos(
  notes,
  invoke = async (body) => {
    // Loaded here (already in the app bundle) so this file can be tested
    // without a Supabase client.
    const { supabase } = await import('./supabase')
    return supabase.functions.invoke('note-author-photos', { body })
  },
  { cache = sharedCache, now = Date.now() } = {},
) {
  const wanted = (notes || [])
    .filter((note) => note?.has_author_photo === true && !note.is_anonymous && note.id)
    .map((note) => String(note.id))
    .slice(0, 50)
  if (wanted.length === 0) return {}

  const photos = {}
  const missing = []
  for (const id of wanted) {
    const cached = cache.get(id)
    if (cached && now - cached.at < PHOTO_LINK_REUSE_MS) photos[id] = cached.url
    else missing.push(id)
  }
  if (missing.length === 0) return photos

  try {
    const { data, error } = await invoke({ noteIds: missing })
    if (error || data?.success !== true || !data.photos || typeof data.photos !== 'object') return photos
    for (const id of missing) {
      const url = data.photos[id]
      if (typeof url !== 'string' || !url) continue
      cache.set(id, { url, at: now })
      photos[id] = url
    }
    return photos
  } catch {
    return photos
  }
}
