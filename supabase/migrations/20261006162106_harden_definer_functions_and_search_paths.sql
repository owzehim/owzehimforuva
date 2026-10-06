-- Scoped Supabase hardening for the reviewed production project.
-- Safe to apply independently; this does not replay the repository migration backlog.

-- Pin resolution for the seven functions flagged by the advisor.
ALTER FUNCTION public.create_review_prompt_on_redemption() SET search_path = '';
ALTER FUNCTION public.birth_year_to_age_group(integer) SET search_path = '';
ALTER FUNCTION public.country_to_region(text) SET search_path = '';
ALTER FUNCTION public.anonymize_expired_members() SET search_path = '';
ALTER FUNCTION public.sync_membership_ended_at() SET search_path = '';
ALTER FUNCTION public.major_to_faculty(text) SET search_path = '';
ALTER FUNCTION public.study_stage(text, integer) SET search_path = '';

-- Device session RPCs require an authenticated app session, never anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.claim_single_device_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_current_device_session() FROM PUBLIC, anon;

-- These SECURITY DEFINER routines are invoked by their attached triggers,
-- not directly through PostgREST RPC.
REVOKE EXECUTE ON FUNCTION public.create_review_prompt_on_redemption() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.keep_ten_restaurant_comments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.keep_ten_restaurant_notes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_restaurant_comment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_restaurant_note() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_member_analytics_profile() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
