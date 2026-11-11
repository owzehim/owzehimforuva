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

## SEC-64 — production secrets only for the `main` branch

**Why:** today any branch's workflow can read `SUPABASE_PROD_DB_URL` (full database access) and
`RETENTION_JOB_SECRET`. After these steps only workflows running on `main` can.

Four workflows use the environment `production-db`: *Encrypted production database backup*,
*Database permission check*, *Daily privacy retention* and *Sheet sync retry*.
Scheduled jobs always run the version on `main`, so steps A–C can be done any time, but step D
(deleting the repository secrets) only **after this change is on `main`** (the next production
release). Before that, `main` still reads the repository secrets.
Leave the existing `Production` / `Preview` environments alone: Vercel uses them.

### A. Create the environment

1. GitHub → repository → **Settings → Environments → New environment**.
2. Name: `production-db` → **Configure environment**.
3. **Required reviewers**: leave unticked. **Wait timer**: leave unticked.
4. **Deployment branches and tags**: change *No restriction* to **Selected branches and tags** →
   **Add deployment branch or tag rule** →
   - **Ref type: Branch**
   - **Name pattern: `main`**
   - **Add rule**.

### B. Secret 1 — `SUPABASE_PROD_DB_URL`

GitHub never shows stored secret values, so you enter it again.

1. Supabase → project **UvA-IN app** (`npvcghdzrtqrlliprtnw`) → **Connect** (top bar) →
   **Connection String** tab → **Type: URI**, **Method: Session pooler** → copy the string. It looks like:
   `postgresql://postgres.npvcghdzrtqrlliprtnw:[YOUR-PASSWORD]@aws-…-eu-west-1.pooler.supabase.com:5432/postgres`
   Copy the host exactly as Supabase shows it (`aws-0-…` or `aws-1-…`), and keep port **5432**
   (session pooler; 6543 is the transaction pooler and does not work for backups).
2. Replace `[YOUR-PASSWORD]` (including the brackets) with the database password.
   - Don't know it? **Project Settings → Database → Reset database password** → set a new one.
     Only these GitHub workflows use it; the app and Edge Functions do not.
   - If the password has special characters (`@ : / ? # % &`), either pick a password of only
     letters and digits, or URL-encode those characters (for example `@` → `%40`).
3. GitHub → **Settings → Environments → production-db → Environment secrets → Add environment secret**
   → Name `SUPABASE_PROD_DB_URL` → Value: the full string from step 2 → **Add secret**.

### C. Secret 2 — `RETENTION_JOB_SECRET`

This must be the **same value** in two places: the Supabase Edge Function secret (production) and
GitHub. Neither shows the old value, so make a new one and set it in both, a few minutes apart at most.

1. Make a random value of 64 letters/digits, for example:
   - Terminal: `openssl rand -hex 32`
   - or a password manager's generator: length 64, letters and digits only (no symbols).
   Keep it only in your password manager.
2. Supabase → project **UvA-IN app** → **Edge Functions → Secrets** → find `RETENTION_JOB_SECRET`
   → edit (or add a secret with the same name, which replaces it) → paste the new value → **Save**.
3. GitHub → **Settings → Environments → production-db → Add environment secret** →
   Name `RETENTION_JOB_SECRET` → the same value → **Add secret**.
   (Between steps 2 and 3, a sheet-retry run may fail and open an alert issue; close it afterwards.)
4. Do **not** touch `DEV_RETENTION_JOB_SECRET` (the DEV job keeps using it).

### D. Remove the old repository copies (only after the change is on `main`)

**Settings → Secrets and variables → Actions → Repository secrets** → delete
`SUPABASE_PROD_DB_URL` and `RETENTION_JOB_SECRET`. Keep `SUPABASE_ACCESS_TOKEN`,
`DEV_RETENTION_JOB_SECRET` and the others.

### E. Check

**Actions** tab, run each from branch `main` (**Run workflow**):

1. *Encrypted production database backup* → green. *Daily privacy retention* then starts by itself → green.
2. *Database permission check* → green.
3. *Sheet sync retry* → green.

If one fails with "Set … in GitHub Actions secrets", that secret is missing from `production-db`.

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
