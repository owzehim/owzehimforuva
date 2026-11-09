// SEC-56: short-lived links to note authors' profile photos.
// The notes view no longer exposes storage paths (they contain the author's
// user ID). The app sends the IDs of notes it shows; this function returns a
// signed photo link only for visible, non-anonymous notes whose author still
// has a photo. The path is built from the note owner, never from client input.
import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession, requireVerifiedLoginResponse } from '../_shared/requireVerifiedLogin.ts'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'

const PROFILE_BUCKET = 'profile-images'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const MAX_NOTES = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseNoteIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_NOTES) return null
  if (!value.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) return null
  return [...new Set(value.map((id) => id.toLowerCase()))]
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false }, 405)

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ success: false }, 401)

    let body: Record<string, unknown> | null
    try {
      body = await readJsonBody(req, 4096) as Record<string, unknown>
    } catch (bodyError) {
      return json({ success: false }, bodyError instanceof RequestBodyTooLargeError ? 413 : 400)
    }
    const noteIds = parseNoteIds(body?.noteIds)
    if (!noteIds) return json({ success: false }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Note author photo service configuration is missing')
      return json({ success: false }, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    // Same access as the notes view: verified app login on the current device.
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userError || !user) return json({ success: false }, 401)
    if (!hasVerifiedAppLogin(token, user.id)) return requireVerifiedLoginResponse(corsHeaders)
    if (!(await hasActiveDeviceSession(admin, user.id, token, { testAccountEmail: user.email }))) {
      return json({ success: false }, 403)
    }

    if (noteIds.length === 0) return json({ success: true, photos: {} })

    const { data: notes, error: notesError } = await admin
      .from('restaurant_notes')
      .select('id, user_id')
      .in('id', noteIds)
      .is('hidden_at', null)
      .eq('is_anonymous', false)
    if (notesError) throw new Error('Note lookup failed')

    const ownerIds = [...new Set((notes || []).map((note) => String(note.user_id)))]
    if (ownerIds.length === 0) return json({ success: true, photos: {} })

    const { data: owners, error: ownersError } = await admin
      .from('members')
      .select('user_id')
      .in('user_id', ownerIds)
      .not('profile_image_url', 'is', null)
    if (ownersError) throw new Error('Author lookup failed')

    const ownersWithPhoto = new Set((owners || []).map((owner) => String(owner.user_id)))
    const paths = ownerIds.filter((id) => ownersWithPhoto.has(id)).map((id) => `avatars/${id}.jpg`)
    if (paths.length === 0) return json({ success: true, photos: {} })

    const { data: signed, error: signError } = await admin.storage
      .from(PROFILE_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    if (signError) throw new Error('Photo link creation failed')

    const urlByOwner = new Map<string, string>()
    for (const entry of signed || []) {
      const ownerId = String(entry?.path || '').replace(/^avatars\//, '').replace(/\.jpg$/, '')
      if (!entry?.error && entry?.signedUrl) urlByOwner.set(ownerId, entry.signedUrl)
    }

    const photos: Record<string, string> = {}
    for (const note of notes || []) {
      const url = urlByOwner.get(String(note.user_id))
      if (url) photos[String(note.id)] = url
    }
    return json({ success: true, photos })
  } catch (error) {
    console.error('note-author-photos failed', { errorName: error instanceof Error ? error.name : 'unknown' })
    return json({ success: false }, 500)
  }
})
