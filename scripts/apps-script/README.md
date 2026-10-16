# Partner Apps Script update

1. Replace the code in that partner's Apps Script project with `partner-owner.gs`.
2. Set `PARTNERSHIP_ID` to the exact ID from `partnerships.id` for that partner.
3. Keep the existing `APPS_SCRIPT_SHARED_SECRET` in Script Properties; it must match the Supabase Edge Function secret.
4. Deploy a new Web App version. Keep access settings compatible with the existing webhook deployment.
5. Save the deployed Web App URL to `partnership_integrations.partner_apps_script_url` for that partnership. Deploy the updated `sync-to-sheets` Edge Function after the repository change is pushed.

The script does not create or update a `Reviews Summary` tab. It writes each review's star rating, selected tags, and review date to the matching redemption row in `Operations` columns H:M. Reviewer identity and comment are sent to the internal Master sheet only. Existing partner review values are preserved during scan resyncs.
