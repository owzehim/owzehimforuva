-- SEC-17: retire the no-longer-used translation caches.
-- The app no longer calls either translation endpoint.
-- Preserve translation_usage_months as the future spend-safety cap.
DROP TABLE IF EXISTS public.restaurant_comment_translations;
DROP TABLE IF EXISTS public.restaurant_note_translations;
