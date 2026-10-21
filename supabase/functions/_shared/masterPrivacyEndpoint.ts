import { getAllowedAppsScriptUrl } from './appsScriptAuth.js'

/** Resolve the one configured Master Apps Script endpoint used for privacy work. */
export async function getMasterPrivacyEndpoint(admin: any): Promise<string> {
  const { data, error } = await admin
    .from('partnership_integrations')
    .select('master_apps_script_url')
    .not('master_apps_script_url', 'is', null)
    .limit(10)

  if (error) throw new Error('Master Sheet integration lookup failed')

  const endpoints = [...new Set(
    (data || [])
      .map((row: { master_apps_script_url?: unknown }) => row?.master_apps_script_url)
      .filter((url: unknown): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url: string) => url.trim()),
  )]

  if (endpoints.length !== 1) {
    throw new Error(endpoints.length === 0
      ? 'Master Sheet privacy endpoint is not configured'
      : 'Master Sheet privacy endpoint configuration is ambiguous')
  }

  const allowedEndpoint = getAllowedAppsScriptUrl(endpoints[0])
  if (!allowedEndpoint) throw new Error('Master Sheet privacy endpoint is invalid')
  return allowedEndpoint
}
