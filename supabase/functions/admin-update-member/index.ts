import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseServiceKey } from '../_shared/serviceKey.ts'
import { apiKeyOnlyFetch } from '../_shared/apiKeyOnlyFetch.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const allowedFields = new Set([
  'first_name',
  'last_name',
  'student_number',
  'major',
  'year_of_birth',
  'gender',
  'country_of_origin',
  'University',
  'education_level',
  'year_number',
  'is_member',
  'membership_valid_until',
])

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isValidDate(value: unknown) {
  if (value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateUpdates(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const updates = value as Record<string, unknown>
  const keys = Object.keys(updates)
  if (keys.length === 0 || keys.some((key) => !allowedFields.has(key))) return false

  if ('is_member' in updates && typeof updates.is_member !== 'boolean') return false
  if ('membership_valid_until' in updates && !isValidDate(updates.membership_valid_until)) return false

  for (const field of ['year_of_birth', 'year_number']) {
    if (!(field in updates)) continue
    const fieldValue = updates[field]
    if (
      fieldValue !== null &&
      !(typeof fieldValue === 'number' && Number.isInteger(fieldValue)) &&
      !(typeof fieldValue === 'string' && /^\d+$/.test(fieldValue))
    ) return false
  }

  for (const field of [
    'first_name',
    'last_name',
    'student_number',
    'major',
    'gender',
    'country_of_origin',
    'University',
    'education_level',
  ]) {
    if (field in updates && updates[field] !== null && typeof updates[field] !== 'string') {
      return false
    }
  }

  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ success: false, message: '허용되지 않은 요청입니다.' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }

    const body = await req.json().catch(() => null)
    const memberId = body?.memberId
    const updates = body?.updates
    if (
      typeof memberId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId) ||
      !validateUpdates(updates)
    ) {
      return json({ success: false, message: '잘못된 회원 수정 요청입니다.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = getSupabaseServiceKey()
    if (!supabaseUrl || !serviceKey) {
      console.error('Supabase service configuration is missing')
      return json({ success: false, message: '서버 설정 오류입니다.' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch(serviceKey) },
    })

    const { data: userData, error: userError } = await admin.auth.getUser(token)
    const caller = userData?.user
    if (userError || !caller) {
      return json({ success: false, message: '로그인이 필요합니다.' }, 401)
    }

    const { data: adminRole, error: adminRoleError } = await admin
      .from('admin_roles')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (adminRoleError) {
      console.error('Admin role lookup failed:', adminRoleError)
      return json({ success: false, message: '관리자 권한을 확인할 수 없습니다.' }, 500)
    }
    if (!adminRole) {
      return json({ success: false, message: '관리자 권한이 필요합니다.' }, 403)
    }

    const { data: updatedMember, error: updateError } = await admin
      .from('members')
      .update(updates)
      .eq('id', memberId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Admin member update failed:', updateError)
      return json({ success: false, message: '회원 정보를 수정하지 못했습니다.' }, 500)
    }
    if (!updatedMember) {
      return json({ success: false, message: '회원을 찾을 수 없습니다.' }, 404)
    }

    return json({ success: true })
  } catch (error) {
    console.error('Unexpected admin member update error:', error)
    return json({ success: false, message: '회원 정보를 수정하지 못했습니다.' }, 500)
  }
})
