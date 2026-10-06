-- SEC-35: a self-submitted student number must not reserve the verified,
-- unique student_number field before an administrator checks the claim.
BEGIN;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS pending_student_number text;

CREATE INDEX IF NOT EXISTS members_pending_student_number_idx
  ON public.members (pending_student_number)
  WHERE pending_student_number IS NOT NULL;

COMMENT ON COLUMN public.members.student_number IS
  'Student number confirmed by an administrator; unique values are reserved here.';
COMMENT ON COLUMN public.members.pending_student_number IS
  'Unverified student-number claim submitted during registration; not unique and not valid for membership display.';

COMMIT;
