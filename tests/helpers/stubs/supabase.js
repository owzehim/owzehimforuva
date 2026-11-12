// Test stub: no network. Every call resolves to "nothing found".
const result = Promise.resolve({ data: null, error: null })
const query = new Proxy(function () {}, {
  get: (_target, prop) => (prop === 'then' ? result.then.bind(result) : () => query),
  apply: () => query,
})
export const supabase = {
  from: () => query,
  rpc: () => result,
  functions: { invoke: () => result },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: () => result }) },
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => result,
  },
}
export const passwordRecoverySupabase = supabase
export default supabase
