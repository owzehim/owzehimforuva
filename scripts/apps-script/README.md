# Apps Script webhook secret rotation

The Master sheet uses the `MASTER_APPS_SCRIPT_SECRET` Edge Function secret. Each partner sheet has its own secret in `public.partnership_apps_script_secrets` (SEC-58); there is no shared partner secret any more. Create different random values (at least 32 characters) and configure them in both places below. Never put either value in the app's frontend, source control, or chat.

## Partner script

1. Replace the code in that partner's Apps Script project with `partner-owner.gs`.
2. Set `PARTNERSHIP_ID` to the exact ID from `partnerships.id` for that partner.
3. In that Apps Script project's **Project Settings → Script Properties**, set `PARTNER_APPS_SCRIPT_SECRET` to **that partner's own** `secret` from `partnership_apps_script_secrets` (created automatically when the partnership is added), then set `enabled` to `true` in that table.
4. Deploy a new Web App version. Keep access settings compatible with the existing webhook deployment.
5. Save the deployed Web App URL to `partnership_integrations.partner_apps_script_url` for that partnership.

## Per-partner secrets (SEC-58)

Each partnership has its own secret in `public.partnership_apps_script_secrets` (server only; created automatically for every partnership). To switch a partner from the shared secret to its own:

1. Supabase dashboard → Table Editor → `partnership_apps_script_secrets` → copy that partner's `secret`. Never paste it into chat or the repo.
2. In that partner's Apps Script → **Project Settings → Script Properties**, replace the value of `PARTNER_APPS_SCRIPT_SECRET` with it. The script code does not change.
3. Back in the table, set `enabled` to `true` for that partner.
4. Check with one test check-in that the partner sheet still updates.

While `enabled` is false that partner's sheet receives no requests (check-ins and rewards still work; only its sheet rows are skipped). Give partners view-only access to their sheet (no edit or script access), so they cannot read the Script Properties at all.

## Master script

Update the Master Apps Script authorization guard to read the `__uvain_shared_secret` request field and compare it with the `MASTER_APPS_SCRIPT_SECRET` Script Property. Configure the distinct master secret in that script and deploy a new Web App version. Keep the existing `privacy_anonymize` handler working; account deletion and retention cleanup depend on it.

## Supabase

Set `MASTER_APPS_SCRIPT_SECRET` as an Edge Function secret in each Supabase project that will send sheet requests. The value for each role must exactly match the corresponding Apps Script Script Property. Configure DEV and production independently. Deploy the updated Edge Functions after the repository change is pushed.

Do not restore a sheet endpoint until its corresponding Apps Script has been updated and deployed. When rotating from the old shared secret, update every receiving script first, then replace the Supabase secrets, and retire the old `APPS_SCRIPT_SHARED_SECRET` property/value.

The script does not create or update a `Reviews Summary` tab. It writes each review's star rating, selected tags, and review date to the matching redemption row in `Operations` columns H:M. Reviewer identity and comment are sent to the internal Master sheet only. Existing partner review values are preserved during scan resyncs.
