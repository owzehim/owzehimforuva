-- SEC-17: remove the obsolete translation quota objects after retiring translation.
-- The table was empty in production and development when this migration was applied.
DROP FUNCTION IF EXISTS public.reserve_translation_characters(integer);
DROP TABLE IF EXISTS public.translation_usage_months;
