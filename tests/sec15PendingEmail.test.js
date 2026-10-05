import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../supabase/migrations/20261005092214_sec15_finalize_pending_email_after_confirmation.sql')
const changeFunction = read('../supabase/functions/change-pending-email/index.ts')
const finalizeFunction = read('../supabase/functions/finalize-pending-email/index.ts')
const confirmationPage = read('../src/pages/EmailConfirmedPage.jsx')
const registrationFunction = read('../supabase/functions/complete-member-registration/index.ts')

test('pending email replacement preserves the old account until confirmation', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pending_email_changes/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.pending_email_changes FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT ALL ON TABLE public\.pending_email_changes TO service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_pending_email_change\(uuid, text\)[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_pending_email_change\(uuid, text\)[\s\S]*TO service_role/)
  assert.doesNotMatch(changeFunction, /\.from\('members'\)\s*\n\s*\.update\(\{ user_id: newUserId \}\)/)
  assert.doesNotMatch(changeFunction, /deleteUser\(oldUserId\)/)
  assert.match(changeFunction, /pending_email_changes/)
  assert.match(changeFunction, /consume_edge_rate_limit/)
  assert.match(changeFunction, /passwordError\.code !== 'email_not_confirmed'/)
  assert.match(changeFunction, /original_created_at: pendingUser\.created_at/)
  assert.doesNotMatch(changeFunction, /app_metadata\s*:/)
  assert.match(migration, /original_created_at timestamptz NOT NULL/)
  assert.match(migration, /RETURNS TABLE\(user_id uuid, user_metadata jsonb, created_at timestamptz\)/)
  assert.match(registrationFunction, /getConsentAcceptedAt\(user, pendingEmailChange\?\.original_created_at\)/)
  assert.doesNotMatch(changeFunction, /admin\.auth\.admin\.listUsers/)
})

test('confirmed replacement is authenticated, email-bound, and finalized idempotently', () => {
  assert.match(finalizeFunction, /admin\.auth\.getUser\(token\)/)
  assert.match(finalizeFunction, /!user\.email_confirmed_at \|\| !user\.email/)
  assert.match(finalizeFunction, /p_new_user_id: user\.id,[\s\S]*p_confirmed_email: user\.email/)
  assert.match(finalizeFunction, /if \(oldUserResult\?\.user\)/)
  assert.match(finalizeFunction, /deleteError && deleteError\.status !== 404/)
  assert.match(finalizeFunction, /if \(!user\.user_metadata\?\.registration\)[\s\S]*pending_email_changes/)
  assert.match(finalizeFunction, /\.delete\(\)\s*\n\s*\.eq\('new_user_id', user\.id\)/)
  assert.match(confirmationPage, /functions\.invoke\('finalize-pending-email'\)/)
  assert.match(registrationFunction, /\.from\('pending_email_changes'\)[\s\S]*\.select\('original_created_at'\)/)
  assert.ok(
    confirmationPage.indexOf("functions.invoke('finalize-pending-email')") <
      confirmationPage.indexOf("functions.invoke('complete-member-registration')"),
    'ownership transfer must run before registration creates or recovers the member row',
  )
})
