# Setup steps: SEC-59/61, SEC-64, SEC-65 (CITS report v4)

These need dashboard or account access, so a person has to do them. The code side is already in
the repository. Do every step in **DEV first**, check it, then production. Never paste a secret
value into chat, an issue, or this repository.

---

## SEC-59 / SEC-61 — password reset only through the reset email

**Why:** someone who steals a member's sign-in token could otherwise use it to set a new password.

The app now understands a reset link that carries a one-time code (`token_hash`). Until you switch
the email template, the old links keep working, so you can do the steps below at any time.

### 1. Require a recent sign-in to change a password (most important)

Supabase dashboard → project → **Authentication → Sign In / Providers → Email** →
turn on **Secure password change** (Supabase docs call it *Require reauthentication when
changing password*) → Save.

With this on, a password can only be changed by a session created in the last 24 hours (a fresh
sign-in or a reset email); an older or stolen session would need an extra code sent by email. The app's own "비밀번호 변경" screen signs in again before changing the password,
so it keeps working. Do it in DEV (`smesebnighdcwqcgokhg`) and production (`npvcghdzrtqrlliprtnw`).

### 2. Switch the reset email to the one-time code link

Supabase dashboard → project → **Authentication → Emails → Templates → Reset password**:

1. Subject: `[UvA-IN] 비밀번호 재설정 / Reset your password` (or keep yours).
2. Body: paste the whole of [`docs/email-templates/reset-password.html`](email-templates/reset-password.html).
   The important part is the link:
   `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`
3. Save.
4. Check **Authentication → URL Configuration → Redirect URLs** still lists the app's
   `/reset-password` address for that project (it already does if password reset works today).

### 3. Test (DEV)

Open the DEV preview → 로그인 → 비밀번호 찾기 → send to a test account → open the email →
the button opens the reset page → set a new password → sign in with it.

### 4. Turn off the old link types

Vercel → project → **Settings → Environment Variables** → add
`VITE_RECOVERY_TOKEN_HASH_ONLY` = `true`:

- first for **Preview** (DEV), redeploy the `dev` preview, test step 3 again;
- then for **Production**, after the production template is switched, and redeploy production.

From then on the reset page accepts only sessions it created from the email's one-time code.

The server side (SEC-61) is already stricter: the "reset finished" signal is accepted only for an
account that requested a reset in the last hour.

---

## SEC-64 — production database password only for the `main` branch

**Why:** today any branch's workflow can read `SUPABASE_PROD_DB_URL` (full database access).

The backup, retention and permission-check workflows already use a GitHub Environment called
`production-db`. Until you create it, GitHub uses the existing repository secrets, so nothing breaks.

Do **not** reuse the existing `Production` / `Preview` environments: Vercel creates those for its
deployment records, and branch rules or secrets there would mix with Vercel's deployments.

1. GitHub → repository → **Settings → Environments → New environment** → name `production-db`.
2. **Deployment branches and tags** → *Selected branches and tags* → add rule `main`.
3. **Required reviewers**: leave **off**. The backup runs every night and the retention job right
   after it; a required approval would stop them until someone clicks approve.
   (Branch-only access already blocks the risk the report describes: another branch's workflow
   reading the password. Changes to `main` itself go through reviewed pull requests.)
4. **Environment secrets** → add:
   - `SUPABASE_PROD_DB_URL` — Supabase (production) → **Connect → Session pooler** connection
     string, with the database password filled in. If nobody has the password, reset it in
     **Project Settings → Database → Reset database password**; only these GitHub workflows use it.
   - `RETENTION_JOB_SECRET` — the same value as the Edge Function secret of the same name in
     production. If nobody has it, make a new one (`openssl rand -hex 32`), set it in **Supabase →
     Edge Functions → Secrets** (production) *and* here, at the same time.
5. **Settings → Secrets and variables → Actions → Repository secrets** → delete
   `SUPABASE_PROD_DB_URL` and `RETENTION_JOB_SECRET` (the environment copies replace them).
6. **Actions** → run *Encrypted production database backup* and *Database permission check*
   once from `main`. The retention job then starts by itself after the backup. All three should be green.

Later (report step 2, optional): separate read-only database roles for backup and the check.

---

## SEC-65 — the encrypted backups are downloadable while the repository is public

**Why:** backup files (encrypted) are kept as workflow artifacts for 30 days, and anyone can
download artifacts of a public repository. If the decryption key ever leaked, 30 days of member
data would be exposed.

Already done in code: the backup log no longer prints user or member counts.

### Recommended: make the repository private when the CITS review no longer needs it public

GitHub → repository → **Settings → General → Danger Zone → Change repository visibility →
Make private**. Then existing and future backup artifacts are private too.

Check these first:

- **Branch protection:** rules/rulesets on a *private* repository of a personal (free) account
  are not enforced. Either upgrade to **GitHub Pro** (about $4/month; keeps the `main`
  protection) or move the repository to a GitHub organisation for the association.
- **Actions minutes:** private repositories get 2,000 free minutes a month (Pro: 3,000). The
  sheet retry job runs every 15 minutes (≈ 2,900 minutes a month). Before going private, ask
  Claude to change `.github/workflows/sheet-sync-retry.yml` to run every hour (≈ 720 minutes).
- **Reviewers:** add CITS as a collaborator with *Read* access if they still need the code.

### If the repository must stay public

Ask Claude to move the encrypted backup out of GitHub artifacts into private storage owned by
the association (for example a private Google Drive folder or an S3-compatible bucket). That
needs credentials for that storage, set as `production-db` environment secrets.

### Key handling (both cases)

Keep the age **private key** in the association's password manager with at least two board
members having access; never in GitHub. The Privacy Policy update (GDPR-22) should mention that
backups keep data for up to 30 days.
