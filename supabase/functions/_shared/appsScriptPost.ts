// One Apps Script sender for every Sheet write (check-ins, rewards, retries).
import { getAllowedAppsScriptUrl, withAppsScriptSecret } from './appsScriptAuth.js'

export type SheetTarget = 'master' | 'partner'
export type SheetSendResult = { ok: boolean, skipped?: boolean, drop?: boolean, errorCode?: string }

export async function postToAppsScript(
  url: string | null | undefined,
  target: SheetTarget,
  payload: Record<string, unknown>,
  partnerSecret?: string | null,
): Promise<SheetSendResult> {
  // A Sheet that is intentionally not connected (no URL) is not a failure (FUNC-09).
  if (!url) return { ok: false, skipped: true }
  const endpoint = getAllowedAppsScriptUrl(url)
  if (!endpoint) return { ok: false, errorCode: 'invalid_endpoint' }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(withAppsScriptSecret(
        payload,
        target === 'master' ? Deno.env.get('MASTER_APPS_SCRIPT_SECRET') : partnerSecret,
      )),
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) return { ok: false, errorCode: `http_${response.status}` }
    let result: Record<string, unknown> | null
    try {
      result = text ? JSON.parse(text) : null
    } catch {
      return { ok: false, errorCode: 'invalid_response' }
    }
    // HTTP 200 alone does not prove Apps Script applied the Sheet update.
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.success !== true) {
      const message = typeof result?.error === 'string' ? result.error.toLowerCase() : ''
      const errorCode = message === 'unauthorized'
        ? 'auth_rejected'
        : message.includes('partnership_id')
          ? 'partnership_mismatch'
          : message.includes('permission') || message.includes('spreadsheet') || message.includes('sheet')
            ? 'sheet_access_or_structure'
            : 'script_rejected'
      return { ok: false, errorCode }
    }
    return { ok: true }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, errorCode: 'timeout' }
    if (error instanceof Error && error.message.includes('secret')) return { ok: false, errorCode: 'secret_missing' }
    return { ok: false, errorCode: 'network' }
  } finally {
    clearTimeout(timeoutId)
  }
}
