-- SEC-20 follow-up: harden helper function search paths and remove direct
-- PostgREST execution from trigger-only and retired translation helpers.
-- Existing service-role grants on trigger helpers are retained for compatibility.

BEGIN;

DO $$
DECLARE
  required_function text;
BEGIN
  FOREACH required_function IN ARRAY ARRAY[
    'public.country_to_region(text)',
    'public.major_to_faculty(text)',
    'public.birth_year_to_age_group(integer)',
    'public.study_stage(text,integer)',
    'public.create_review_prompt_on_redemption()',
    'public.sync_membership_ended_at()',
    'public.anonymize_expired_members()',
    'public.sync_member_analytics_profile()',
    'public.prepare_restaurant_comment()',
    'public.keep_ten_restaurant_comments()',
    'public.prepare_restaurant_note()',
    'public.keep_ten_restaurant_notes()',
    'public.reserve_translation_characters(integer)',
    'public.rls_auto_enable()'
  ]
  LOOP
    IF to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'SEC-20 expected function % to exist', required_function;
    END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION public.country_to_region(text)
  SET search_path = pg_catalog;
ALTER FUNCTION public.major_to_faculty(text)
  SET search_path = pg_catalog;
ALTER FUNCTION public.birth_year_to_age_group(integer)
  SET search_path = pg_catalog;
ALTER FUNCTION public.study_stage(text, integer)
  SET search_path = pg_catalog;
ALTER FUNCTION public.create_review_prompt_on_redemption()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.sync_membership_ended_at()
  SET search_path = pg_catalog;
ALTER FUNCTION public.anonymize_expired_members()
  SET search_path = pg_catalog;
ALTER FUNCTION public.sync_member_analytics_profile()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prepare_restaurant_comment()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.keep_ten_restaurant_comments()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prepare_restaurant_note()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.keep_ten_restaurant_notes()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.reserve_translation_characters(integer)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.rls_auto_enable()
  SET search_path = pg_catalog;

-- These helpers are only called by database triggers or an internal event
-- trigger. Translation reservation has no live caller after translate-* was
-- removed. Preserve service-role use for the pure analytics mapping helpers,
-- which are used by the partner insights view.
REVOKE ALL ON FUNCTION public.country_to_region(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.major_to_faculty(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.birth_year_to_age_group(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.study_stage(text, integer)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_review_prompt_on_redemption()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_membership_ended_at()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_member_analytics_profile()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_restaurant_comment()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.keep_ten_restaurant_comments()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_restaurant_note()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.keep_ten_restaurant_notes()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_translation_characters(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anonymize_expired_members()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
