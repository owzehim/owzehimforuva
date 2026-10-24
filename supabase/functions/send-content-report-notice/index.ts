import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.js'
import { getCorsHeaders, isAllowedCorsOrigin } from '../_shared/cors.js'
import { hasVerifiedAppLogin, hasActiveDeviceSession } from '../_shared/requireVerifiedLogin.ts'

type RecipientKind = 'reporter' | 'author'

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatEmailMessage(message: string): string {
  return message.split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b7280;">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`
  ).join('')
}

serve(async (req) => {
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

    const body = await req.json().catch(() => null)
    const reportId = body?.reportId
    const recipientKind = body?.recipientKind as RecipientKind
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!validUuid(reportId) || !['reporter', 'author'].includes(recipientKind)) {
      return json({ success: false, message: '잘못된 이메일 발송 요청입니다.' }, 400)
    }
    if (!subject || subject.length > 200 || !message || message.length > 10000) {
      return json({ success: false, message: '이메일 제목과 내용을 확인해 주세요.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('RESEND_FROM_EMAIL')
    if (!supabaseUrl || !serviceKey || !resendApiKey || !from) {
      console.error('Moderation email configuration is missing')
      return json({ success: false, message: '메일 발송 설정이 완료되지 않았습니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const caller = userData?.user
    if (userError || !caller) return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    if (!hasVerifiedAppLogin(token, caller.id)) {
      return json({ success: false, message: '이메일 인증을 포함해 다시 로그인해 주세요.' }, 403)
    }
    if (!(await hasActiveDeviceSession(admin, caller.id, token))) {
      return json({ success: false, message: '현재 로그인 기기가 더 이상 활성 상태가 아닙니다.' }, 403)
    }

    const { data: adminRole, error: roleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()
    if (roleError) {
      console.error('Moderation email admin check failed')
      return json({ success: false, message: '관리자 권한을 확인할 수 없습니다.' }, 500)
    }
    if (!adminRole) return json({ success: false, message: '관리자 권한이 필요합니다.' }, 403)

    const { data: report, error: reportError } = await admin
      .from('restaurant_note_reports')
      .select('id, reporter_email, content_author_email, restaurant_name_snapshot, note_snapshot, status, decision, decision_reason')
      .eq('id', reportId)
      .maybeSingle()
    if (reportError) {
      console.error('Moderation email report lookup failed')
      return json({ success: false, message: '신고 정보를 불러오지 못했습니다.' }, 500)
    }
    if (!report || report.status !== 'resolved' || !report.decision) {
      return json({ success: false, message: '먼저 신고 처리를 완료해 주세요.' }, 409)
    }
    if (recipientKind === 'author' && report.decision !== 'content_hidden') {
      return json({ success: false, message: '숨김 처리된 콘텐츠의 작성자에게만 안내할 수 있습니다.' }, 400)
    }

    const recipient = recipientKind === 'reporter' ? report.reporter_email : report.content_author_email
    if (!recipient) return json({ success: false, message: '받는 사람의 이메일 주소가 없습니다.' }, 400)

    const headline = recipientKind === 'reporter' ? 'Report update' : 'Content moderation notice'
    const html = `<div style="margin:0;padding:0;background:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#111111;"><div style="max-width:520px;margin:0 auto;padding:44px 32px 56px;"><img src="https://npvcghdzrtqrlliprtnw.supabase.co/storage/v1/object/public/public-assets/UvA-IN-logo-transparent.png" alt="UvA-IN" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;margin:0 0 46px;"/><h1 style="margin:0 0 34px;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:-0.5px;color:#050505;">${headline}</h1><div style="height:1px;background:#e5e7eb;margin-bottom:34px;"></div>${formatEmailMessage(message)}</div></div>`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `content-report/${report.id}/${recipientKind}`,
      },
      body: JSON.stringify({ from, to: [recipient], subject, text: message, html }),
    })
    if (!response.ok) {
      console.error('Resend rejected moderation email:', response.status)
      return json({ success: false, message: `이메일 발송에 실패했습니다. (Resend ${response.status})` }, 502)
    }

    return json({ success: true })
  } catch (error) {
    console.error('Unexpected moderation email error:', error)
    return json({ success: false, message: '이메일 발송 중 오류가 발생했습니다.' }, 500)
  }
})
