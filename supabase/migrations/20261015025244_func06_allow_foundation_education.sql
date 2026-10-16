BEGIN;

ALTER TABLE public.members
  DROP CONSTRAINT members_education_level_check,
  ADD CONSTRAINT members_education_level_check
    CHECK (education_level = ANY (ARRAY['foundation', 'bachelor', 'master', 'alumni']::text[]));

CREATE OR REPLACE FUNCTION public.study_stage(education_level text, year_number integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN education_level = 'foundation' THEN 'Foundation'
    WHEN education_level ILIKE '%master%' THEN 'Master'
    WHEN education_level ILIKE '%pre%' THEN 'Pre-Master'
    WHEN education_level ILIKE '%bachelor%' AND year_number = 1 THEN 'Early Bachelor'
    WHEN education_level ILIKE '%bachelor%' AND year_number >= 2 THEN 'Late Bachelor'
    WHEN education_level IS NULL AND year_number = 1 THEN 'Early Bachelor'
    WHEN education_level IS NULL AND year_number >= 2 THEN 'Late Bachelor'
    ELSE 'Other / Unknown'
  END;
$$;

COMMIT;
