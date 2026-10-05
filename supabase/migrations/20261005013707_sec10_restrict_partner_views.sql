-- SEC-10: partner operational and demographic views are not public APIs.
-- Keep them available to trusted backend processing only, and make the views
-- respect the caller's privileges if they are deliberately exposed later.

BEGIN;

DO $$
DECLARE
  required_view text;
BEGIN
  FOREACH required_view IN ARRAY ARRAY[
    'partner_operations_view',
    'partner_monthly_insights_view',
    'partner_operations_owner_view',
    'partner_monthly_insights_owner_view'
  ]
  LOOP
    IF to_regclass(format('public.%I', required_view)) IS NULL THEN
      RAISE EXCEPTION 'SEC-10 expected public.% to exist', required_view;
    END IF;
  END LOOP;
END;
$$;

ALTER VIEW public.partner_operations_view
  SET (security_invoker = true);
ALTER VIEW public.partner_monthly_insights_view
  SET (security_invoker = true);
ALTER VIEW public.partner_operations_owner_view
  SET (security_invoker = true);
ALTER VIEW public.partner_monthly_insights_owner_view
  SET (security_invoker = true);

REVOKE ALL ON TABLE
  public.partner_operations_view,
  public.partner_monthly_insights_view,
  public.partner_operations_owner_view,
  public.partner_monthly_insights_owner_view
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.partner_operations_view,
  public.partner_monthly_insights_view,
  public.partner_operations_owner_view,
  public.partner_monthly_insights_owner_view
TO service_role;

COMMIT;
