// Access audit (2026-11-12) and the no-decision items of CITS report v4.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const migration = read('supabase/migrations/20261112100000_access_hardening_func12_lookup.sql')

test('members cannot reset sequences, write comments, or store unknown review tags / long comments', () => {
  assert.match(migration, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;/)
  assert.match(migration, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON SEQUENCES FROM anon, authenticated;/)
  for (const verb of ['insert', 'update', 'delete']) {
    assert.match(migration, new RegExp(`DROP POLICY IF EXISTS "Members can ${verb} their own restaurant comments"`))
  }
  assert.match(migration, /tags <@ ARRAY\['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE'\]::text\[\]/)
  assert.match(migration, /char_length\(comment\) <= 200/)
})

test('stamp-card wallpapers: only admins may upload', () => {
  assert.match(migration, /CREATE POLICY "SEC07 admin manage stamp card wallpapers" ON storage\.objects\s+FOR ALL TO authenticated\s+USING \(\(bucket_id = 'stamp-card-wallpapers'\) AND \(SELECT public\.is_admin\(\)\)\)/)
})

test('FUNC-12: admin-only lookup of partners whose Sheet secret is off, shown in the admin page', () => {
  assert.match(migration, /FUNCTION public\.admin_partner_sheet_link_issues\(\)[\s\S]*WHERE public\.is_admin\(\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_partner_sheet_link_issues\(\) FROM PUBLIC, anon;/)
  // It returns names only, never Apps Script addresses or secrets.
  assert.match(migration, /RETURNS TABLE\(partnership_id text, partnership_name text\)/)
  assert.match(read('src/components/admin/PartnerSheetLinkWarning.jsx'), /rpc\('admin_partner_sheet_link_issues'\)/)
  assert.match(read('src/pages/AdminPage.jsx'), /activeTab === 'restaurants' && <><PartnerSheetLinkWarning \/>/)
})

test('OPS-19: the permission check also covers sequences, views, storage policies and buckets', () => {
  const check = read('supabase/checks/permission-check.sql')
  assert.match(check, /'admin_partner_sheet_link_issues'/)
  assert.match(check, /has_sequence_privilege\(r\.role_name, c\.oid, 'UPDATE'\)/)
  assert.match(check, /views without security_invoker/)
  assert.match(check, /'SEC07 admin manage stamp card wallpapers'/)
  assert.match(check, /'profile-images\|private'/)
})

test('FUNC-11: entries that keep failing open an issue (no count in the public issue)', () => {
  const workflow = read('.github/workflows/privacy-retention-sync.yml')
  assert.match(workflow, /echo "stalled=\$\(echo "\$response" \| jq -r '\.stalled_sync_count \/\/ 0'\)" >> "\$GITHUB_OUTPUT"/)
  assert.match(workflow, /alert-on-stalled:\s+needs: retention\s+if: \$\{\{ needs\.retention\.outputs\.stalled != '' && needs\.retention\.outputs\.stalled != '0' \}\}/)
  const issueBody = workflow.slice(workflow.indexOf('alert-on-stalled:'))
  assert.doesNotMatch(issueBody, /\$\{\{ needs\.retention\.outputs\.stalled \}\}/)
})

test('SEC-64: the schema snapshot workflow reads the database URL from production-db too', () => {
  assert.match(read('.github/workflows/schema-snapshot.yml'), /environment: production-db$/m)
})

test('GDPR-13: admin-created accounts keep the name only in the members row', () => {
  assert.doesNotMatch(read('supabase/functions/admin-create-member/index.ts'), /user_metadata: \{ first_name/)
})

test('LEG-10: small sign-up note text uses the darker grey in light mode', () => {
  assert.match(read('src/pages/RegistrationPage.jsx'), /--reg-soft-muted: #6b7280;/)
})
