# Archived migrations — do not apply

The Supabase CLI only reads `supabase/migrations/`. Files in this folder are kept
for history only and must **never** be applied to production or DEV, by
`supabase db push`, the SQL Editor, or an AI tool (CITS report v3.0, OPS-08).

Archived 2026-11-05 after checking both migration ledgers.

## Dangerous: would break the app if applied

None of these is recorded in the production or DEV ledger, and neither database has any `aal2` rule
(report v2.0 appendix B, check 12).

| File | Why it must not run |
|---|---|
| `20261005030000_sec12_require_aal2.sql` | Adds AAL2 (TOTP two-factor) restrictive policies to every RLS table and Storage. Email-OTP logins are AAL1, so every user — admins included — would lose all data access. Nothing later removes these policies. |
| `20261005080000_sec25_server_enforced_single_device.sql` | `claim_single_device_session` requires `aal2`; every member would be signed out right after login. The current function was applied without this condition. |
| `20261005081000_sec18_anonymous_author_views.sql` | Safe comment/note views that require `aal2`; lists would appear empty. Superseded by the live views. |
| `20261005110000_sec18_safe_views_require_active_session.sql` | Same `aal2` view condition. Superseded. |
| `20261011110000_google_aggregate_reporting_only.sql` | Deletes the Master Sheet address from `partnership_integrations`; account deletion and the retention job then queue every Sheet step until it is restored (FUNC-01). Production recorded it as `20261011123747`; archived 2026-11-10 so `db push` can never run it under the old version. |
| `20261005130000_sec20_explicit_api_grants.sql` | Stops itself on a self-check; if "fixed" and applied, lines 123–130 revoke EXECUTE on all public functions, which breaks member profile saves (`is_valid_member_username`). API grants are now handled by later migrations (e.g. `20261105160000`). |

## Duplicates: same SQL, applied to DEV under another timestamp

Each pair has identical content. The copy kept in `supabase/migrations/` is the version recorded
in the **production** ledger; the archived copy is the one DEV recorded (or, for `20261013234422`,
neither database).

| Archived (DEV / unused) | Kept (production ledger) |
|---|---|
| `20261013234422_gdpr12_expired_member_retention.sql` (neither) | `20261014003634_gdpr12_expired_member_retention.sql` |
| `20261015023955_func03_lock_card_size_after_progress.sql` (DEV) | `20261015024325_…` |
| `20261015024505_func03_keep_non_size_config_edits.sql` (DEV) | `20261015024558_…` |
| `20261015025146_func06_allow_foundation_education.sql` (DEV) | `20261015025244_…` |
| `20261016093831_gdpr13_expired_signup_retention.sql` (DEV) | `20261016092602_…` |

## Rule going forward

One change = one migration file, applied first to DEV and then to production **under the same
version** (file + ledger row in one transaction), never a second copy with a new timestamp.
See "Database changes and deployment" in the repository README.

## Duplicate kept for history (archived 2026-11-11, CITS report v4 OPS-08)

`20261015023458_func03_fix_stamp_card_cycle_ambiguity.sql` has the same SQL as
`20261014004646_fix_stamp_card_cycle_ambiguity.sql` (still in `supabase/migrations/`). Production's
ledger records it as `20261014004646`, DEV's as `20261015023458`; both databases have the change.
