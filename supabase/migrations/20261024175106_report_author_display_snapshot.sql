BEGIN;

ALTER TABLE public.restaurant_note_reports
  ADD COLUMN IF NOT EXISTS content_author_name_snapshot text;

UPDATE public.restaurant_note_reports AS report
SET content_author_name_snapshot = CASE
  WHEN note.is_anonymous THEN '익명'
  ELSE coalesce(nullif(btrim(note.username), ''), '익명')
END
FROM public.restaurant_notes AS note
WHERE report.note_id = note.id
  AND report.content_author_name_snapshot IS NULL;

CREATE OR REPLACE FUNCTION public.capture_restaurant_note_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_note record;
  reporter_email_value text;
  author_email_value text;
BEGIN
  IF NEW.reporter_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'reporter must be the current user';
  END IF;
  IF NEW.reason NOT IN ('illegal_threat', 'privacy', 'intellectual_property', 'other_illegal', 'community_guidelines') THEN
    RAISE EXCEPTION 'invalid report reason';
  END IF;
  NEW.explanation := NULLIF(btrim(NEW.explanation), '');
  IF NEW.explanation IS NOT NULL AND char_length(NEW.explanation) > 2000 THEN
    RAISE EXCEPTION 'report explanation is too long';
  END IF;
  IF NEW.reporter_name IS NULL OR char_length(btrim(NEW.reporter_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'reporter name is required';
  END IF;
  IF NEW.good_faith IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'good-faith confirmation is required';
  END IF;

  SELECT note.id, note.user_id, note.body, note.username, note.is_anonymous,
         note.restaurant_id, restaurant.name AS restaurant_name
  INTO target_note
  FROM public.restaurant_notes AS note
  LEFT JOIN public.restaurants AS restaurant ON restaurant.id = note.restaurant_id
  WHERE note.id = NEW.note_id
    AND note.hidden_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reported note is unavailable';
  END IF;

  SELECT lower(auth_user.email)
  INTO reporter_email_value
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.reporter_id;
  IF reporter_email_value IS NULL THEN
    RAISE EXCEPTION 'reporter contact email is unavailable';
  END IF;

  SELECT lower(auth_user.email)
  INTO author_email_value
  FROM auth.users AS auth_user
  WHERE auth_user.id = target_note.user_id;

  NEW.reporter_name := btrim(NEW.reporter_name);
  NEW.reporter_email := reporter_email_value;
  NEW.note_snapshot := target_note.body;
  NEW.restaurant_name_snapshot := target_note.restaurant_name;
  NEW.content_author_id := target_note.user_id;
  NEW.content_author_email := author_email_value;
  NEW.content_author_name_snapshot := CASE
    WHEN target_note.is_anonymous THEN '익명'
    ELSE coalesce(nullif(btrim(target_note.username), ''), '익명')
  END;
  NEW.status := 'pending';
  NEW.decision := NULL;
  NEW.decision_reason := NULL;
  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  NEW.created_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_restaurant_note_report()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE INSERT (content_author_name_snapshot)
  ON TABLE public.restaurant_note_reports FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (content_author_name_snapshot)
  ON TABLE public.restaurant_note_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT (content_author_name_snapshot)
  ON TABLE public.restaurant_note_reports TO authenticated;

COMMIT;
