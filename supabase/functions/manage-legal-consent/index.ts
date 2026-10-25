import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'

import { createClient } from '@supabase/supabase-js'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { CURRENT_LEGAL_DOCUMENT_VERSION } from '../_shared/legalConsent.js'

const REQUIRED_DOCUMENT_KEYS = ['terms', 'privacy', 'community']

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const configuredOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS') || ''
  const corsHeaders = getCorsHeaders(origin, configuredOrigins)
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

  if (!isAllowedCorsOrigin(origin, configuredOrigins)) return new Response('Origin not allowed', { status: 403 })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ success: false, message: '로그인이 필요합니다.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Legal consent service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    const user = authData?.user
    if (authError || !user?.email_confirmed_at) {
      return json({ success: false, message: '이메일 인증된 로그인이 필요합니다.' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    if (body?.action === 'status') {
      const { data: receipts, error } = await admin
        .from('legal_consent_receipts')
        .select('document_key, document_version')
        .eq('user_id', user.id)
        .in('document_key', REQUIRED_DOCUMENT_KEYS)

      if (error) {
        console.error('Legal consent status lookup failed')
        return json({ success: false, message: '동의 상태를 확인하지 못했습니다.' }, 503)
      }
      return json({ success: true, requiredVersion: CURRENT_LEGAL_DOCUMENT_VERSION, receipts: receipts || [] })
    }

    if (body?.action !== 'accept' || !Array.isArray(body.documentKeys)) {
      return json({ success: false, message: '요청을 확인할 수 없습니다.' }, 400)
    }
    const submitted = [...new Set(body.documentKeys)]
    if (submitted.length !== REQUIRED_DOCUMENT_KEYS.length ||
      REQUIRED_DOCUMENT_KEYS.some((key) => !submitted.includes(key))) {
      return json({ success: false, message: '모든 최신 문서의 동의가 필요합니다.' }, 400)
    }

    const acceptedAt = new Date().toISOString()
    const receipts = REQUIRED_DOCUMENT_KEYS.map((documentKey) => ({
      user_id: user.id,
      document_key: documentKey,
      document_version: CURRENT_LEGAL_DOCUMENT_VERSION,
      accepted_at: acceptedAt,
    }))
    const { error: receiptError } = await admin
      .from('legal_consent_receipts')
      .upsert(receipts, { onConflict: 'user_id,document_key,document_version' })
    if (receiptError) {
      console.error('Legal consent receipt insert failed')
      return json({ success: false, message: '동의 내용을 저장하지 못했습니다.' }, 500)
    }

    const { error: memberError } = await admin
      .from('members')
      .update({
        privacy_policy_version: CURRENT_LEGAL_DOCUMENT_VERSION,
        privacy_accepted_at: acceptedAt,
      })
      .eq('user_id', user.id)
    if (memberError) {
      console.error('Member legal consent version update failed')
    }

    return json({ success: true, requiredVersion: CURRENT_LEGAL_DOCUMENT_VERSION })
  } catch (error) {
    console.error('Unexpected legal consent operation failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    return json({ success: false, message: '동의 상태를 처리하지 못했습니다.' }, 500)
  }
})
