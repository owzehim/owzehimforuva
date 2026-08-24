import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { commentId, targetLanguage } = await req.json()
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const googleKey = Deno.env.get('GOOGLE_TRANSLATE_API_KEY') || ''
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ message: 'Unauthorized' }, 401)
    if (!googleKey) return json({ message: 'Translation is not configured.' }, 503)
    const admin = createClient(url, service)
    const { data: cached } = await admin.from('restaurant_comment_translations').select('translated_body').eq('comment_id', commentId).eq('target_language', targetLanguage).maybeSingle()
    if (cached) return json({ translation: cached.translated_body })
    const { data: comment, error } = await admin.from('restaurant_comments').select('body').eq('id', commentId).single()
    if (error || !comment) return json({ message: 'Comment not found.' }, 404)
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${googleKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: comment.body, target: targetLanguage, format: 'text' }) })
    const result = await response.json()
    const translation = result?.data?.translations?.[0]?.translatedText
    if (!response.ok || !translation) return json({ message: 'Translation failed.' }, 502)
    await admin.from('restaurant_comment_translations').upsert({ comment_id: commentId, target_language: targetLanguage, translated_body: translation }, { onConflict: 'comment_id,target_language' })
    return json({ translation })
  } catch { return json({ message: 'Translation failed.' }, 500) }
})
