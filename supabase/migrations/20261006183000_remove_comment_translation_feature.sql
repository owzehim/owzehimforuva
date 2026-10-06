-- The app no longer uses cached restaurant comment translations.
-- DEV and production were checked and contain no translation rows.
DROP TABLE IF EXISTS public.restaurant_comment_translations;
