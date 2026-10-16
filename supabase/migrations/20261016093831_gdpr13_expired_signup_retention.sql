-- GDPR-13: remove unverified Auth signups after seven days and verified
-- signups without a member record after the published 12-month period.
-- Keep this server-only and exclude every account that already has app data,
-- an admin role, or the explicit admin/test login exemption.

BEGIN;

CREATE OR REPLACE FUNCTION public.find_expired_signup_auth_users(
  p_batch_size integer DEFAULT 100
)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT users.id
  FROM auth.users AS users
  WHERE (
      (users.email_confirmed_at IS NULL AND users.created_at < now() - interval '7 days')
      OR (users.email_confirmed_at IS NOT NULL AND users.created_at < now() - interval '12 months')
    )
    AND coalesce(users.raw_user_meta_data ->> 'is_test_account', 'false') <> 'true'
    AND coalesce(users.raw_app_meta_data ->> 'is_test_account', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1 FROM public.members AS member WHERE member.user_id = users.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role WHERE admin_role.user_id = users.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt WHERE exempt.user_id = users.id
    )
  ORDER BY users.created_at, users.id
  LIMIT greatest(1, least(coalesce(p_batch_size, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.find_expired_signup_auth_users(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_expired_signup_auth_users(integer)
  TO service_role;

-- Remove abandoned email-change mappings only after at least one Auth account
-- has been deleted. This prevents stale mappings from retaining email/ID data.
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_pending_email_changes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.pending_email_changes AS changes
  WHERE changes.state = 'pending'
    AND (
      NOT EXISTS (SELECT 1 FROM auth.users AS old_user WHERE old_user.id = changes.old_user_id)
      OR NOT EXISTS (SELECT 1 FROM auth.users AS new_user WHERE new_user.id = changes.new_user_id)
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_orphaned_pending_email_changes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_pending_email_changes()
  TO service_role;

COMMIT;
