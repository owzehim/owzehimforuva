-- OPS-05 (CITS report v3): widen the admin action audit.
--
-- 1. Changes made without a logged-in app user are now recorded too, under the
--    database user and connecting application (e.g. Supabase dashboard / SQL
--    editor, the CLI, or the nightly pg_cron job). Before, the trigger skipped
--    every change where auth.uid() was empty.
--    Not recorded (unchanged): members' own changes, and service_role API calls
--    from Edge Functions (session_user = authenticator); admin Edge Functions
--    already write their own audit entry first and refuse if it fails.
-- 2. Three more tables are audited: admin_roles, partnership_integrations,
--    login_otp_exempt_users.
-- 3. resource_id falls back to user_id / partnership_id for tables without id.
--
-- Only column names are stored (changed_fields), never values.

BEGIN;

ALTER TABLE public.admin_action_audit
  ADD COLUMN IF NOT EXISTS db_role text,
  ADD COLUMN IF NOT EXISTS db_application text;

CREATE OR REPLACE FUNCTION public.log_admin_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  old_row jsonb;
  new_row jsonb;
  target_row jsonb;
  target_id text;
  changed text[] := ARRAY[]::text[];
  actor uuid := (SELECT auth.uid());
  login_role text := session_user::text;
  app_name text := nullif(current_setting('application_name', true), '');
BEGIN
  IF actor IS NOT NULL THEN
    -- Logged-in app user: only administrators' changes are audited.
    IF NOT public.is_admin() THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
  ELSIF login_role = 'authenticator' THEN
    -- API call without a user (service_role from Edge Functions): skipped,
    -- because those functions write their own audit entries.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    target_row := new_row;
    SELECT coalesce(array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_object_keys(new_row) AS fields(field_name)
    WHERE field_name NOT IN ('created_at', 'updated_at');
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    target_row := new_row;
    SELECT coalesce(array_agg(new_field.field_name ORDER BY new_field.field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_each(new_row) AS new_field(field_name, field_value)
    WHERE old_row -> new_field.field_name IS DISTINCT FROM new_field.field_value
      AND new_field.field_name NOT IN ('created_at', 'updated_at');
    IF cardinality(changed) = 0 THEN RETURN NEW; END IF;
  ELSE
    old_row := to_jsonb(OLD);
    target_row := old_row;
  END IF;

  target_id := coalesce(
    target_row ->> 'id',
    target_row ->> 'user_id',
    target_row ->> 'partnership_id'
  );

  INSERT INTO public.admin_action_audit (
    actor_id, action, resource_type, resource_id, changed_fields, db_role, db_application
  ) VALUES (
    actor,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    changed,
    CASE WHEN actor IS NULL THEN login_role END,
    CASE WHEN actor IS NULL THEN left(app_name, 120) END
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_admin_changes ON public.admin_roles;
CREATE TRIGGER audit_admin_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

DROP TRIGGER IF EXISTS audit_admin_changes ON public.partnership_integrations;
CREATE TRIGGER audit_admin_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.partnership_integrations
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

DROP TRIGGER IF EXISTS audit_admin_changes ON public.login_otp_exempt_users;
CREATE TRIGGER audit_admin_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.login_otp_exempt_users
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

COMMIT;
