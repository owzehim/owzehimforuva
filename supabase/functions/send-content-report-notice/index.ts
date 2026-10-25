import { createClient } from '@supabase/supabase-js'
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

function formatEmailParagraphs(message: string): string {
  return message.split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b7280;">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`
  ).join('')
}

function formatNoteDisplayDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

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

    const body = await req.json().catch(() => null)
    const reportId = body?.reportId
    const recipientKind = body?.recipientKind as RecipientKind
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
    const intro = typeof body?.intro === 'string' ? body.intro.trim() : ''
    const outcome = typeof body?.outcome === 'string' ? body.outcome.trim() : ''
    const contact = typeof body?.contact === 'string' ? body.contact.trim() : ''
    if (!validUuid(reportId) || !['reporter', 'author'].includes(recipientKind)) {
      return json({ success: false, message: '잘못된 이메일 발송 요청입니다.' }, 400)
    }
    if (!subject || subject.length > 200 || !intro || intro.length > 4000 ||
        !outcome || outcome.length > 3000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || contact.length > 320) {
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
      .select('id, note_id, reporter_email, content_author_email, content_author_name_snapshot, note_snapshot, status, decision, reviewed_at')
      .eq('id', reportId)
      .maybeSingle()
    if (reportError) {
      console.error('Moderation email report lookup failed')
      return json({ success: false, message: '신고 정보를 불러오지 못했습니다.' }, 500)
    }
    if (!report || report.status !== 'resolved' || !report.decision || !report.reviewed_at) {
      return json({ success: false, message: '먼저 신고 처리를 완료해 주세요.' }, 409)
    }
    if (recipientKind === 'author' && !['content_deleted', 'content_hidden'].includes(report.decision)) {
      return json({ success: false, message: '삭제 또는 기존 숨김 처리된 댓글의 작성자에게만 안내할 수 있습니다.' }, 400)
    }

    const recipient = recipientKind === 'reporter' ? report.reporter_email : report.content_author_email
    if (!recipient) return json({ success: false, message: '받는 사람의 이메일 주소가 없습니다.' }, 400)

    const author = report.content_author_name_snapshot || '익명'
    const reportedComment = report.note_snapshot || '신고된 댓글 내용을 확인할 수 없습니다.'
    let commentDate = ''
    if (report.note_id) {
      const { data: note, error: noteError } = await admin
        .from('restaurant_notes')
        .select('created_at')
        .eq('id', report.note_id)
        .maybeSingle()
      if (!noteError && note?.created_at) commentDate = formatNoteDisplayDate(note.created_at)
    }
    const title = recipientKind === 'reporter' ? '신고 처리 결과' : '게시물 처리 안내'
    const dateCell = commentDate
      ? `<td align="right" style="padding:0 0 0 8px;white-space:nowrap;font-size:10px;line-height:16px;color:#9ca3af;">${escapeHtml(commentDate)}</td>`
      : ''
    const html = `<div style="margin:0;padding:0;background:#ffffff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#111111;"><div style="max-width:520px;margin:0 auto;padding:44px 32px 56px;"><img src="https://npvcghdzrtqrlliprtnw.supabase.co/storage/v1/object/public/public-assets/UvA-IN-logo-transparent.png" alt="UvA-IN" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;margin:0 0 46px;"/><h1 style="margin:0 0 34px;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:-0.5px;color:#050505;">${title}</h1><div style="height:1px;background:#e5e7eb;margin-bottom:34px;"></div>${formatEmailParagraphs(intro)}<h2 style="margin:28px 0 14px;font-size:16px;line-height:1.5;font-weight:700;color:#111111;">신고 대상 댓글 처리 결과</h2><div style="margin:0 0 24px;padding:8px 12px;border-radius:12px;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.12);"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td valign="top" style="width:32px;padding:2px 10px 0 0;"><div style="width:32px;height:32px;overflow:hidden;border-radius:50%;background:#f3f4f6;text-align:center;"><div style="width:10px;height:10px;margin:5px auto 1px;border-radius:50%;background:#8a8461;"></div><div style="width:20px;height:11px;margin:0 auto;border-radius:12px 12px 6px 6px;background:#8a8461;"></div></div></td><td valign="top" style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td style="padding:0;font-size:11px;line-height:16px;font-weight:700;color:#374151;">${escapeHtml(author)}</td>${dateCell}</tr><tr><td colspan="2" style="padding:4px 0 0;font-size:12px;line-height:1.6;color:#4b5563;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(reportedComment).replaceAll('\n', '<br>')}</td></tr></table></td></tr></table></div><p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#4b5563;"><strong style="color:#111111;">처리 결과: </strong>${escapeHtml(outcome).replaceAll('\n', '<br>')}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#6b7280;">안내드린 내용과 관련하여 추가 문의가 있으시다면 아래 경로로 연락해 주세요.</p><p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#6b7280;"><strong style="color:#111111;">추가 문의: </strong>${escapeHtml(contact)}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#6b7280;">감사합니다.</p><p style="margin:0;font-size:14px;line-height:1.7;font-weight:700;color:#374151;">UvA-IN App 팀 드림</p></div></div>`
    const text = [
      intro,
      '',
      '[신고 대상 댓글 처리 결과]',
      `${author}${commentDate ? ` · ${commentDate}` : ''}: ${reportedComment}`,
      `처리 결과: ${outcome}`,
      '',
      '안내드린 내용과 관련하여 추가 문의가 있으시다면 아래 경로로 연락해 주세요.',
      `추가 문의: ${contact}`,
      '',
      '감사합니다.',
      'UvA-IN App 팀 드림',
    ].join('\n')

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `content-report/${report.id}/${recipientKind}/${Date.parse(report.reviewed_at)}`,
      },
      body: JSON.stringify({ from, to: [recipient], subject, text, html }),
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
