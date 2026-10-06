import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getSupabasePublishableKey } from '../_shared/publishableKey.ts'
import { readJsonBody, RequestBodyTooLargeError } from '../_shared/readJsonBody.js'

serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: '허용되지 않은 요청입니다.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authorization = req.headers.get('Authorization')
  const publishableKey = getSupabasePublishableKey()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!authorization || !publishableKey || !supabaseUrl) {
    return new Response(JSON.stringify({ success: false, message: '요청을 처리할 수 없습니다.' }), {
      status: authorization ? 500 : 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req, 2048) as Record<string, unknown>
  } catch (bodyError) {
    const tooLarge = bodyError instanceof RequestBodyTooLargeError
    return new Response(JSON.stringify({ success: false, message: tooLarge ? '요청 크기가 너무 큽니다.' : '잘못된 요청입니다.' }), {
      status: tooLarge ? 413 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!body || typeof body.redemption_id !== 'string' && typeof body.redemption_id !== 'number') {
    return new Response(JSON.stringify({ success: false, message: '잘못된 요청입니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/sync-to-sheets`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ redemption_id: body.redemption_id }),
  })

  return new Response(await response.text(), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
  })
})
