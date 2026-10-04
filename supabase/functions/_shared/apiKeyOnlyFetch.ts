/**
 * New Supabase API keys are not JWTs. Keep them in `apikey` and strip only
 * the SDK's fallback `Authorization: Bearer <api key>` header. User JWTs and
 * explicit Authorization headers continue to pass through unchanged.
 */
export function apiKeyOnlyFetch(apiKey: string) {
  const fetcher = globalThis.fetch.bind(globalThis)
  const isNewApiKey = apiKey.startsWith('sb_publishable_') || apiKey.startsWith('sb_secret_')

  if (!isNewApiKey) return fetcher

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (request.headers.get('Authorization') === `Bearer ${apiKey}`) {
      request.headers.delete('Authorization')
    }
    return fetcher(request)
  }
}
