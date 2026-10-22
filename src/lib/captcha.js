const turnstileSiteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY?.trim() || ''

export const isCaptchaEnabled = Boolean(turnstileSiteKey)

export function getCaptchaOptions(token, siteKey = turnstileSiteKey) {
  if (!siteKey) return {}
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('자동 확인을 완료한 뒤 다시 시도해주세요.')
  }

  return { captchaToken: token.trim() }
}
