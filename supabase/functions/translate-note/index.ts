import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { noteId, targetLanguage = 'en' } = await req.json()
    if (!noteId) return json({ message: 'Missing noteId.' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const googleTranslateKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY') || ''

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    })

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ message: 'Unauthorized.' }, 401)
    if (!googleTranslateKey) return json({ message: 'Translation is not configured.' }, 503)

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey)

    const { data: cached } = await admin
      .from('restaurant_note_translations')
      .select('translated_body')
      .eq('note_id', noteId)
      .eq('target_language', targetLanguage)
      .maybeSingle()

    if (cached) return json({ translation: cached.translated_body })

    const { data: note, error: noteError } = await admin
      .from('restaurant_notes')
      .select('body')
      .eq('id', noteId)
      .single()

    if (noteError || !note) return json({ message: 'Note not found.' }, 404)

    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${googleTranslateKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: note.body, target: targetLanguage, format: 'text' }),
      },
    )

    const result = await response.json()
    const translation = result?.data?.translations?.[0]?.translatedText
    if (!response.ok || !translation) return json({ message: 'Translation failed.' }, 502)

    await admin
      .from('restaurant_note_translations')
      .upsert(
        { note_id: noteId, target_language: targetLanguage, translated_body: translation },
        { onConflict: 'note_id,target_language' },
      )

    return json({ translation })
  } catch {
    return json({ message: 'Translation failed.' }, 500)
  }
})
