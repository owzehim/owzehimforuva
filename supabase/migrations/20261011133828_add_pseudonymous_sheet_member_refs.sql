-- Keep the production/DEV pseudonymous sheet reference in fresh database builds.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS sheet_member_ref uuid DEFAULT gen_random_uuid();

UPDATE public.members
SET sheet_member_ref = gen_random_uuid()
WHERE sheet_member_ref IS NULL;

ALTER TABLE public.members
  ALTER COLUMN sheet_member_ref SET DEFAULT gen_random_uuid(),
  ALTER COLUMN sheet_member_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_sheet_member_ref_uidx
  ON public.members (sheet_member_ref);
