-- Require a password-authenticated session and a separately verified email
-- OTP session before the app grants authenticated API access. The OTP proof is
-- bound to its Supabase Auth session; it cannot be replayed into another one.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_otp_exempt_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('admin', 'test')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.login_otp_verified_sessions (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_otp_verified_sessions_user_session_unique UNIQUE (user_id, session_id)
);

ALTER TABLE public.login_otp_exempt_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_otp_verified_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.login_otp_exempt_users,
  public.login_otp_verified_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.login_otp_exempt_users,
  public.login_otp_verified_sessions FROM supabase_auth_admin, service_role;
GRANT SELECT ON TABLE public.login_otp_exempt_users,
  public.login_otp_verified_sessions TO supabase_auth_admin;
GRANT ALL ON TABLE public.login_otp_exempt_users,
  public.login_otp_verified_sessions TO service_role;

DROP POLICY IF EXISTS "Auth hook reads login OTP grants" ON public.login_otp_exempt_users;
CREATE POLICY "Auth hook reads login OTP grants"
  ON public.login_otp_exempt_users FOR SELECT TO supabase_auth_admin
  USING (true);
DROP POLICY IF EXISTS "Auth hook reads verified login sessions" ON public.login_otp_verified_sessions;
CREATE POLICY "Auth hook reads verified login sessions"
  ON public.login_otp_verified_sessions FOR SELECT TO supabase_auth_admin
  USING (true);

-- Bind the exception to the existing confirmed Auth account IDs. This seeds
-- only the exact two requested addresses; a later replacement account does
-- not inherit the exception automatically.
INSERT INTO public.login_otp_exempt_users (user_id, reason)
SELECT id, CASE lower(email)
  WHEN 'admin@uvain.nl' THEN 'admin'
  WHEN 'test@uvain.nl' THEN 'test'
END
FROM auth.users
WHERE lower(email) IN ('admin@uvain.nl', 'test@uvain.nl')
  AND email_confirmed_at IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  token_claims jsonb := event -> 'claims';
  caller_id uuid := nullif(event ->> 'user_id', '')::uuid;
  caller_session_id uuid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  auth_method text := event ->> 'authentication_method';
  app_access boolean := false;
BEGIN
  IF caller_id IS NOT NULL AND caller_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.login_otp_verified_sessions AS verified
      WHERE verified.user_id = caller_id
        AND verified.session_id = caller_session_id
    )
    INTO app_access;

    -- The email exemption is server-side and tied to a confirmed Auth user
    -- ID. It applies only to password-created sessions, never OTP-only ones.
    IF NOT app_access
       AND auth_method IN ('password', 'token_refresh')
       AND coalesce(token_claims -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.login_otp_exempt_users AS exempt
        WHERE exempt.user_id = caller_id
      )
      INTO app_access;
    END IF;
  END IF;

  -- Always overwrite this top-level claim so user-editable metadata cannot
  -- grant access.
  token_claims := jsonb_set(
    coalesce(token_claims, '{}'::jsonb),
    '{app_access}',
    to_jsonb(app_access),
    true
  );

  RETURN jsonb_build_object('claims', token_claims);
EXCEPTION WHEN OTHERS THEN
  -- Fail closed if the grant lookup fails.
  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 500,
      'message', 'Unable to evaluate application login proof'
    )
  );
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Define this before the safe views below. Production does not currently have
-- this function, while development does, so the login migration must be
-- self-contained in either environment.
CREATE OR REPLACE FUNCTION public.is_current_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL
      OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.session_token = (SELECT auth.jwt() ->> 'session_id')
    )
  END;
$function$;

-- Keep existing owner-rights sanitized views closed until the caller has an
-- application-authorized session.
CREATE OR REPLACE VIEW public.restaurant_comments_safe
WITH (security_barrier = true)
AS
SELECT
  comment.id,
  comment.restaurant_id,
  (comment.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN comment.is_anonymous THEN '익명' ELSE comment.username END AS username,
  comment.is_anonymous,
  comment.body,
  comment.created_at,
  comment.updated_at
FROM public.restaurant_comments AS comment
WHERE (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

CREATE OR REPLACE VIEW public.restaurant_notes_safe
WITH (security_barrier = true)
AS
SELECT
  note.id,
  note.restaurant_id,
  (note.user_id = (SELECT auth.uid())) AS is_mine,
  CASE WHEN note.is_anonymous THEN '익명' ELSE note.username END AS username,
  CASE WHEN note.is_anonymous THEN NULL ELSE note.avatar_color_seed END AS avatar_color_seed,
  CASE WHEN note.is_anonymous OR note.user_id <> (SELECT auth.uid()) THEN NULL ELSE note.profile_image_url END AS profile_image_url,
  note.is_anonymous,
  note.body,
  note.created_at,
  note.updated_at,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_redemption_id ELSE NULL END AS source_redemption_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_store_id ELSE NULL END AS source_store_id,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_rating ELSE NULL END AS source_rating,
  CASE WHEN note.user_id = (SELECT auth.uid()) THEN note.source_tags ELSE NULL END AS source_tags
FROM public.restaurant_notes AS note
WHERE (SELECT auth.jwt() ->> 'app_access') = 'true'
  AND public.is_current_device_session();

-- Add a restrictive gate to every public relation currently granted to the
-- authenticated API role. Existing ownership and role policies continue to
-- decide which rows are visible after this login-proof check passes.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname NOT IN ('login_otp_exempt_users', 'login_otp_verified_sessions')
      AND (
        has_table_privilege('authenticated', relation.oid, 'SELECT')
        OR has_table_privilege('authenticated', relation.oid, 'INSERT')
        OR has_table_privilege('authenticated', relation.oid, 'UPDATE')
        OR has_table_privilege('authenticated', relation.oid, 'DELETE')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
      'require_app_login', target.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT coalesce(auth.jwt() ->> ''app_access'' = ''true'', false))) WITH CHECK ((SELECT coalesce(auth.jwt() ->> ''app_access'' = ''true'', false)))',
      'require_app_login', target.table_name
    );
  END LOOP;
END;
$$;

-- Profile images are private member data; public/event/place assets are not
-- affected by this additional storage gate.
DROP POLICY IF EXISTS "Require app login for profile images" ON storage.objects;
CREATE POLICY "Require app login for profile images"
  ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'profile-images'
    OR coalesce((SELECT auth.jwt() ->> 'app_access' = 'true'), false)
  )
  WITH CHECK (
    bucket_id <> 'profile-images'
    OR coalesce((SELECT auth.jwt() ->> 'app_access' = 'true'), false)
  );

-- These client RPCs are SECURITY DEFINER, so explicitly gate them too.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    );
$function$;

CREATE OR REPLACE FUNCTION public.claim_single_device_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  caller_session text := (SELECT auth.jwt() ->> 'session_id');
  changed_rows integer;
BEGIN
  IF caller_id IS NULL
     OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized application login is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id) THEN
    RETURN true;
  END IF;

  IF caller_session IS NULL OR caller_session = '' THEN RETURN false; END IF;
  UPDATE public.members SET session_token = caller_session WHERE user_id = caller_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$function$;

-- Keep the explicit client RPC API narrow after replacing function bodies.
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_single_device_session() TO authenticated;

COMMIT;
