# UvA-IN App

A progressive web app (PWA) for UvA-IN members.

## Development

- Software developer and technical maintainer: Woojay Lim

## Technology

- Frontend: React, Vite, and Tailwind CSS
- Backend and authentication: Supabase (Postgres, Auth, and Edge Functions)
- Hosting and deployment: Vercel
- Map integration: MapTiler
- Additional integration: Google Apps Script

## Local development

Requirements: Node.js and npm.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env.local` file with the frontend configuration values:

   ```text
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   VITE_MAPTILER_API_KEY=
   VITE_APP_ENV=development
   ```

   For local development, use the **DEV Supabase project** values. In Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` separately for Preview and Production; Preview should use DEV and Production should use the production project. Set `VITE_MAPTILER_API_KEY` for both environments. `VITE_APP_ENV=development` only enables development-only behavior when running Vite's local dev server.

3. Start the development server:

   ```sh
   npm run dev
   ```

Create a production build with `npm run build`.

## Project structure

- `src/` — React application
- `supabase/functions/` — Supabase Edge Functions
- `supabase/migrations/` — database migrations (mirrors the production migration ledger)
- `supabase/migrations_archive/` — migrations that must never be applied (see its README)
- `supabase/baselines/` — dated records of what was checked and applied in production
- `vercel.json` — Vercel routing and deployment configuration. It is identical on `main` and `dev`. The Content-Security-Policy is chosen by host: `app.uva-in.nl` and `uvain-app.vercel.app` get the production Supabase address only; every other host (Preview, `dev.app.uva-in.nl`) gets the DEV Supabase address only. If a production domain is added, add a `has` rule for it and add it to the `missing` list of the DEV rule.

## Database changes and deployment

- **Schema baseline (OPS-01):** `supabase/baselines/production-schema-20261106.sql` is a schema-only snapshot of production (no data). To build a new empty database, run it first, then any migration newer than `20261106010000`. Reference only: never run it against production.
- **Permission check (OPS-04):** `supabase/checks/permission-check.sql` runs weekly (GitHub Actions, *Database permission check*) in a read-only session. It fails, and opens a GitHub issue, if a table loses RLS or anon/authenticated gain a privilege or SECURITY DEFINER function outside the reviewed list. When a migration changes permissions on purpose, update that list in the same pull request.

Projects: production `npvcghdzrtqrlliprtnw` (Vercel Production, branch `main`) and DEV
`smesebnighdcwqcgokhg` (Vercel Preview, branch `dev`). Commit to `main` first, then cherry-pick
the same commit to `dev`.

- **Never run `supabase db push` or `supabase migration repair` against production.** The
  production ledger and `supabase/migrations/` are not fully aligned (see the latest file in
  `supabase/baselines/`), so a push would try to apply many old files.
- Change the database only with a **new** migration file; never edit a file that has been applied.
  Do not change production directly in the SQL Editor or through an AI tool.
- Apply one migration to **DEV first**, then production, each time as that single file plus its
  ledger row under the **same version**, in one transaction. Never create a second copy of the same
  change with a new timestamp.
- **Order:** take a backup → apply the migration → deploy the Edge Functions and frontend that use
  it. Exception: when a migration removes something the current frontend still sends, deploy the
  frontend first (the migration header says so).
- After each production change, re-run the read-only checks (CITS report v2.0 appendix B) and add
  the result to `supabase/baselines/`.
- Edge Function secrets set by us: `CORS_ALLOWED_ORIGINS`, `RETENTION_JOB_SECRET`,
  `MASTER_APPS_SCRIPT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  (Supabase provides `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`). GitHub
  Actions secrets: `RETENTION_JOB_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_PROD_DB_URL`. Values live only in those settings, never in the repository.

## Backups

`.github/workflows/backup-production-db.yml` runs daily at 02:30 UTC (before the 03:15 retention
job) and on demand. It dumps roles, schema, data and the migration ledger, checks them, encrypts
them with [age](https://age-encryption.org) and keeps the encrypted archive as a workflow artifact
for 30 days. Only the encrypted file leaves the runner; this repository is public.

- Required GitHub Actions secret: `SUPABASE_PROD_DB_URL` — the **Session pooler** connection
  string (dashboard → Connect → Session pooler) with the database password.
- The private decryption key is **not** in GitHub. Keep it in the association's password manager or
  key vault, with at least two board members having access. Without it the backups cannot be read.
- Storage files (photos) are not included; copy them manually with
  `supabase storage cp -r ss:///<bucket> <dir> --experimental` before risky changes.
- Restore (into a new or reset project, never over live data):

  ```sh
  age --decrypt -i uvain-backup-key.txt uvain-prod-db-<stamp>.tar.gz.age | tar -xz
  sha256sum -c SHA256SUMS.txt
  psql "$DB_URL" -f roles.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f data.sql
  ```

  Tested 2026-11-05: a workflow-format archive decrypted, passed its checksums and restored into an
  empty local Supabase stack in about 2 seconds with all row counts matching production.

## Security

- Never commit credentials or private keys.
- Keep Supabase service-role credentials in Supabase's server-side function secrets; do not expose them to frontend code or `VITE_` variables.
- Configure frontend environment values in the local environment and Vercel project settings.
