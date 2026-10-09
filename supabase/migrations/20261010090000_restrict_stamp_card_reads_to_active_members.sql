-- Only active, verified members may read their stamp-card history or rewards.
-- The service role continues to support trusted Edge Function operations.

BEGIN;

DROP POLICY IF EXISTS "Stamp card reads require active membership"
  ON public.stamp_card_visits;
CREATE POLICY "Stamp card reads require active membership"
  ON public.stamp_card_visits
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.is_member IS TRUE
        AND member.account_status = 'active'
        AND member.identity_anonymized_at IS NULL
        AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
    )
  );

DROP POLICY IF EXISTS "Stamp card reads require active membership"
  ON public.stamp_card_rewards;
CREATE POLICY "Stamp card reads require active membership"
  ON public.stamp_card_rewards
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.is_member IS TRUE
        AND member.account_status = 'active'
        AND member.identity_anonymized_at IS NULL
        AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
    )
  );

COMMIT;
