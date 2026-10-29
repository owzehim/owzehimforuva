import { supabase } from './supabase'

export async function logRedemption({ storeId }) {
  try {
    const { data: { session }, error: authError } = await supabase.auth.getSession()

    if (authError || !session) {
      return { success: false, message: '로그인이 필요합니다.' }
    }

    const { data, error } = await supabase.functions.invoke('log-redemption', {
      body: { storeId },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (error) {
      console.error('Edge function error:', error)
      let testMode = false
      try {
        const errorBody = await error.context?.clone?.().json()
        testMode = errorBody?.testMode === true
      } catch {
        // Non-JSON and transport errors do not establish test-account status.
      }
      return { success: false, testMode, message: '서버 오류가 발생했습니다.' }
    }

    return data

  } catch (err) {
    console.error('logRedemption error:', err)
    return { success: false, message: '오류가 발생했습니다. 다시 시도해주세요.' }
  }
}
