# Production database baseline — 2026-11-05

Project: `npvcghdzrtqrlliprtnw` (production / main)
Repository base: `main` @ `09b317f` (CITS report v3.0 baseline)
Method: read-only `select` queries via `supabase db query --linked` (Management API), the 12 checks of
report v2.0 appendix B plus the OPS-08 check SQL, and `supabase functions download` diffed against `main`.
A full backup (roles, schema, data, migration ledger, Storage files) was taken first and restore-tested;
it is kept **outside** the repository because it contains personal data.

Supersedes `production-main-20261006.md`.

## Summary

| Area | Result |
|---|---|
| Migration ledger | 75 versions in production; only 13 match a repo file exactly. 59 match a repo file by name under a different timestamp, 3 have no repo file. 25 repo files have no ledger entry by version or name. |
| Actual schema | Spot checks show the fixes are applied even where the ledger and filenames disagree (e.g. FUNC-03 `#variable_conflict` fix, `restaurants.is_archived`, SEC-28 trigger, OPS-11 audit). The drift is mainly in **bookkeeping**, not in missing fixes. |
| Dangerous migrations | Not applied: no `aal2` in any policy/function/view (B12); `20261005030000`, `20261005130000`, `20261011110000` absent from ledger. |
| Edge Functions | 20 deployed. 19 identical to `main`; `export-aggregate-report` differs only by a trailing newline. **5 functions bundle a pre-`8e575f8` (2026-10-30) `_shared/requireVerifiedLogin.ts`** (see below). |
| SEC-55 / SEC-56 | Found live; **fixed the same day** by `20261105160000` (see "Changes applied after this check"). |

## Appendix B checks (report v2.0)

| # | Check | Result | Status |
|---|---|---|---|
| 1 | OTP exemptions (SEC-37) | 1 row, `reason = test`, `has_admin_role = false`. No admin exemptions. | OK — remove/rotate test account before launch (SEC-63) |
| 2 | Admin audit (OPS-11) | `admin_action_audit` exists, 9 `audit_admin_changes` triggers | OK |
| 3 | Retention queue (GDPR-06) | Table + all 3 RPCs exist; queue empty | OK |
| 4 | Server `created_at` (SEC-28) | `a_force_server_created_at` on `restaurant_comments` and `restaurant_notes` | OK |
| 5 | Raw comment/note SELECT policies (SEC-18/29) | Only "own" + admin-moderation policies; no `USING (true)` | OK |
| 6 | anon/authenticated table grants (SEC-20) | anon: `restaurants` SELECT only. Safe views SELECT only. Server-only tables not listed. Several tables still have broad `authenticated` DELETE/INSERT/UPDATE (RLS restricts them) | OK — cleanup target |
| 7 | Default privileges (SEC-20/45) | `postgres`/`public` rows have no anon/authenticated; global `f` row is `postgres=X` only | OK |
| 8 | `members` UPDATE columns (SEC-03/25) | `profile_image_url, tutorial_completed_at, username` | OK |
| 9 | Buckets (SEC-07/54) | `profile-images` private, 5 MB, `image/jpeg`. `public-assets` public with no size/type limit | OK — consider limits on `public-assets` |
| 10 | Realtime | `stamp_card_rewards`, `stamp_card_visits` only | OK |
| 11 | Sheets hosts (FUNC-01/SEC-08/48) | 2 partnerships, master + partner hosts both `script.google.com`; 0 old URL copies | OK — deletion works **today** but stays fragile (FUNC-01) |
| 12 | Leftover AAL2 | 0 rows | OK |
| — | RLS | Enabled on every `public` table | OK |
| — | OPS-08 #5 grants | a–d `false`, e `true` | OK |

## Changes applied after this check

| When (2026-11-05) | Version | Where | How | Verified |
|---|---|---|---|---|
| after frontend `bd775e2` (main) / `7cfcab8` (dev) was live | `20261105160000_sec55_sec56_note_author_integrity` | DEV, then production | That single file run in one transaction with its ledger row (same version); **not** `db push` | Members' UPDATE limited to `body, is_anonymous, hidden_at`; trigger on every INSERT/UPDATE; `refresh_member_note_authors` on members; policy `SEC56 read visible note author avatars` replaces `SEC52 …`; a rolled-back "rename author to 운영진" attempt was denied and a normal body edit kept the author. All 8 production notes kept the same author, anonymity and photo path (no forged data existed). |

| after frontend `e6dd993` (main) / `816f4cd` (dev) was live | `20261105180000_func01_func08_database_first_privacy_sync` | DEV, then production | Same single-file + ledger-row method | `finish_privacy_retention_database(uuid)` exists, EXECUTE only for service_role; ledger row present; Master Sheet link unchanged (1 URL); queue empty. |

| after the member-write audit (no frontend change needed) | `20261105200000_restrict_note_insert_columns` | DEV, then production | Same single-file + ledger-row method | Members' INSERT on `restaurant_notes` limited to `body, is_anonymous, restaurant_id, source_rating, source_redemption_id, source_review_id, source_store_id, source_tags, user_id, username` (no `hidden_at`, `id`, timestamps, photo path or avatar seed); UPDATE unchanged (`body, hidden_at, is_anonymous`); table-level only SELECT, DELETE; ledger row present. |

Edge Functions deployed the same day (DEV from `dev`, then production from `main`; `verify_jwt`
unchanged; downloaded code identical to the branch):

| Function | Production version | Change |
|---|---|---|
| manage-legal-consent | v3 | Legal version 2026-11-05-01 |
| complete-member-registration | v23 | Legal version 2026-11-05-01 |
| redeem-stamp-card-reward | v18 | FUNC-09, GDPR-20 |
| password-reset-return-signal | v6 | SEC-61 (rate limit, email-link session for `complete`) |
| send-content-report-notice | v5 | SEC-62; also brings it up to date with `_shared/requireVerifiedLogin.ts` |
| delete-my-account | v23 | FUNC-01 |
| privacy-retention-sync | v36 | FUNC-08 |

Smoke tests on production: reset signal `check` → 200, `complete` with a password-login token → 401,
consent status without login → 401. Live app bundle uses version 2026-11-05-01 and the server's
`requiredVersion`. Still on the pre-`8e575f8` shared login check: `admin-add-stamp`,
`admin-create-member`, `admin-update-member`, `sync-to-sheets`.

Fresh pre-change backups were taken just before each production apply (kept outside the repository).
The SEC-55 and SEC-56 sections below describe the state **before** this change.

## Open findings confirmed in production

### SEC-55 — note author fields writable by members (Medium, live)
- `prepare_restaurant_note` fires only `BEFORE INSERT OR UPDATE OF body, is_anonymous`.
- `authenticated` has **table-level UPDATE** on `restaurant_notes` (all columns incl. `username`,
  `restaurant_id`, `profile_image_url`, `avatar_color_seed`, `source_*`).
- Policy "Members can update their own restaurant notes" (`user_id = auth.uid()`).

### SEC-56 — avatar read policy trusts a writable path (Medium, live)
- Storage policy "SEC52 allow visible note author avatars": allows reading any `profile-images` object
  whose name equals a visible note's `profile_image_url` — which members can set via SEC-55.

### Edge Function drift — stale shared login check (Low)
`admin-add-stamp`, `admin-create-member`, `admin-update-member`, `send-content-report-notice`,
`sync-to-sheets` were last deployed before `8e575f8`. Their bundled `requireVerifiedLogin` lacks the
explicit `claims.app_access === true` check and the test-account exemption. Practical risk is low
(the device-session match only succeeds for sessions claimed through `claim_single_device_session`,
which itself requires `app_access`), but they should be redeployed from `main`.
`delete-my-account`, `log-redemption`, `redeem-stamp-card-reward` already carry the current version.

### Deployed Edge Functions (2026-11-05)

| Function | Version | verify_jwt |
|---|---|---|
| log-redemption | 81 | true |
| privacy-retention-sync | 35 | **false** (secret header) |
| sync-to-sheets | 36 | true |
| admin-add-stamp | 25 | true |
| sync-review-to-sheets | 24 | true (retired, 410) |
| complete-member-registration | 22 | true |
| delete-my-account | 22 | true |
| change-pending-email | 21 | **false** (password check) |
| redeem-stamp-card-reward | 17 | true |
| complete-login | 15 | true |
| finalize-pending-email | 15 | true |
| verify-member-qr | 14 | true (unused, OPS-14) |
| admin-update-member | 11 | true |
| export-aggregate-report | 8 | true (retired, 410) |
| admin-create-member | 5 | true |
| moderate-comment | 5 | true (retired, 410) |
| password-reset-return-signal | 5 | **false** (SEC-61) |
| send-content-report-notice | 4 | true |
| manage-legal-consent | 2 | true |
| email-confirmation-return-signal | 1 | **false** (SEC-61) |

`translate-comment` / `translate-note` exist in the repo but are not deployed (OPS-14: delete from repo).

## Not checked (dashboard only)

Auth Hooks (`custom_access_token_hook`), Secure password change, legacy API keys disabled (SEC-05),
Site URL / redirect allow-list (OPS-12), Edge Function secrets.

## Rules (unchanged)

- **Never** run `supabase db push` or `supabase migration repair` against production with the current
  migrations folder: 89 repo files are not in the ledger by version, including `20261005030000`
  (AAL2 lockout) and `20261005130000` (revokes function EXECUTE).
- Change production only through new migration files, tested on the DEV project first; deploy
  migrations before the functions/screens that use them (OPS-16).
- Long term: squash the current production schema into one baseline migration and archive the old files.

## Repository cleanup (2026-11-05, OPS-08 rec. 3–4, OPS-02)

- Moved to `supabase/migrations_archive/` (not read by the CLI; neither ledger records them):
  the AAL2 / grant-revoking files `20261005030000`, `20261005080000`, `20261005081000`,
  `20261005110000`, `20261005130000`, and the DEV copies of five identical duplicate pairs
  (`20261013234422`, `20261015023955`, `20261015024505`, `20261015025146`, `20261016093831`).
  Each kept duplicate is the version in the production ledger.
- `supabase/migrations/` now holds 94 files; the remaining name/version differences against the
  production ledger are listed above. Policy: the production ledger wins; new changes are applied
  as one file under one version to DEV and production (README "Database changes and deployment").
- Daily encrypted backup workflow added (README "Backups"); format restore-tested locally.

## Migration ledger (production) vs repository

Unmatched repo files (no ledger entry by version or name): see the list at the end.

| Production version | Name | Repo |
|---|---|---|
| `20260629183000` | `review_prompt_delay_30_minutes` | exact |
| `20260629190000` | `add_member_test_account_flag` | exact |
| `20261005014104` | `sec09_restrict_anonymization_rpc_access` | same name, other version: `20261005013546` |
| `20261005014150` | `sec10_restrict_partner_views` | same name, other version: `20261005013707` |
| `20261005015238` | `sec08_private_partnership_integrations` | same name, other version: `20261005013148` |
| `20261005015533` | `sec14_atomic_stamp_writes` | same name, other version: `20261005020000` |
| `20261005020027` | `sec21_sec29_review_privacy` | same name, other version: `20261005022000` |
| `20261005025617` | `sec35_username_rules` | same name, other version: `20261005090000` |
| `20261005031734` | `sec34_admin_report_queue` | same name, other version: `20261005095000` |
| `20261005031809` | `sec34_admin_report_queue_v2` | no repo file |
| `20261005032629` | `gdpr10_suppress_small_partner_groups` | same name, other version: `20261005100000` |
| `20261006010627` | `sec15_pending_email_rate_limit` | same name, other version: `20261005070000` |
| `20261006010632` | `gdpr08_store_consent_receipts` | same name, other version: `20261005071621` |
| `20261006010636` | `sec35_hold_unverified_student_numbers` | same name, other version: `20261005072138` |
| `20261006010641` | `sec15_finalize_pending_email_after_confirmation` | same name, other version: `20261005092214` |
| `20261006011058` | `enforce_password_email_otp_login` | same name, other version: `20261006000949` |
| `20261006125111` | `allow_test_exempt_account_session` | same name, other version: `20261006122323` |
| `20261006142424` | `restrict_comment_note_reads_and_translation_quota` | exact |
| `20261006162106` | `harden_definer_functions_and_search_paths` | exact |
| `20261006174543` | `sec20_revoke_public_and_unsafe_grants` | same name, other version: `20261006174320` |
| `20261006181735` | `remove_comment_translation_feature` | same name, other version: `20261006183000` |
| `20261007100931` | `link_review_notes_idempotently` | same name, other version: `20261007095023` |
| `20261007100944` | `anonymize_notes_when_username_removed` | same name, other version: `20261007100529` |
| `20261007104941` | `gdpr06_durable_sheet_sync` | same name, other version: `20261005045655` |
| `20261007231558` | `sec28_force_server_created_timestamps` | no repo file |
| `20261008005706` | `use_email_otp_for_admin_access` | same name, other version: `20261008004352` |
| `20261008020320` | `sec34_admin_content_review_access` | same name, other version: `20261008015951` |
| `20261008020515` | `sec34_require_active_session_for_moderation` | same name, other version: `20261008020349` |
| `20261008103158` | `ops05_admin_action_audit` | same name, other version: `20261005081830` |
| `20261009234223` | `restrict_stamp_card_reads_to_active_members` | same name, other version: `20261010090000` |
| `20261011123747` | `google_aggregate_reporting_only` | same name, other version: `20261011110000` |
| `20261011131817` | `admin_scan_member_audit_views` | same name, other version: `20261011131723` |
| `20261011132341` | `admin_private_scan_member_audit` | same name, other version: `20261011131908` |
| `20261011133828` | `add_pseudonymous_sheet_member_refs` | no repo file |
| `20261011134428` | `retire_google_aggregate_reporting` | same name, other version: `20261011150000` |
| `20261014003003` | `restore_stamp_card_realtime` | exact |
| `20261014003634` | `gdpr12_expired_member_retention` | exact |
| `20261014004646` | `fix_stamp_card_cycle_ambiguity` | exact |
| `20261015024325` | `func03_lock_card_size_after_progress` | exact |
| `20261015024558` | `func03_keep_non_size_config_edits` | exact |
| `20261015025244` | `func06_allow_foundation_education` | exact |
| `20261016011448` | `separate_member_and_partner_review_summaries` | same name, other version: `20261016090000` |
| `20261016092602` | `gdpr13_expired_signup_retention` | exact |
| `20261022172726` | `gdpr12_delete_expired_auth_and_images` | exact |
| `20261023072540` | `restrict_storage_uploads` | same name, other version: `20261023071604` |
| `20261023170844` | `sec40_hide_real_name_color_seed` | same name, other version: `20261023170251` |
| `20261023172656` | `sec41_daily_note_abuse_protection` | same name, other version: `20261023172429` |
| `20261023182741` | `sec42_daily_review_checkin_limit` | same name, other version: `20261023172902` |
| `20261023184842` | `sec44_protect_report_metadata` | same name, other version: `20261023205000` |
| `20261023185240` | `sec44_revoke_public_report_insert` | same name, other version: `20261023210000` |
| `20261023194239` | `sec45_revoke_public_default_function_execute` | same name, other version: `20261023192842` |
| `20261023194246` | `sec46_harden_member_usernames` | same name, other version: `20261023193049` |
| `20261023194254` | `admin_check_badge_on_authors` | same name, other version: `20261023193837` |
| `20261023203631` | `sec52_store_profile_image_paths` | same name, other version: `20261023203045` |
| `20261023233606` | `password_reset_app_return_signal` | same name, other version: `20261023232812` |
| `20261024190641` | `leg04_notice_action_reporting` | same name, other version: `20261024010817` |
| `20261024190649` | `leg04_optional_report_explanation` | same name, other version: `20261024020000` |
| `20261024190652` | `leg04_no_min_decision_reason` | same name, other version: `20261024030000` |
| `20261024190721` | `report_author_display_snapshot` | same name, other version: `20261024175106` |
| `20261024190814` | `report_processing_confirmation_toggle` | same name, other version: `20261024183725` |
| `20261024190853` | `remove_report_decision_reason` | same name, other version: `20261024184812` |
| `20261024192237` | `allow_public_note_author_avatars` | same name, other version: `20261024191758` |
| `20261025145630` | `report_content_deleted_decision` | same name, other version: `20261024175048` |
| `20261025145657` | `leg06_partner_archiving_and_reward_retention` | same name, other version: `20261024214914` |
| `20261025145704` | `perf_10_query_indexes` | same name, other version: `20261024221933` |
| `20261025145713` | `leg_07_public_live_review_summaries` | same name, other version: `20261025131058` |
| `20261025170719` | `sec17_drop_retired_note_translation_cache` | exact |
| `20261025172007` | `sec17_drop_retired_translation_quota` | same name, other version: `20261025174000` |
| `20261025175233` | `gdpr05_public_username_avatar_seed` | same name, other version: `20261025175200` |
| `20261025175913` | `gdpr09_age_confirmation` | same name, other version: `20261025194000` |
| `20261025195346` | `verified_visit_note_indicator` | same name, other version: `20261025190848` |
| `20261025195408` | `verified_visit_note_by_store_checkin` | same name, other version: `20261025194537` |
| `20261025201125` | `store_commercial_labels` | same name, other version: `20261025201000` |
| `20261025214446` | `optimize_admin_stamp_member_list` | same name, other version: `20261025214118` |
| `20261030105236` | `email_confirmation_app_return_signal` | same name, other version: `20261030103428` |

### Repo files with no ledger entry (by version or name)

- `20260821120000_add_usullang_star_count.sql`
- `20260821121000_add_usullang_star_visibility.sql`
- `20260825120000_add_member_usernames.sql`
- `20260825123000_add_restaurant_comments.sql`
- `20260825124500_add_comment_reports_and_translations.sql`
- `20260831130000_add_good_to_know_notes.sql`
- `20261004220000_use_admin_roles_for_authorization.sql`
- `20261004230000_restrict_public_member_reads.sql`
- `20261004240000_restrict_member_self_updates.sql`
- `20261004250000_restrict_stamp_card_client_writes.sql`
- `20261004260000_restrict_member_inserts_to_server.sql`
- `20261004270000_restrict_storage_bucket_access.sql`
- `20261005030000_sec12_require_aal2.sql`
- `20261005050000_sec20_least_privilege_defaults.sql`
- `20261005060000_sec28_server_created_timestamps.sql`
- `20261005061000_sec33_trust_note_source_fields.sql`
- `20261005074350_sec34_fix_comment_profanity_filter.sql`
- `20261005080000_sec25_server_enforced_single_device.sql`
- `20261005081000_sec18_anonymous_author_views.sql`
- `20261005110000_sec18_safe_views_require_active_session.sql`
- `20261005120000_sec20_harden_helper_functions.sql`
- `20261005130000_sec20_explicit_api_grants.sql`
- `20261006174430_sec18_limit_comment_note_reads_to_owner.sql`
- `20261008015058_sec18_require_active_device_session_for_comments_and_notes.sql`
- `20261015023458_func03_fix_stamp_card_cycle_ambiguity.sql`
