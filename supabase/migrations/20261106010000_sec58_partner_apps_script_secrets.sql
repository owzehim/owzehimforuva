-- SEC-58 (CITS report v3): one Apps Script secret per partner instead of one
-- shared PARTNER_APPS_SCRIPT_SECRET.
--
-- * Each partnership gets its own random secret (64 hex characters), created
--   here inside the database; it never passes through the app or the repo.
-- * Server only: RLS on, no policies, no access for anon/authenticated.
-- * `enabled` starts false, so nothing changes until an admin switches a
--   partner over (after pasting that partner's secret into its sheet's Script
--   Properties). Until then Edge Functions keep sending the shared secret.
-- * New partnerships get a secret automatically.
-- * Changes are recorded by the admin audit trigger (column names only).

BEGIN;

CREATE TABLE IF NOT EXISTS public.partnership_apps_script_secrets (
  partnership_id text PRIMARY KEY REFERENCES public.partnerships(id) ON DELETE CASCADE,
  secret text NOT NULL CHECK (length(secret) >= 32),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partnership_apps_script_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.partnership_apps_script_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.partnership_apps_script_secrets TO service_role;

CREATE OR REPLACE FUNCTION public.touch_partnership_apps_script_secret()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS touch_updated_at ON public.partnership_apps_script_secrets;
CREATE TRIGGER touch_updated_at
  BEFORE UPDATE ON public.partnership_apps_script_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_partnership_apps_script_secret();

DROP TRIGGER IF EXISTS audit_admin_changes ON public.partnership_apps_script_secrets;
CREATE TRIGGER audit_admin_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.partnership_apps_script_secrets
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_action();

-- Every new partnership gets its own secret.
CREATE OR REPLACE FUNCTION public.create_partnership_apps_script_secret()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.partnership_apps_script_secrets (partnership_id, secret)
  VALUES (NEW.id, encode(extensions.gen_random_bytes(32), 'hex'))
  ON CONFLICT (partnership_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_partnership_apps_script_secret() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_partnership_apps_script_secret() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_apps_script_secret ON public.partnerships;
CREATE TRIGGER create_apps_script_secret
  AFTER INSERT ON public.partnerships
  FOR EACH ROW EXECUTE FUNCTION public.create_partnership_apps_script_secret();

-- Existing partnerships.
INSERT INTO public.partnership_apps_script_secrets (partnership_id, secret)
SELECT p.id, encode(extensions.gen_random_bytes(32), 'hex')
FROM public.partnerships AS p
ON CONFLICT (partnership_id) DO NOTHING;

COMMIT;
