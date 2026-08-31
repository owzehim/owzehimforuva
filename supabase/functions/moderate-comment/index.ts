import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { body } = await req.json()
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return new Response(JSON.stringify({ allowed: true, fallback: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  const response = await fetch('https://api.openai.com/v1/moderations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: String(body || '') }) })
  const result = await response.json()
  const flagged = Boolean(result?.results?.[0]?.flagged)
  return new Response(JSON.stringify({ allowed: !flagged }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
