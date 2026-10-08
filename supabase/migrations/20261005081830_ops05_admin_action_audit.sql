-- OPS-05: keep a minimal, append-only record of administrator changes.
-- Do not copy old/new member values into the audit log; only changed field
-- names and record identifiers are retained.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_action_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.admin_action_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_action_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.admin_action_audit TO service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.admin_action_audit_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_action_audit_id_seq TO service_role;

CREATE INDEX IF NOT EXISTS admin_action_audit_created_at_idx
  ON public.admin_action_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_action_audit_actor_created_at_idx
  ON public.admin_action_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_action_audit_resource_idx
  ON public.admin_action_audit (resource_type, resource_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_admin_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_row jsonb;
  new_row jsonb;
  target_id text;
  changed text[] := ARRAY[]::text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    target_id := new_row ->> 'id';
    SELECT coalesce(array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_object_keys(new_row) AS fields(field_name)
    WHERE field_name NOT IN ('created_at', 'updated_at');
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    target_id := new_row ->> 'id';
    SELECT coalesce(array_agg(new_field.field_name ORDER BY new_field.field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_each(new_row) AS new_field(field_name, field_value)
    WHERE old_row -> new_field.field_name IS DISTINCT FROM new_field.field_value
      AND new_field.field_name NOT IN ('created_at', 'updated_at');
    IF cardinality(changed) = 0 THEN RETURN NEW; END IF;
  ELSE
    old_row := to_jsonb(OLD);
    target_id := old_row ->> 'id';
  END IF;

  INSERT INTO public.admin_action_audit (
    actor_id, action, resource_type, resource_id, changed_fields
  ) VALUES (
    (SELECT auth.uid()),
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    changed
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_admin_action()
  FROM PUBLIC, anon, authenticated, service_role;

DO $function$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'members',
    'events',
    'restaurants',
    'stamp_card_config',
    'stamp_card_rewards',
    'restaurant_comments',
    'restaurant_comment_reports',
    'restaurant_notes',
    'restaurant_note_reports'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'OPS-05 expected public.% to exist', table_name;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_admin_changes ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER audit_admin_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_admin_action()',
      table_name
    );
  END LOOP;
END;
$function$;

COMMIT;
