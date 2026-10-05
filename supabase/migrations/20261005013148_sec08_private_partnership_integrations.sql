-- SEC-08: keep Apps Script webhook endpoints out of the public partnerships
-- table. Only trusted Edge Functions using service_role can read them.

BEGIN;

DO $$
DECLARE
  missing_columns text;
BEGIN
  SELECT string_agg(expected.column_name, ', ' ORDER BY expected.column_name)
  INTO missing_columns
  FROM unnest(ARRAY[
    'id',
    'master_apps_script_url',
    'partner_apps_script_url',
    'partner_sheet_url'
  ]) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = 'partnerships'
      AND actual.column_name = expected.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-08 expected public.partnerships columns are missing: %',
      missing_columns;
  END IF;

  IF to_regclass('public.partnership_integrations') IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-08 public.partnership_integrations already exists; inspect it before applying this migration';
  END IF;
END;
$$;

CREATE TABLE public.partnership_integrations (
  partnership_id text PRIMARY KEY
    REFERENCES public.partnerships(id) ON DELETE CASCADE,
  master_apps_script_url text,
  partner_apps_script_url text,
  partner_sheet_url text
);

ALTER TABLE public.partnership_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.partnership_integrations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.partnership_integrations TO service_role;

INSERT INTO public.partnership_integrations (
  partnership_id,
  master_apps_script_url,
  partner_apps_script_url,
  partner_sheet_url
)
SELECT
  id,
  master_apps_script_url,
  partner_apps_script_url,
  partner_sheet_url
FROM public.partnerships
WHERE master_apps_script_url IS NOT NULL
   OR partner_apps_script_url IS NOT NULL
   OR partner_sheet_url IS NOT NULL;

ALTER TABLE public.partnerships
  ENABLE ROW LEVEL SECURITY;

-- Member-facing screens only need the partnership ID and display name.
-- Keep this data authenticated-only; anonymous pages use restaurants instead.
REVOKE ALL PRIVILEGES ON TABLE public.partnerships FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  partnership_column record;
BEGIN
  FOR partnership_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partnerships'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE public.partnerships FROM PUBLIC, anon, authenticated',
      partnership_column.column_name
    );
  END LOOP;
END;
$$;

GRANT SELECT (id, name)
  ON TABLE public.partnerships TO authenticated;

COMMIT;
