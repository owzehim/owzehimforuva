// CITS report v4: fixes that need no team decision.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getConsentReceiptRows } from '../supabase/functions/_shared/legalConsent.js'

const read = (path) => readFileSync(path, 'utf8')

test('SEC-66 / SEC-67 / FUNC-11: migration closes comment writes, limits review prompts, unblocks the retention queue', () => {
  const sql = read('supabase/migrations/20261111100000_report_v4_sec66_sec67_func11.sql')
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.restaurant_comments FROM anon, authenticated/)
  assert.match(sql, /FOR UPDATE TO authenticated\s+USING \(\(SELECT auth\.uid\(\)\) = user_id\)\s+WITH CHECK \(\(SELECT auth\.uid\(\)\) = user_id\)/)
  assert.match(sql, /GRANT UPDATE \(status\) ON public\.review_prompts TO authenticated/)
  assert.match(sql, /ORDER BY queue\.database_done, queue\.next_attempt_at, queue\.queued_at/)
  assert.match(sql, /AND queue\.next_attempt_at <= now\(\)/)
  assert.match(sql, /database_done = true/)
  const check = read('supabase/checks/permission-check.sql')
  assert.match(check, /'authenticated\|restaurant_comments\|S',/)
  assert.match(check, /'authenticated\|review_prompts\|UPDATE\|status'/)
  assert.match(check, /has_column_privilege\(x\.role_name/)
  const job = read('supabase/functions/privacy-retention-sync/index.ts')
  assert.match(job, /stalled_sync_count/)
})

test('SEC-63: only one test account, and the TEST success screen says no benefit', () => {
  assert.match(read('supabase/migrations/20261111110000_report_v4_sec63_sec36_sec62.sql'), /UNIQUE INDEX IF NOT EXISTS login_otp_exempt_users_single_test_account[\s\S]*WHERE reason = 'test'/)
  const scan = read('src/pages/ScanPage.jsx')
  assert.match(scan, /\{testMode && \(\s*<div role="alert"[\s\S]*TEST MODE — 혜택 없음/)
})

test('GDPR-21: sign-up consent is recorded only for the current document version', () => {
  const registration = {
    legal_documents: { terms: 'old', privacy: 'old', community: 'old' },
    privacy_policy_version: 'old',
    age_16_plus_confirmed: true,
  }
  const rows = getConsentReceiptRows('u1', registration, '2026-11-11T00:00:00.000Z', 'new')
  assert.deepEqual(rows.map((row) => row.document_key), ['age_16_plus'])
  const current = { legal_documents: { terms: 'new', privacy: 'new', community: 'new' }, privacy_policy_version: 'new' }
  assert.equal(getConsentReceiptRows('u1', current, 't', 'new').length, 3)
  const server = read('supabase/functions/manage-legal-consent/index.ts')
  assert.match(server, /body\.documentVersion !== CURRENT_LEGAL_DOCUMENT_VERSION/)
  assert.match(read('src/pages/LegalConsentPage.jsx'), /documentVersion: LEGAL_DOCUMENT_VERSION/)
  assert.match(read('src/App.jsx'), /refreshLegalConsent\(\)[\s\S]*addEventListener\('visibilitychange'/)
})

test('GDPR-23: editing a review never changes whether the note is anonymous', () => {
  const api = read('src/api/reviewApi.js')
  assert.match(api, /\.update\(\{ body: trimmedComment \}\)/)
})

test('FUNC-12: a partner Sheet with an address but no switched-on secret is a failure, not a skip', () => {
  assert.match(read('supabase/functions/_shared/appsScriptPost.ts'), /errorCode: 'partner_secret_disabled'/)
})

test('FUNC-13: a deletion that fails after being queued is finished by the daily job', () => {
  const fn = read('supabase/functions/delete-my-account/index.ts')
  assert.match(fn, /deletionQueued && queueClient && queuedUserId/)
  assert.match(fn, /delete_auth_user: true, sync_master_sheet: true, database_done: false/)
  // Once the Auth account is gone, a later failure must not re-queue a deletion.
  assert.match(fn, /deleteUser\(user\.id\)\n\s+if \(deleteUserError\) throw new Error\('Auth account deletion failed'\)\n\s+deletionQueued = false/)
})

test('PERF-15 / PERF-16: small Sentry entry, review prompts polled only while visible', () => {
  assert.match(read('src/lib/errorMonitoring.js'), /import\('\.\/sentryLite\.js'\)/)
  assert.match(read('src/lib/sentryLite.js'), /export \{ init, captureException \} from '@sentry\/react'/)
  const hook = read('src/hooks/useReviewPrompt.js')
  assert.match(hook, /document\.visibilityState === 'hidden'/)
  assert.match(hook, /removeEventListener\('visibilitychange'/)
})

test('SEC-36 / SEC-62: WebP-only wallpapers; each report notice is sent at most once', () => {
  const sql = read('supabase/migrations/20261111110000_report_v4_sec63_sec36_sec62.sql')
  assert.match(sql, /SET allowed_mime_types = ARRAY\['image\/webp'\]\s+WHERE id = 'stamp-card-wallpapers'/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.content_report_notice_log/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  const fn = read('supabase/functions/send-content-report-notice/index.ts')
  assert.ok(fn.indexOf(".from('content_report_notice_log')") < fn.indexOf("fetch('https://api.resend.com/emails'"))
  assert.match(fn, /claimError\.code === '23505'/)
  assert.match(fn, /await releaseClaim\(\)/)
})

test('SEC-65 / SEC-64 / OPS-18: no people counts in the backup log, pinned actions, retention after backup', () => {
  const backup = read('.github/workflows/backup-production-db.yml')
  assert.doesNotMatch(backup, /auth users:|members: \$\(/)
  for (const file of ['ci.yml', 'backup-production-db.yml', 'database-permission-check.yml', 'deploy-edge-functions.yml', 'schema-snapshot.yml']) {
    const workflow = read(`.github/workflows/${file}`)
    for (const line of workflow.split('\n').filter((l) => l.trim().startsWith('uses:'))) {
      assert.match(line, /@[0-9a-f]{40}\b/, `${file}: ${line.trim()}`)
    }
  }
  const retention = read('.github/workflows/privacy-retention-sync.yml')
  assert.match(retention, /workflow_run:\s+workflows: \['Encrypted production database backup'\]/)
  assert.match(retention, /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.doesNotMatch(retention, /cron:/)
})

test('SEC-59 / SEC-61 / SEC-64: one-time reset code, recent reset request, production environment', () => {
  const page = read('src/pages/ResetPasswordPage.jsx')
  assert.match(page, /verifyOtp\(\{ token_hash: tokenHash, type: 'recovery' \}\)/)
  assert.match(page, /VITE_RECOVERY_TOKEN_HASH_ONLY === 'true'/)
  assert.match(page, /!TOKEN_HASH_ONLY && hash\.get\('type'\) === 'recovery'/)
  assert.match(read('src/api/authRepository.js'), /redirectTo\.searchParams\.set\('flow', 'recovery'\)/)
  assert.match(read('docs/email-templates/reset-password.html'), /\{\{ \.RedirectTo \}\}&token_hash=\{\{ \.TokenHash \}\}&type=recovery/)
  const signal = read('supabase/functions/password-reset-return-signal/index.ts')
  assert.match(signal, /recovery_sent_at/)
  assert.match(signal, /RECOVERY_REQUEST_MAX_AGE_MS = 60 \* 60 \* 1000/)
  for (const file of ['backup-production-db.yml', 'database-permission-check.yml', 'privacy-retention-sync.yml']) {
    assert.match(read(`.github/workflows/${file}`), /environment: production-db$/m, file)
  }
})
