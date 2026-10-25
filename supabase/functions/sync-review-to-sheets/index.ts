import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

// This legacy endpoint has no callers in the current app. Review syncing is
// handled by the owner-checked sync-to-sheets function instead.
Deno.serve((req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(JSON.stringify({ success: false, message: 'This legacy endpoint is no longer available.' }), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
})
