-- Retire the report RPC introduced for the abandoned aggregate-only Sheets flow.
DROP FUNCTION IF EXISTS public.get_google_aggregate_report(text);
