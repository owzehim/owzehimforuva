/**
 * New Supabase API keys are not JWTs. Keep them in `apikey` and strip only
 * the SDK's fallback `Authorization: Bearer <api key>` header. Authenticated
 * requests carry a user JWT there and are left untouched.
 */
export function apiKeyOnlyFetch(apiKey) {
  const fetcher = globalThis.fetch.bind(globalThis)
  const isNewApiKey = apiKey?.startsWith('sb_publishable_') || apiKey?.startsWith('sb_secret_')

  if (!isNewApiKey) return fetcher

  return async (input, init) => {
    const request = new Request(input, init)
    if (request.headers.get('Authorization') === `Bearer ${apiKey}`) {
      request.headers.delete('Authorization')
    }
    return fetcher(request)
  }
}
