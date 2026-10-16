# Partner Apps Script update

1. Replace the code in that partner's Apps Script project with `partner-owner.gs`.
2. Set `PARTNERSHIP_ID` to the exact ID from `partnerships.id` for that partner.
3. Keep the existing `APPS_SCRIPT_SHARED_SECRET` in Script Properties; it must match the Supabase Edge Function secret.
4. Deploy a new Web App version. Keep access settings compatible with the existing webhook deployment.
5. Save the deployed Web App URL to `partnership_integrations.partner_apps_script_url` for that partnership. The review-sync Edge Function also needs to be deployed with its repository change.
6. After backing up the existing `Operations` sheet, run `clearLegacyIndividualReviewData` once to erase old per-redemption ratings and tags in columns H:M. This is irreversible from the script; do not run it before preserving anything you need.

The script creates `Reviews Summary` automatically. It accepts only thresholded review summaries; individual `review` webhooks are rejected. No reviewer IDs, redemption IDs, comments, or individual review rows are sent to this sheet.
