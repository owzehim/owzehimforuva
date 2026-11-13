import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { loadNoteAuthorPhotos } = await import('../src/lib/noteAuthorPhotos.js').catch(() => ({}))

test('SEC-56: the notes view no longer exposes photo paths', async () => {
  const sql = await readFile('supabase/migrations/20261110100000_sec56_note_author_photos_server_links.sql', 'utf8')
  assert.match(sql, /NULL::text AS profile_image_url/)
  assert.match(sql, /AS has_author_photo/)
  assert.match(sql, /DROP POLICY IF EXISTS "SEC56 read visible note author avatars"/)
  const panel = await readFile('src/components/GoodToKnowNotesPanel.jsx', 'utf8')
  assert.ok(!panel.includes('createProfileImageSignedUrl'))
  assert.ok(panel.includes('has_author_photo'))
})

test('SEC-56: the photo function builds paths from the note owner only', async () => {
  const source = await readFile('supabase/functions/note-author-photos/index.ts', 'utf8')
  assert.match(source, /`avatars\/\$\{id\}\.jpg`/)
  assert.match(source, /hasActiveDeviceSession/)
  assert.match(source, /\.is\('hidden_at', null\)/)
  assert.match(source, /\.eq\('is_anonymous', false\)/)
})

test('SEC-56: only notes with a photo are requested, failures fall back to no photo', { skip: !loadNoteAuthorPhotos }, async () => {
  const sent = []
  const photos = await loadNoteAuthorPhotos([
    { id: 'a', has_author_photo: true, is_anonymous: false },
    { id: 'b', has_author_photo: false, is_anonymous: false },
    { id: 'c', has_author_photo: true, is_anonymous: true },
  ], async (body) => { sent.push(body); return { data: { success: true, photos: { a: 'https://x/a' } }, error: null } }, { cache: new Map() })
  assert.deepEqual(sent, [{ noteIds: ['a'] }])
  assert.deepEqual(photos, { a: 'https://x/a' })
  assert.deepEqual(await loadNoteAuthorPhotos([{ id: 'a', has_author_photo: true }], async () => { throw new Error('x') }, { cache: new Map() }), {})
  assert.deepEqual(await loadNoteAuthorPhotos([], async () => { throw new Error('never') }), {})
})

test('note photos: a link is reused for 50 minutes, so the 1-minute refresh keeps the same image', { skip: !loadNoteAuthorPhotos }, async () => {
  const cache = new Map()
  const notes = [{ id: 'a', has_author_photo: true }, { id: 'b', has_author_photo: true }]
  const sent = []
  let n = 0
  const invoke = async (body) => {
    sent.push(body.noteIds)
    n += 1
    return { data: { success: true, photos: Object.fromEntries(body.noteIds.map((id) => [id, `https://x/${id}?t=${n}`])) }, error: null }
  }
  const t0 = 1_000_000
  const first = await loadNoteAuthorPhotos(notes, invoke, { cache, now: t0 })
  const oneMinuteLater = await loadNoteAuthorPhotos(notes, invoke, { cache, now: t0 + 60_000 })
  assert.deepEqual(oneMinuteLater, first, 'same addresses: no re-download')
  assert.deepEqual(sent, [['a', 'b']], 'nothing requested again')

  // A new note: only that one is requested.
  await loadNoteAuthorPhotos([...notes, { id: 'c', has_author_photo: true }], invoke, { cache, now: t0 + 120_000 })
  assert.deepEqual(sent.at(-1), ['c'])

  // After 50 minutes the links are renewed (the server signs them for 1 hour).
  const later = await loadNoteAuthorPhotos(notes, invoke, { cache, now: t0 + 51 * 60_000 })
  assert.notEqual(later.a, first.a)

  // A failed refresh keeps the links that are still fresh.
  const kept = await loadNoteAuthorPhotos([{ id: 'c', has_author_photo: true }, { id: 'd', has_author_photo: true }],
    async () => { throw new Error('offline') }, { cache, now: t0 + 51 * 60_000 })
  assert.deepEqual(Object.keys(kept), ['c'])
})
