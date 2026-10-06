# Production database baseline — 2026-10-06

Project: `npvcghdzrtqrlliprtnw` (production / main)  
Repository base inspected: `0877069` (`fix-single-device-login-session`)  
Scope: `public` and `storage` schemas; schema only, no table data.

## Baseline artifacts

- A production schema-only dump was captured at 16:03 CEST on 2026-10-06, before the Step 4 migration below. The dump has since been removed from the repository because publishing internal schema details is unnecessary; this file records the review and migration ledger instead.
- [`../migrations/20261006142424_restrict_comment_note_reads_and_translation_quota.sql`](../migrations/20261006142424_restrict_comment_note_reads_and_translation_quota.sql) is the exact follow-up migration applied to production and recorded in the remote migration ledger; it was included in the reviewed baseline after Step 4.
- The current production view definitions were read directly after that migration. The two comment/note safe views still require `app_access=true` and a current device session; they mask anonymous usernames and private note fields as designed.

The CLI could not refresh the dump from this shell because its Supabase access token is not configured here. The exact applied migration, live migration ledger, and view definitions were independently rechecked through the connected Supabase project.

## Migration ledger comparison

Production currently records 18 migration versions. The repository has 41 SQL migration files, but only three versions match the production ledger exactly: `20260629183000`, `20260629190000`, and `20261006142424`.

The complete production ledger at review time was:

| Version | Name |
| --- | --- |
| `20260629183000` | `review_prompt_delay_30_minutes` |
| `20260629190000` | `add_member_test_account_flag` |
| `20261005014104` | `sec09_restrict_anonymization_rpc_access` |
| `20261005014150` | `sec10_restrict_partner_views` |
| `20261005015238` | `sec08_private_partnership_integrations` |
| `20261005015533` | `sec14_atomic_stamp_writes` |
| `20261005020027` | `sec21_sec29_review_privacy` |
| `20261005025617` | `sec35_username_rules` |
| `20261005031734` | `sec34_admin_report_queue` |
| `20261005031809` | `sec34_admin_report_queue_v2` |
| `20261005032629` | `gdpr10_suppress_small_partner_groups` |
| `20261006010627` | `sec15_pending_email_rate_limit` |
| `20261006010632` | `gdpr08_store_consent_receipts` |
| `20261006010636` | `sec35_hold_unverified_student_numbers` |
| `20261006010641` | `sec15_finalize_pending_email_after_confirmation` |
| `20261006011058` | `enforce_password_email_otp_login` |
| `20261006125111` | `allow_test_exempt_account_session` |
| `20261006142424` | `restrict_comment_note_reads_and_translation_quota` |

These 15 production versions have no exact-version file in the repository:

| Production version | Production name | Similar local filename (timestamp differs; equivalence not proven) |
| --- | --- | --- |
| `20261005014104` | `sec09_restrict_anonymization_rpc_access` | `20261005013546_sec09_restrict_anonymization_rpc_access.sql` |
| `20261005014150` | `sec10_restrict_partner_views` | `20261005013707_sec10_restrict_partner_views.sql` |
| `20261005015238` | `sec08_private_partnership_integrations` | `20261005013148_sec08_private_partnership_integrations.sql` |
| `20261005015533` | `sec14_atomic_stamp_writes` | `20261005020000_sec14_atomic_stamp_writes.sql` |
| `20261005020027` | `sec21_sec29_review_privacy` | `20261005022000_sec21_sec29_review_privacy.sql` |
| `20261005025617` | `sec35_username_rules` | `20261005090000_sec35_username_rules.sql` |
| `20261005031734` | `sec34_admin_report_queue` | `20261005095000_sec34_admin_report_queue.sql` |
| `20261005031809` | `sec34_admin_report_queue_v2` | No matching filename found |
| `20261005032629` | `gdpr10_suppress_small_partner_groups` | `20261005100000_gdpr10_suppress_small_partner_groups.sql` |
| `20261006010627` | `sec15_pending_email_rate_limit` | `20261005070000_sec15_pending_email_rate_limit.sql` |
| `20261006010632` | `gdpr08_store_consent_receipts` | `20261005071621_gdpr08_store_consent_receipts.sql` |
| `20261006010636` | `sec35_hold_unverified_student_numbers` | `20261005072138_sec35_hold_unverified_student_numbers.sql` |
| `20261006010641` | `sec15_finalize_pending_email_after_confirmation` | `20261005092214_sec15_finalize_pending_email_after_confirmation.sql` |
| `20261006011058` | `enforce_password_email_otp_login` | `20261006000949_enforce_password_email_otp_login.sql` |
| `20261006125111` | `allow_test_exempt_account_session` | `20261006122323_allow_test_exempt_account_session.sql` |

The remaining local migration versions are not present in the production ledger. A filename or purpose match does not prove SQL equivalence, and a missing ledger version does not establish that its schema effect is absent. In fact, earlier live-schema checks found expected objects from some local migrations missing in production. The local files therefore cannot safely be marked applied as a group.

## Review decision

This establishes a reviewed, versioned production schema baseline for rebuilding migrations. The historical migration ledger itself remains different from GitHub. The exact source for the 15 production-only migration versions was not available in the repository or inspected backup branches, so the ledger was left untouched. No `db push`, migration repair, or production schema change was run as part of this baseline work.

Before any future migration push, rebuild the migration history from this baseline in a separate development branch, review the generated SQL against production, and test it there. Do not push the current repository migration backlog directly to production.
