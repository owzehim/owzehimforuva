-- Access audit (2026-11-12) and FUNC-12 (CITS report v4).

-- Reviews: members write their own rows directly, so the database limits
-- what they can store, matching the app (4 fixed tag keys, comment <= 200).
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_tags_known,
  DROP CONSTRAINT IF EXISTS reviews_comment_length;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_tags_known CHECK (
    tags IS NULL OR tags <@ ARRAY['GREAT_FOOD', 'FRIENDLY_STAFF', 'NICE_ATMOSPHERE', 'GOOD_VALUE']::text[]
  ),
  ADD CONSTRAINT reviews_comment_length CHECK (
    comment IS NULL OR char_length(comment) <= 200
  );

-- SEC-66 follow-up: members can no longer write comments (privileges revoked
-- in 20261111100000); remove the member write policies that went with them.
DROP POLICY IF EXISTS "Members can insert their own restaurant comments" ON public.restaurant_comments;
DROP POLICY IF EXISTS "Members can update their own restaurant comments" ON public.restaurant_comments;
DROP POLICY IF EXISTS "Members can delete their own restaurant comments" ON public.restaurant_comments;

-- Stamp-card wallpapers: the admin editor uploads with the admin's own
-- session, but the bucket had no write policy, so uploads were refused.
-- Admins only, like the other image buckets (SEC07). The bucket is public for
-- reading and accepts WebP only (SEC-36).
DROP POLICY IF EXISTS "SEC07 admin manage stamp card wallpapers" ON storage.objects;
CREATE POLICY "SEC07 admin manage stamp card wallpapers" ON storage.objects
  FOR ALL TO authenticated
  USING ((bucket_id = 'stamp-card-wallpapers') AND (SELECT public.is_admin()))
  WITH CHECK ((bucket_id = 'stamp-card-wallpapers') AND (SELECT public.is_admin()));

-- FUNC-12: partners whose Sheet address is set but whose Apps Script secret is
-- not switched on. Their Sheet rows fail; the admin page shows a warning.
-- Admins only; returns names, never addresses or secrets.
CREATE OR REPLACE FUNCTION public.admin_partner_sheet_link_issues()
 RETURNS TABLE(partnership_id text, partnership_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT partnership.id, partnership.name
  FROM public.partnerships AS partnership
  JOIN public.partnership_integrations AS integration
    ON integration.partnership_id = partnership.id
  LEFT JOIN public.partnership_apps_script_secrets AS secret
    ON secret.partnership_id = partnership.id
  WHERE public.is_admin()
    AND nullif(btrim(integration.partner_apps_script_url), '') IS NOT NULL
    AND coalesce(secret.enabled, false) IS NOT TRUE
  ORDER BY partnership.name;
$function$;

REVOKE ALL ON FUNCTION public.admin_partner_sheet_link_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_sheet_link_issues() TO authenticated;

-- Sequences: anon and members had USAGE/SELECT/UPDATE on some of them (for
-- example redemptions_id_seq), so they could reset the check-in id counter
-- (setval) and make new check-ins fail. Every table with a sequence is written
-- by the server only (check-ins, logs, Sheet queues), so nobody else needs them.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- New sequences made by migrations no longer get these privileges by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
