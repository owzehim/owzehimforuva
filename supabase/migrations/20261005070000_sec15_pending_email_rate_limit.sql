-- SEC-15: make pending-email changes rate limited and provide a narrow,
-- service-role-only lookup instead of paging through auth.users via listUsers.

BEGIN;

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  key_hash text PRIMARY KEY CHECK (length(key_hash) = 64),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edge_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.edge_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_edge_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RETURN false;
  END IF;

  INSERT INTO public.edge_rate_limits(key_hash, window_started_at, request_count, updated_at)
  VALUES (p_key_hash, now(), 1, now())
  ON CONFLICT (key_hash) DO UPDATE
  SET window_started_at = CASE
        WHEN public.edge_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= now() THEN now()
        ELSE public.edge_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN public.edge_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= now() THEN 1
        ELSE public.edge_rate_limits.request_count + 1
      END,
      updated_at = now()
  RETURNING request_count <= p_limit INTO allowed;

  DELETE FROM public.edge_rate_limits
  WHERE updated_at < now() - interval '1 day';

  RETURN allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_pending_auth_user_by_email(p_email text)
RETURNS TABLE(user_id uuid, user_metadata jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT users.id, users.raw_user_meta_data
  FROM auth.users AS users
  WHERE lower(users.email) = lower(btrim(p_email))
    AND users.email_confirmed_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.consume_edge_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_edge_rate_limit(text, integer, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.find_pending_auth_user_by_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_pending_auth_user_by_email(text)
  TO service_role;

COMMIT;
