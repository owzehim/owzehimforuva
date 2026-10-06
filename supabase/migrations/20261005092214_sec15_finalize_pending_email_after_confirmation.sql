-- Preserve the existing unconfirmed account until the replacement address is
-- confirmed. The mapping is private to service-role Edge Functions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pending_email_changes (
  new_user_id uuid PRIMARY KEY,
  old_user_id uuid NOT NULL,
  new_email text NOT NULL,
  original_created_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'transferred')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (old_user_id)
);

ALTER TABLE public.pending_email_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pending_email_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pending_email_changes TO service_role;

CREATE OR REPLACE FUNCTION public.complete_pending_email_change(
  p_new_user_id uuid,
  p_confirmed_email text
)
RETURNS TABLE(old_user_id uuid, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  pending public.pending_email_changes%ROWTYPE;
BEGIN
  SELECT * INTO pending
  FROM public.pending_email_changes AS changes
  WHERE changes.new_user_id = p_new_user_id
    AND lower(changes.new_email) = lower(btrim(p_confirmed_email))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF pending.state = 'pending' THEN
    UPDATE public.members
    SET user_id = pending.new_user_id
    WHERE user_id = pending.old_user_id;

    UPDATE public.pending_email_changes
    SET state = 'transferred'
    WHERE new_user_id = pending.new_user_id;
    pending.state := 'transferred';
  END IF;

  RETURN QUERY SELECT pending.old_user_id, pending.state;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_pending_email_change(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_email_change(uuid, text)
  TO service_role;

-- A pending email replacement needs to carry the original Auth signup time
-- through to consent-receipt creation without trusting editable user metadata.
DROP FUNCTION IF EXISTS public.find_pending_auth_user_by_email(text);
CREATE FUNCTION public.find_pending_auth_user_by_email(p_email text)
RETURNS TABLE(user_id uuid, user_metadata jsonb, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT users.id, users.raw_user_meta_data, users.created_at
  FROM auth.users AS users
  WHERE lower(users.email) = lower(btrim(p_email))
    AND users.email_confirmed_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_pending_auth_user_by_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_pending_auth_user_by_email(text)
  TO service_role;

COMMIT;
