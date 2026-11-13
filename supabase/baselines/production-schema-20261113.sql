-- Production schema baseline (OPS-01) — REFERENCE ONLY.
--
-- Schema-only dump of the production Supabase project (tables, RLS policies,
-- grants, functions, triggers) taken 2026-11-13 by the
-- 'Production schema snapshot' workflow. It contains no member data.
--
-- Use: rebuild a NEW, empty database (for example a fresh DEV or a restore
-- test) with this file first, then apply any newer migration from
-- supabase/migrations/. NEVER run this against the production project, and
-- never `supabase db push` to production (README "Database changes and deployment").
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone DEFAULT "clock_timestamp"(), "p_admin_note" "text" DEFAULT NULL::"text") RETURNS TABLE("reward_pending" boolean, "cycle_completed" boolean, "new_count" integer, "card_cycle" integer, "total_stamps" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
DECLARE
  v_total integer;
  v_prior_count integer;
  v_cycle integer;
  v_new_count integer;
  v_pending boolean;
BEGIN
  IF p_user_id IS NULL OR p_restaurant_id IS NULL OR p_visited_at IS NULL THEN
    RAISE EXCEPTION 'user, restaurant, and visit time are required';
  END IF;
  IF length(coalesce(p_admin_note, '')) > 500 THEN
    RAISE EXCEPTION 'admin note is too long';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_restaurant_id::text, 0)
  );

  SELECT GREATEST(1, c.total_stamps)
    INTO v_total
  FROM public.restaurants AS r
  JOIN public.stamp_card_config AS c ON c.restaurant_id = r.id
  WHERE r.id = p_restaurant_id
    AND r.stamp_card_enabled IS TRUE
    AND r.is_archived IS FALSE
  LIMIT 1;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'stamp card is not enabled for this restaurant';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stamp_card_rewards AS reward
    WHERE reward.user_id = p_user_id
      AND reward.restaurant_id = p_restaurant_id
      AND reward.redeemed IS FALSE
      AND reward.expires_at IS NULL
  ) INTO v_pending;

  IF v_pending THEN
    RETURN QUERY SELECT true, true, 0, 0, v_total;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_prior_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id AND visit.restaurant_id = p_restaurant_id;

  v_cycle := (v_prior_count / v_total) + 1;
  INSERT INTO public.stamp_card_visits (
    user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note
  ) VALUES (
    p_user_id, p_restaurant_id, p_visited_at, v_cycle, true, nullif(p_admin_note, '')
  );

  v_new_count := v_prior_count + 1;
  IF v_new_count % v_total = 0 THEN
    INSERT INTO public.stamp_card_rewards (user_id, restaurant_id, card_cycle, redeemed)
    VALUES (p_user_id, p_restaurant_id, v_cycle, false)
    ON CONFLICT (user_id, restaurant_id, card_cycle) DO NOTHING;
  END IF;

  RETURN QUERY SELECT false, (v_new_count % v_total = 0), v_new_count, v_cycle, v_total;
END;
$$;


ALTER FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_checkin_review"("p_days" integer DEFAULT 30) RETURNS TABLE("user_id" "uuid", "member_name" "text", "student_number" "text", "reasons" "text"[], "latest_at" timestamp with time zone, "reviewed_at" timestamp with time zone, "reviewed_through" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  WITH recent AS (
    SELECT r.user_id, r.store_id, r.redeemed_at,
           (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date AS day
    FROM public.redemptions AS r
    WHERE public.is_admin()
      AND r.user_id IS NOT NULL
      AND r.redeemed_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
  ),
  ordered AS (
    SELECT recent.*,
           lag(recent.store_id) OVER w AS previous_store,
           lag(recent.redeemed_at) OVER w AS previous_at
    FROM recent
    WINDOW w AS (PARTITION BY recent.user_id ORDER BY recent.redeemed_at)
  ),
  flags AS (
    SELECT o.user_id, 'quick_switch'::text AS reason, max(o.redeemed_at) AS at
    FROM ordered AS o
    WHERE o.previous_store IS DISTINCT FROM o.store_id
      AND o.previous_at IS NOT NULL
      AND o.redeemed_at - o.previous_at <= interval '10 minutes'
    GROUP BY o.user_id
    UNION ALL
    SELECT d.user_id, 'daily_limit', max(d.last_at)
    FROM (
      SELECT recent.user_id, recent.day, count(DISTINCT recent.store_id) AS stores, max(recent.redeemed_at) AS last_at
      FROM recent GROUP BY recent.user_id, recent.day
    ) AS d
    WHERE d.stores >= 3
    GROUP BY d.user_id
    UNION ALL
    SELECT f.user_id, 'same_store_frequent', max(f.last_at)
    FROM (
      SELECT recent.user_id, recent.store_id, count(DISTINCT recent.day) AS days, max(recent.redeemed_at) AS last_at
      FROM recent GROUP BY recent.user_id, recent.store_id
    ) AS f
    WHERE f.days >= 15
    GROUP BY f.user_id
  ),
  flagged AS (
    SELECT flags.user_id, array_agg(flags.reason ORDER BY flags.reason) AS reasons, max(flags.at) AS latest_at
    FROM flags
    GROUP BY flags.user_id
  )
  SELECT flagged.user_id,
         coalesce(
           nullif(btrim(concat(member.last_name_korean, member.first_name_korean)), ''),
           nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
           '—'
         ),
         member.student_number,
         flagged.reasons,
         flagged.latest_at,
         CASE WHEN decision.reviewed_through >= flagged.latest_at THEN decision.reviewed_at END,
         decision.reviewed_through
  FROM flagged
  LEFT JOIN public.members AS member ON member.user_id = flagged.user_id
  LEFT JOIN public.checkin_review_decisions AS decision ON decision.user_id = flagged.user_id
  ORDER BY flagged.latest_at DESC
  LIMIT 100;
$$;


ALTER FUNCTION "public"."admin_checkin_review"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_admin_user_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT admin_role.user_id
  FROM public.admin_roles AS admin_role
  WHERE public.is_admin();
$$;


ALTER FUNCTION "public"."admin_list_admin_user_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_stamp_card_members"("p_restaurant_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  WITH visit_counts AS (
    SELECT visit.user_id, count(*)::integer AS visit_count
    FROM public.stamp_card_visits AS visit
    WHERE visit.restaurant_id = p_restaurant_id
    GROUP BY visit.user_id
  ),
  latest_rewards AS (
    SELECT DISTINCT ON (reward.user_id)
      reward.user_id,
      jsonb_build_object(
        'id', reward.id,
        'user_id', reward.user_id,
        'restaurant_id', reward.restaurant_id,
        'card_cycle', reward.card_cycle,
        'redeemed', reward.redeemed,
        'redeemed_at', reward.redeemed_at,
        'created_at', reward.created_at,
        'expires_at', reward.expires_at
      ) AS latest_reward
    FROM public.stamp_card_rewards AS reward
    WHERE reward.restaurant_id = p_restaurant_id
    ORDER BY reward.user_id, reward.created_at DESC, reward.id DESC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'member', jsonb_build_object(
          'id', member.id,
          'user_id', member.user_id,
          'first_name', member.first_name,
          'last_name', member.last_name
        ),
        'visitCount', COALESCE(visit_counts.visit_count, 0),
        'latestReward', latest_rewards.latest_reward
      )
      ORDER BY member.last_name ASC NULLS LAST,
               member.first_name ASC NULLS LAST,
               member.id ASC
    ),
    '[]'::jsonb
  )
  FROM public.members AS member
  LEFT JOIN visit_counts ON visit_counts.user_id = member.user_id
  LEFT JOIN latest_rewards ON latest_rewards.user_id = member.user_id
  WHERE member.user_id IS NOT NULL;
$$;


ALTER FUNCTION "public"."admin_list_stamp_card_members"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_partner_sheet_link_issues"() RETURNS TABLE("partnership_id" "text", "partnership_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT partnership.id, partnership.name
  FROM public.partnerships AS partnership
  JOIN public.partnership_integrations AS integration
    ON integration.partnership_id = partnership.id
  LEFT JOIN public.partnership_apps_script_secrets AS secret
    ON secret.partnership_id = partnership.id
  WHERE public.is_admin()
    AND nullif(btrim(integration.partner_apps_script_url), '') IS NOT NULL
    AND coalesce(secret.enabled, false) IS NOT TRUE
  ORDER BY partnership.name;
$$;


ALTER FUNCTION "public"."admin_partner_sheet_link_issues"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reset_stamp_progress"("p_restaurant_id" "uuid", "p_actor_id" "uuid") RETURNS TABLE("archived_visits" integer, "archived_rewards" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_visits integer := 0;
  v_rewards integer := 0;
BEGIN
  IF p_restaurant_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'restaurant and actor are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_actor_id) THEN
    RAISE EXCEPTION 'only an administrator can reset stamp progress';
  END IF;

  -- Lock the place so a concurrent scan or reset cannot interleave.
  PERFORM 1
  FROM public.restaurants
  WHERE id = p_restaurant_id
    AND is_archived IS FALSE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restaurant not found or archived';
  END IF;

  WITH moved AS (
    DELETE FROM public.stamp_card_rewards
    WHERE restaurant_id = p_restaurant_id
    RETURNING id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at
  )
  INSERT INTO public.stamp_card_rewards_archive (
    id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at, archived_by
  )
  SELECT id, user_id, restaurant_id, card_cycle, redeemed, redeemed_at, created_at, expires_at, p_actor_id
  FROM moved;
  GET DIAGNOSTICS v_rewards = ROW_COUNT;

  WITH moved AS (
    DELETE FROM public.stamp_card_visits
    WHERE restaurant_id = p_restaurant_id
    RETURNING id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note
  )
  INSERT INTO public.stamp_card_visits_archive (
    id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note, archived_by
  )
  SELECT id, user_id, restaurant_id, visited_at, card_cycle, added_by_admin, admin_note, p_actor_id
  FROM moved;
  GET DIAGNOSTICS v_visits = ROW_COUNT;

  RETURN QUERY SELECT v_visits, v_rewards;
END;
$$;


ALTER FUNCTION "public"."admin_reset_stamp_progress"("p_restaurant_id" "uuid", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_checkin_review"("p_user_id" "uuid", "p_reviewed" boolean, "p_through" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
  END IF;

  IF p_reviewed THEN
    IF p_through IS NULL THEN
      RAISE EXCEPTION 'reviewed time is required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.checkin_review_decisions AS d (user_id, reviewed_through, reviewed_at, reviewed_by)
    VALUES (p_user_id, least(p_through, now()), now(), auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET reviewed_through = excluded.reviewed_through,
          reviewed_at = excluded.reviewed_at,
          reviewed_by = excluded.reviewed_by;
  ELSE
    DELETE FROM public.checkin_review_decisions WHERE user_id = p_user_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_set_checkin_review"("p_user_id" "uuid", "p_reviewed" boolean, "p_through" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_expired_members"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  affected_count int;
begin
  update public.members
  set
    first_name = null,
    last_name = null,
    first_name_korean = null,
    last_name_korean = null,
    student_number = null,
    session_token = null,
    profile_image_url = null,
    country_of_origin = null,
    gender = null,
    major = null,
    year_of_birth = null,
    year_number = null,
    education_level = null,
    identity_anonymized_at = now()
  where membership_ended_at is not null
    and membership_ended_at < current_date - interval '12 months'
    and identity_anonymized_at is null;

  get diagnostics affected_count = row_count;

  insert into public.privacy_action_log(action)
  values ('anonymize_expired_members: ' || affected_count || ' rows affected');
end;
$$;


ALTER FUNCTION "public"."anonymize_expired_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_expired_members_for_sheets"() RETURNS TABLE("anonymized_user_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS expired_members_for_privacy_job (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.expired_members_for_privacy_job;

  INSERT INTO pg_temp.expired_members_for_privacy_job (user_id)
  SELECT member.user_id
  FROM public.members AS member
  WHERE member.membership_ended_at IS NOT NULL
    AND member.membership_ended_at < current_date - interval '12 months'
    AND member.identity_anonymized_at IS NULL
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    );

  UPDATE public.members AS member
  SET first_name = NULL,
      last_name = NULL,
      first_name_korean = NULL,
      last_name_korean = NULL,
      "University" = NULL,
      student_number = NULL,
      pending_student_number = NULL,
      major = NULL,
      education_level = NULL,
      year_number = NULL,
      year_of_birth = NULL,
      country_of_origin = NULL,
      gender = NULL,
      username = NULL,
      profile_image_url = NULL,
      session_token = NULL,
      is_member = false,
      account_status = 'anonymized',
      identity_anonymized_at = now()
  WHERE member.user_id IN (
    SELECT expired.user_id FROM pg_temp.expired_members_for_privacy_job AS expired
  );

  INSERT INTO public.privacy_action_log (action, record_count, details)
  SELECT
    'anonymize_expired_members',
    count(*),
    jsonb_build_object(
      'retention_rule', 'membership_ended_at + 12 months',
      'sheet_sync_required', true,
      'auth_account_deletion_queued', true
    )
  FROM pg_temp.expired_members_for_privacy_job;

  RETURN QUERY
  SELECT expired.user_id FROM pg_temp.expired_members_for_privacy_job AS expired;
END;
$$;


ALTER FUNCTION "public"."anonymize_expired_members_for_sheets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select case
    when birth_year is null then 'Unknown'
    when extract(year from current_date)::int - birth_year < 20 then 'Under 20'
    when extract(year from current_date)::int - birth_year between 20 and 22 then '20–22'
    when extract(year from current_date)::int - birth_year between 23 and 25 then '23–25'
    when extract(year from current_date)::int - birth_year >= 26 then '26+'
    else 'Unknown'
  end;
$$;


ALTER FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_restaurant_note_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."capture_restaurant_note_report"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."checkin_daily_store_limit_reached"("p_user_id" "uuid", "p_store_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  WITH today AS (
    SELECT DISTINCT r.store_id
    FROM public.redemptions AS r
    WHERE r.user_id = p_user_id
      AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date
          = (now() AT TIME ZONE 'Europe/Amsterdam')::date
  )
  SELECT NOT EXISTS (SELECT 1 FROM today WHERE store_id = p_store_id)
     AND (SELECT count(*) FROM today) >= 3;
$$;


ALTER FUNCTION "public"."checkin_daily_store_limit_reached"("p_user_id" "uuid", "p_store_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_privacy_retention_batch"("p_batch_size" integer DEFAULT 50) RETURNS TABLE("user_id" "uuid", "delete_auth_user" boolean, "sync_master_sheet" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  WITH candidates AS (
    SELECT queue.user_id
    FROM public.privacy_sheet_sync_queue AS queue
    WHERE (queue.lease_until IS NULL OR queue.lease_until < now())
      AND queue.next_attempt_at <= now()
    -- Database/Auth work first, so Sheet-only retries can never hold it up.
    ORDER BY queue.database_done, queue.next_attempt_at, queue.queued_at, queue.user_id
    LIMIT greatest(1, least(coalesce(p_batch_size, 50), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.privacy_sheet_sync_queue AS queue
  SET lease_until = now() + interval '10 minutes',
      attempts = queue.attempts + 1
  FROM candidates
  WHERE queue.user_id = candidates.user_id
  RETURNING queue.user_id, queue.delete_auth_user, queue.sync_master_sheet;
$$;


ALTER FUNCTION "public"."claim_privacy_retention_batch"("p_batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_privacy_sheet_sync_batch"("p_batch_size" integer DEFAULT 50) RETURNS TABLE("user_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  WITH candidates AS (
    SELECT queue.user_id
    FROM public.privacy_sheet_sync_queue AS queue
    WHERE queue.delete_auth_user IS FALSE
      AND (queue.lease_until IS NULL OR queue.lease_until < now())
    ORDER BY queue.queued_at, queue.user_id
    LIMIT greatest(1, least(coalesce(p_batch_size, 50), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.privacy_sheet_sync_queue AS queue
  SET lease_until = now() + interval '10 minutes',
      attempts = queue.attempts + 1
  FROM candidates
  WHERE queue.user_id = candidates.user_id
  RETURNING queue.user_id;
$$;


ALTER FUNCTION "public"."claim_privacy_sheet_sync_batch"("p_batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") RETURNS TABLE("redemption_id" "text", "created" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz;
  v_today date;
  v_existing_id text;
  v_new_id text;
  v_other_stores integer;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL OR p_store_id = '' THEN
    RAISE EXCEPTION 'user and store are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_store_id, 0)
  );
  v_now := clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Europe/Amsterdam')::date;

  -- A retry in the existing 15-minute window returns the same redemption.
  SELECT r.id::text
    INTO v_existing_id
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id = p_store_id
    AND r.redeemed_at >= v_now - interval '15 minutes'
    AND r.redeemed_at <= v_now
  ORDER BY r.redeemed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, false;
    RETURN;
  END IF;

  -- Do not mint another redemption or review prompt later on the same day.
  -- Returning the existing ID preserves the Edge Function's idempotent
  -- Sheets retry behavior without creating another visit record.
  SELECT r.id::text
    INTO v_existing_id
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id = p_store_id
    AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_today
    AND r.redeemed_at <= v_now
  ORDER BY r.redeemed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, false;
    RETURN;
  END IF;

  -- New store today: at most 3 different stores per member per day.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('checkin-day:' || p_user_id::text || ':' || v_today::text, 0)
  );
  SELECT count(DISTINCT r.store_id)::integer
    INTO v_other_stores
  FROM public.redemptions AS r
  WHERE r.user_id = p_user_id
    AND r.store_id <> p_store_id
    AND (r.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_today;

  IF v_other_stores >= 3 THEN
    RAISE EXCEPTION 'daily_store_limit' USING ERRCODE = 'P0001', HINT = 'checkin_daily_store_limit';
  END IF;

  INSERT INTO public.redemptions (user_id, store_id, redeemed_at)
  VALUES (p_user_id, p_store_id, v_now)
  RETURNING id::text INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true;
END;
$$;


ALTER FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_single_device_session"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  caller_session text := (SELECT auth.jwt() ->> 'session_id');
  seat_session text;
  caller_login_at timestamptz;
  seat_login_at timestamptz;
BEGIN
  IF caller_id IS NULL
     OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized application login is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.login_otp_exempt_users
    WHERE user_id = caller_id AND reason = 'test'
  ) THEN
    RETURN true;
  END IF;

  IF caller_session IS NULL
     OR caller_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  SELECT member.session_token
  INTO seat_session
  FROM public.members AS member
  WHERE member.user_id = caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id);
  END IF;

  IF seat_session = caller_session THEN
    RETURN true;
  END IF;

  SELECT session.created_at
  INTO caller_login_at
  FROM auth.sessions AS session
  WHERE session.id = caller_session::uuid
    AND session.user_id = caller_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF seat_session IS NOT NULL
     AND seat_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT session.created_at
    INTO seat_login_at
    FROM auth.sessions AS session
    WHERE session.id = seat_session::uuid
      AND session.user_id = caller_id;

    IF FOUND AND seat_login_at >= caller_login_at THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.members
  SET session_token = caller_session
  WHERE user_id = caller_id;

  RETURN true;
END;
$_$;


ALTER FUNCTION "public"."claim_single_device_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_orphaned_pending_email_changes"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.pending_email_changes AS changes
  WHERE changes.state = 'pending'
    AND (
      NOT EXISTS (SELECT 1 FROM auth.users AS old_user WHERE old_user.id = changes.old_user_id)
      OR NOT EXISTS (SELECT 1 FROM auth.users AS new_user WHERE new_user.id = changes.new_user_id)
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_orphaned_pending_email_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") RETURNS TABLE("old_user_id" "uuid", "state" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  pending public.pending_email_changes%ROWTYPE;
BEGIN
  SELECT * INTO pending
  FROM public.pending_email_changes AS changes
  WHERE changes.new_user_id = p_new_user_id
    AND lower(changes.new_email) = lower(btrim(p_confirmed_email))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF pending.state = 'pending' THEN
    UPDATE public.members
    SET user_id = pending.new_user_id
    WHERE user_id = pending.old_user_id;

    UPDATE public.pending_email_changes
    SET state = 'transferred'
    WHERE new_user_id = pending.new_user_id;
    pending.state := 'transferred';
  END IF;

  RETURN QUERY SELECT pending.old_user_id, pending.state;
END;
$$;


ALTER FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_privacy_sheet_sync"("p_user_id" "uuid", "p_success" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  should_delete_auth boolean;
  attempt_count integer;
  affected_count integer;
BEGIN
  SELECT queue.delete_auth_user, queue.attempts
  INTO should_delete_auth, attempt_count
  FROM public.privacy_sheet_sync_queue AS queue
  WHERE queue.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT coalesce(p_success, false) THEN
    -- FUNC-11: wait longer after each failure (about 1, 2, 4, then 8 days).
    UPDATE public.privacy_sheet_sync_queue
    SET lease_until = NULL,
        next_attempt_at = now()
          + interval '1 day' * least(power(2, greatest(coalesce(attempt_count, 1), 1) - 1), 8)
          - interval '4 hours'
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;

  IF should_delete_auth THEN
    DELETE FROM public.restaurant_comments WHERE user_id = p_user_id;
    DELETE FROM public.restaurant_notes WHERE user_id = p_user_id;
    UPDATE public.reviews
    SET user_id = NULL,
        comment = NULL
    WHERE user_id = p_user_id;
    UPDATE public.redemptions
    SET user_id = NULL
    WHERE user_id = p_user_id;
    DELETE FROM public.review_prompts WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_rewards WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_visits WHERE user_id = p_user_id;
    DELETE FROM public.member_analytics_profiles WHERE user_id = p_user_id;
    DELETE FROM public.legal_consent_receipts WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_verified_sessions WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_exempt_users WHERE user_id = p_user_id;
    DELETE FROM public.pending_email_changes
    WHERE old_user_id = p_user_id OR new_user_id = p_user_id;

    DELETE FROM public.members WHERE user_id = p_user_id;
  END IF;

  DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count = 1;
END;
$$;


ALTER FUNCTION "public"."complete_privacy_sheet_sync"("p_user_id" "uuid", "p_success" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  allowed boolean;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RETURN false;
  END IF;

  INSERT INTO public.edge_rate_limits(key_hash, window_started_at, request_count, updated_at)
  VALUES (p_key_hash, now(), 1, now())
  ON CONFLICT (key_hash) DO UPDATE
  SET window_started_at = CASE
        WHEN public.edge_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= now() THEN now()
        ELSE public.edge_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN public.edge_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= now() THEN 1
        ELSE public.edge_rate_limits.request_count + 1
      END,
      updated_at = now()
  RETURNING request_count <= p_limit INTO allowed;

  DELETE FROM public.edge_rate_limits
  WHERE updated_at < now() - interval '1 day';

  RETURN allowed;
END;
$_$;


ALTER FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_overdue_member_retention"() RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
  FROM public.members AS member
  WHERE member.identity_anonymized_at IS NULL
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    )
    AND (
      coalesce(member.membership_ended_at, member.membership_valid_until)
        < current_date - interval '12 months'
      OR (
        member.is_member IS FALSE
        AND member.membership_valid_until IS NULL
        AND member.membership_ended_at IS NULL
        AND member.account_status = 'active'
        AND EXISTS (
          SELECT 1
          FROM auth.users AS auth_user
          WHERE auth_user.id = member.user_id
            AND auth_user.created_at < now() - interval '12 months'
        )
      )
    );
$$;


ALTER FUNCTION "public"."count_overdue_member_retention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."country_to_region"("country" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when country is null or trim(country) = '' then 'Unknown'

    when country in ('South Korea','North Korea','Japan','China','Taiwan','Mongolia') then 'East Asia'

    when country in ('Vietnam','Thailand','Indonesia','Malaysia','Singapore','Philippines','Cambodia','Laos','Myanmar','Brunei','Timor-Leste') then 'Southeast Asia'

    when country in ('India','Pakistan','Bangladesh','Sri Lanka','Nepal','Bhutan','Maldives','Afghanistan') then 'South Asia'

    when country in ('Netherlands') then 'Netherlands'

    when country in ('Germany','France','Belgium','Luxembourg','Austria','Switzerland','Liechtenstein','Monaco','Ireland','United Kingdom','Italy','Spain','Portugal','Andorra','San Marino','Vatican City','Malta','Denmark','Norway','Sweden','Finland','Iceland') then 'Western / Northern Europe'

    when country in ('Poland','Czech Republic','Czechia','Slovakia','Hungary','Romania','Bulgaria','Croatia','Slovenia','Serbia','Bosnia and Herzegovina','Montenegro','Kosovo','Albania','North Macedonia','Greece','Cyprus','Estonia','Latvia','Lithuania','Moldova','Ukraine','Belarus','Russia') then 'Eastern / Southern Europe'

    when country in ('United States','Canada','Mexico') then 'North America'

    when country in ('Argentina','Bolivia','Brazil','Chile','Colombia','Ecuador','Paraguay','Peru','Uruguay','Venezuela','Guyana','Suriname') then 'South America'

    when country in ('Bahrain','Iran','Iraq','Israel','Jordan','Kuwait','Lebanon','Oman','Palestine','Qatar','Saudi Arabia','Syria','Turkey','United Arab Emirates','Yemen','Armenia','Azerbaijan','Georgia','Kazakhstan','Kyrgyzstan','Tajikistan','Turkmenistan','Uzbekistan') then 'Middle East / Central Asia'

    when country in ('Australia','New Zealand','Fiji','Kiribati','Marshall Islands','Micronesia','Nauru','Palau','Papua New Guinea','Samoa','Solomon Islands','Tonga','Tuvalu','Vanuatu') then 'Oceania'

    when country in ('Algeria','Egypt','Libya','Morocco','Sudan','Tunisia','Angola','Benin','Botswana','Burkina Faso','Burundi','Cameroon','Cape Verde','Central African Republic','Chad','Comoros','Congo','Djibouti','Equatorial Guinea','Eritrea','Eswatini','Ethiopia','Gabon','Gambia','Ghana','Guinea','Guinea-Bissau','Kenya','Lesotho','Liberia','Madagascar','Malawi','Mali','Mauritania','Mauritius','Mozambique','Namibia','Niger','Nigeria','Rwanda','Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan','Tanzania','Togo','Uganda','Zambia','Zimbabwe') then 'Africa'

    when country in ('Bahamas','Barbados','Belize','Costa Rica','Cuba','Dominica','Dominican Republic','El Salvador','Grenada','Guatemala','Haiti','Honduras','Jamaica','Nicaragua','Panama','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Trinidad and Tobago') then 'Central America / Caribbean'

    else 'Other / Unknown'
  end;
$$;


ALTER FUNCTION "public"."country_to_region"("country" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_partnership_apps_script_secret"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.partnership_apps_script_secrets (partnership_id, secret)
  VALUES (NEW.id, encode(extensions.gen_random_bytes(32), 'hex'))
  ON CONFLICT (partnership_id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_partnership_apps_script_secret"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_review_prompt_on_redemption"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.review_prompts (
    redemption_id,
    user_id,
    store_id,
    prompt_at
  ) values (
    new.id,
    new.user_id,
    new.store_id,
    new.redeemed_at + interval '30 minutes'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."create_review_prompt_on_redemption"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
  token_claims jsonb := event -> 'claims';
  caller_id uuid := nullif(event ->> 'user_id', '')::uuid;
  caller_session_id uuid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  auth_method text := event ->> 'authentication_method';
  app_access boolean := false;
BEGIN
  IF caller_id IS NOT NULL AND caller_session_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.login_otp_verified_sessions AS verified
      WHERE verified.user_id = caller_id
        AND verified.session_id = caller_session_id
    )
    INTO app_access;

    -- The email exemption is server-side and tied to a confirmed Auth user
    -- ID. It applies only to password-created sessions, never OTP-only ones.
    IF NOT app_access
       AND auth_method IN ('password', 'token_refresh')
       AND coalesce(token_claims -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'::jsonb THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.login_otp_exempt_users AS exempt
        WHERE exempt.user_id = caller_id
      )
      INTO app_access;
    END IF;
  END IF;

  -- Always overwrite this top-level claim so user-editable metadata cannot
  -- grant access.
  token_claims := jsonb_set(
    coalesce(token_claims, '{}'::jsonb),
    '{app_access}',
    to_jsonb(app_access),
    true
  );

  RETURN jsonb_build_object('claims', token_claims);
EXCEPTION WHEN OTHERS THEN
  -- Fail closed if the grant lookup fails.
  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 500,
      'message', 'Unable to evaluate application login proof'
    )
  );
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_daily_review_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_redemption record;
  v_member record;
  v_visit_day date;
BEGIN
  IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'review must belong to the current member';
  END IF;

  SELECT d.user_id, d.store_id, d.redeemed_at
    INTO v_redemption
  FROM public.redemptions AS d
  WHERE d.id = NEW.redemption_id;

  IF NOT FOUND
     OR v_redemption.user_id IS DISTINCT FROM NEW.user_id
     OR v_redemption.store_id IS DISTINCT FROM NEW.store_id
     OR v_redemption.redeemed_at IS NULL
     OR v_redemption.redeemed_at > now() THEN
    RAISE EXCEPTION 'review must match a valid visit';
  END IF;

  SELECT m.is_member, m.membership_valid_until,
         m.account_status, m.identity_anonymized_at
    INTO v_member
  FROM public.members AS m
  WHERE m.user_id = NEW.user_id;

  IF v_member.is_member IS NOT TRUE
     OR v_member.membership_valid_until IS NULL
     OR v_member.membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date
     OR v_member.account_status IS DISTINCT FROM 'active'
     OR v_member.identity_anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'only active members can review a visit';
  END IF;

  v_visit_day := (v_redemption.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.user_id::text || ':' || NEW.store_id || ':' || v_visit_day::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.reviews AS existing_review
    JOIN public.redemptions AS existing_visit
      ON existing_visit.id = existing_review.redemption_id
    WHERE existing_review.user_id = NEW.user_id
      AND existing_review.store_id = NEW.store_id
      AND (existing_visit.redeemed_at AT TIME ZONE 'Europe/Amsterdam')::date = v_visit_day
  ) THEN
    RAISE EXCEPTION 'one review per restaurant per visit day';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_daily_review_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_restaurant_rewards_on_archive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_ended_at timestamptz := clock_timestamp();
BEGIN
  IF OLD.is_archived IS FALSE AND NEW.is_archived IS TRUE THEN
    UPDATE public.stamp_card_rewards AS reward
    SET expires_at = CASE
          WHEN reward.redeemed IS FALSE AND reward.expires_at IS NULL THEN v_ended_at
          ELSE reward.expires_at
        END,
        delete_after = COALESCE(reward.delete_after, v_ended_at + interval '12 months')
    WHERE reward.restaurant_id = NEW.id;

    UPDATE public.restaurants
    SET archived_at = v_ended_at
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."expire_restaurant_rewards_on_archive"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_expired_signup_auth_users"("p_batch_size" integer DEFAULT 100) RETURNS TABLE("user_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT users.id
  FROM auth.users AS users
  WHERE (
      (users.email_confirmed_at IS NULL AND users.created_at < now() - interval '7 days')
      OR (users.email_confirmed_at IS NOT NULL AND users.created_at < now() - interval '12 months')
    )
    AND coalesce(users.raw_user_meta_data ->> 'is_test_account', 'false') <> 'true'
    AND coalesce(users.raw_app_meta_data ->> 'is_test_account', 'false') <> 'true'
    AND NOT EXISTS (
      SELECT 1 FROM public.members AS member WHERE member.user_id = users.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role WHERE admin_role.user_id = users.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt WHERE exempt.user_id = users.id
    )
  ORDER BY users.created_at, users.id
  LIMIT greatest(1, least(coalesce(p_batch_size, 100), 500));
$$;


ALTER FUNCTION "public"."find_expired_signup_auth_users"("p_batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") RETURNS TABLE("user_id" "uuid", "user_metadata" "jsonb", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT users.id, users.raw_user_meta_data, users.created_at
  FROM auth.users AS users
  WHERE lower(users.email) = lower(btrim(p_email))
    AND users.email_confirmed_at IS NULL
  LIMIT 1;
$$;


ALTER FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finish_privacy_retention_database"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  should_delete_auth boolean;
  should_sync_sheet boolean;
BEGIN
  SELECT queue.delete_auth_user, queue.sync_master_sheet
  INTO should_delete_auth, should_sync_sheet
  FROM public.privacy_sheet_sync_queue AS queue
  WHERE queue.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF should_delete_auth THEN
    -- Same database cleanup as complete_privacy_sheet_sync(…, true).
    DELETE FROM public.restaurant_comments WHERE user_id = p_user_id;
    DELETE FROM public.restaurant_notes WHERE user_id = p_user_id;
    UPDATE public.reviews
    SET user_id = NULL,
        comment = NULL
    WHERE user_id = p_user_id;
    UPDATE public.redemptions
    SET user_id = NULL
    WHERE user_id = p_user_id;
    DELETE FROM public.review_prompts WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_rewards WHERE user_id = p_user_id;
    DELETE FROM public.stamp_card_visits WHERE user_id = p_user_id;
    DELETE FROM public.member_analytics_profiles WHERE user_id = p_user_id;
    DELETE FROM public.legal_consent_receipts WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_verified_sessions WHERE user_id = p_user_id;
    DELETE FROM public.login_otp_exempt_users WHERE user_id = p_user_id;
    DELETE FROM public.pending_email_changes
    WHERE old_user_id = p_user_id OR new_user_id = p_user_id;

    DELETE FROM public.members WHERE user_id = p_user_id;
  END IF;

  IF should_sync_sheet THEN
    -- Database side is done; keep only the Master Sheet step queued.
    UPDATE public.privacy_sheet_sync_queue
    SET delete_auth_user = false,
        database_done = true
    WHERE user_id = p_user_id;
  ELSE
    DELETE FROM public.privacy_sheet_sync_queue WHERE user_id = p_user_id;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."finish_privacy_retention_database"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_user_content_created_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := statement_timestamp();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."force_user_content_created_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_store_review_summaries"("p_store_ids" "text"[]) RETURNS TABLE("store_id" "text", "average_rating" numeric, "review_count" bigint, "tag_counts" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR (
    NOT public.is_admin()
    AND NOT EXISTS (
      SELECT 1
      FROM public.members AS member
      WHERE member.user_id = auth.uid()
        AND member.is_member IS TRUE
        AND member.membership_valid_until >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
    )
  ) THEN
    RAISE EXCEPTION 'Active member access is required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT requested_store.store_id
    FROM unnest(coalesce(p_store_ids, ARRAY[]::text[])) AS requested_store(store_id)
    WHERE requested_store.store_id IS NOT NULL
      AND cardinality(coalesce(p_store_ids, ARRAY[]::text[])) <= 100
    LIMIT 100
  ), aggregates AS (
    SELECT
      requested.store_id,
      count(review.id)::bigint AS review_count,
      round(avg(review.rating), 1)::numeric AS average_rating,
      count(review.id) FILTER (WHERE 'GREAT_FOOD' = ANY(review.tags))::bigint AS great_food,
      count(review.id) FILTER (WHERE 'FRIENDLY_STAFF' = ANY(review.tags))::bigint AS friendly_staff,
      count(review.id) FILTER (WHERE 'NICE_ATMOSPHERE' = ANY(review.tags))::bigint AS nice_atmosphere,
      count(review.id) FILTER (WHERE 'GOOD_VALUE' = ANY(review.tags))::bigint AS good_value
    FROM requested
    LEFT JOIN public.reviews AS review ON review.store_id = requested.store_id
    GROUP BY requested.store_id
  )
  SELECT
    aggregates.store_id,
    coalesce(aggregates.average_rating, 0),
    aggregates.review_count,
    jsonb_build_object(
      'GREAT_FOOD', aggregates.great_food,
      'FRIENDLY_STAFF', aggregates.friendly_staff,
      'NICE_ATMOSPHERE', aggregates.nice_atmosphere,
      'GOOD_VALUE', aggregates.good_value
    )
  FROM aggregates;
END;
$$;


ALTER FUNCTION "public"."get_member_store_review_summaries"("p_store_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) RETURNS TABLE("store_id" "text", "average_rating" numeric, "review_count" bigint, "tag_counts" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH requested AS (
    SELECT DISTINCT requested_store.store_id
    FROM unnest(coalesce(p_store_ids, ARRAY[]::text[])) AS requested_store(store_id)
    WHERE requested_store.store_id IS NOT NULL
      AND cardinality(coalesce(p_store_ids, ARRAY[]::text[])) <= 100
    LIMIT 100
  ), criteria_reset AS (
    SELECT requested.store_id, max(place.review_criteria_since) AS since
    FROM requested
    LEFT JOIN public.restaurants AS place ON place.partnership_id = requested.store_id
    GROUP BY requested.store_id
  ), aggregates AS (
    SELECT
      requested.store_id,
      count(review.id)::bigint AS review_count,
      round(avg(review.rating), 1)::numeric AS average_rating,
      count(review.id) FILTER (WHERE 'GREAT_FOOD' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS great_food,
      count(review.id) FILTER (WHERE 'FRIENDLY_STAFF' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS friendly_staff,
      count(review.id) FILTER (WHERE 'NICE_ATMOSPHERE' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS nice_atmosphere,
      count(review.id) FILTER (WHERE 'GOOD_VALUE' = ANY(review.tags) AND (criteria_reset.since IS NULL OR review.created_at >= criteria_reset.since))::bigint AS good_value
    FROM requested
    JOIN criteria_reset ON criteria_reset.store_id = requested.store_id
    LEFT JOIN public.reviews AS review ON review.store_id = requested.store_id
    GROUP BY requested.store_id
  )
  SELECT
    aggregates.store_id,
    coalesce(aggregates.average_rating, 0),
    aggregates.review_count,
    jsonb_build_object(
      'GREAT_FOOD', aggregates.great_food,
      'FRIENDLY_STAFF', aggregates.friendly_staff,
      'NICE_ATMOSPHERE', aggregates.nice_atmosphere,
      'GOOD_VALUE', aggregates.good_value
    )
  FROM aggregates;
$$;


ALTER FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) IS 'Returns compact aggregate review summaries for the requested store IDs.';



CREATE OR REPLACE FUNCTION "public"."guard_restaurant_note_hidden_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an administrator can hide a note';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_restaurant_note_hidden_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false)
    AND EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_device_session"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL
      OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt
      WHERE exempt.user_id = (SELECT auth.uid())
        AND exempt.reason = 'test'
    ) THEN true
    WHEN NOT EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
    ) THEN EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    )
    ELSE EXISTS (
      SELECT 1 FROM public.members AS member
      WHERE member.user_id = (SELECT auth.uid())
        AND member.session_token = (SELECT auth.jwt() ->> 'session_id')
    )
  END;
$$;


ALTER FUNCTION "public"."is_current_device_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_valid_member_username"("value" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'pg_catalog'
    AS $_$
  WITH normalized AS (
    SELECT lower(normalize(btrim(value), NFKC)) AS name
  ), compact AS (
    SELECT name, regexp_replace(name, '_+', '', 'g') AS compact_name
    FROM normalized
  )
  SELECT char_length(name) BETWEEN 2 AND 20
    AND name ~ '^[a-z0-9_가-힣]+$'
    AND compact_name !~ '(admin|administrator|moderator|support|uvain|운영|관리|익명)'
    AND compact_name <> 'mod'
  FROM compact;
$_$;


ALTER FUNCTION "public"."is_valid_member_username"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_ten_restaurant_notes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.restaurant_notes
  where id in (
    select id from public.restaurant_notes
    where restaurant_id = new.restaurant_id
    order by created_at desc
    offset 10
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_ten_restaurant_notes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_admin_action"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  target_row jsonb;
  target_id text;
  changed text[] := ARRAY[]::text[];
  actor uuid := (SELECT auth.uid());
  login_role text := session_user::text;
  app_name text := nullif(current_setting('application_name', true), '');
BEGIN
  IF actor IS NOT NULL THEN
    -- Logged-in app user: only administrators' changes are audited.
    IF NOT public.is_admin() THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
  ELSIF login_role = 'authenticator' THEN
    -- API call without a user (service_role from Edge Functions): skipped,
    -- because those functions write their own audit entries.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    target_row := new_row;
    SELECT coalesce(array_agg(field_name ORDER BY field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_object_keys(new_row) AS fields(field_name)
    WHERE field_name NOT IN ('created_at', 'updated_at');
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    target_row := new_row;
    SELECT coalesce(array_agg(new_field.field_name ORDER BY new_field.field_name), ARRAY[]::text[])
      INTO changed
    FROM jsonb_each(new_row) AS new_field(field_name, field_value)
    WHERE old_row -> new_field.field_name IS DISTINCT FROM new_field.field_value
      AND new_field.field_name NOT IN ('created_at', 'updated_at');
    IF cardinality(changed) = 0 THEN RETURN NEW; END IF;
  ELSE
    old_row := to_jsonb(OLD);
    target_row := old_row;
  END IF;

  target_id := coalesce(
    target_row ->> 'id',
    target_row ->> 'user_id',
    target_row ->> 'partnership_id'
  );

  INSERT INTO public.admin_action_audit (
    actor_id, action, resource_type, resource_id, changed_fields, db_role, db_application
  ) VALUES (
    actor,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    changed,
    CASE WHEN actor IS NULL THEN login_role END,
    CASE WHEN actor IS NULL THEN left(app_name, 120) END
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_admin_action"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."major_to_faculty"("major" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when major is null or trim(major) = '' then 'Unknown'

    when major ilike any(array[
      '%Business%', '%Economics%', '%Econometrics%', '%Finance%', '%Accountancy%',
      '%Marketing%', '%Management%', '%Entrepreneurship%', '%Banking%',
      '%Real Estate%', '%Asset Management%', '%Corporate Finance%', '%Consumer Marketing%',
      '%Fiscale Economie%', '%Actuarial%', '%Quantitative Finance%'
    ]) then 'Business & Economics'

    when major ilike any(array[
      '%Artificial Intelligence%', '%Computer Science%', '%Data Science%', '%Analytics%',
      '%Biology%', '%Biomedical%', '%Chemistry%', '%Physics%', '%Astronomy%',
      '%Mathematics%', '%Medical Informatics%', '%Information Studies%',
      '%Earth Sciences%', '%Software Engineering%', '%Network Engineering%',
      '%Forensic Science%', '%Quantum%', '%Bioinformatics%', '%Molecular%'
    ]) then 'Science & Technology'

    when major ilike any(array[
      '%Law%', '%Recht%', '%LLM%', '%Criminal%', '%Tax Law%', '%European Union Law%',
      '%Competition Law%', '%Privaatrecht%', '%Publiekrecht%', '%Strafrecht%',
      '%Informatierecht%', '%Technology Governance%'
    ]) then 'Law'

    when major ilike any(array[
      '%Geneeskunde%', '%Medicine%', '%Tandheelkunde%', '%Dentistry%',
      '%Health%', '%Gezondheids%', '%Medical%'
    ]) then 'Medicine & Health'

    when major ilike any(array[
      '%Psychology%', '%Sociology%', '%Political%', '%Communication%',
      '%Anthropology%', '%Pedagog%', '%Education%', '%Onderwijs%',
      '%Human Geography%', '%Urban%', '%Social%', '%Cognition%',
      '%Brain%', '%Development%', '%Governance%', '%International Relations%',
      '%Gender%', '%Youth%', '%Coaching%', '%Human Resource%'
    ]) then 'Social Sciences & Psychology'

    when major ilike any(array[
      '%English%', '%Linguistics%', '%Literature%', '%Culture%', '%Ancient%',
      '%Archaeology%', '%History%', '%Geschiedenis%', '%Philosophy%', '%Filosofie%',
      '%Religion%', '%Religie%', '%Theology%', '%Arts%', '%Media%', '%Film%',
      '%Theatre%', '%Music%', '%Kunst%', '%European Studies%', '%American Studies%',
      '%Middle Eastern%', '%Translation%', '%Classics%', '%Journalism%',
      '%Heritage%', '%Museum%', '%Editor%', '%Redacteur%', '%Language%'
    ]) then 'Humanities & Languages'

    when major ilike any(array[
      '%Liberal Arts%', '%AUC%', '%PPLE%', '%Global%', '%Interdisciplinary%',
      '%Bèta-gamma%', '%Future Planet%', '%Universitaire Pabo%'
    ]) then 'Interdisciplinary'

    when major ilike any(array[
      '%Pre-Master%', '%Bridging%', '%MQP%', '%Qualifying Programme%'
    ]) then 'Pre-Master / Bridging'

    when major ilike any(array[
      '%Teaching%', '%Aardrijkskunde%', '%Algemene economie%', '%Biologie%',
      '%Duits%', '%Engels%', '%Frans%', '%Nederlands%', '%Wiskunde%',
      '%Scheikunde%', '%Natuurkunde%', '%Spaans%'
    ]) then 'Teaching Degree'

    else 'Other / Unknown'
  end;
$$;


ALTER FUNCTION "public"."major_to_faculty"("major" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_restaurant_comment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_username text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
begin
  select btrim(m.username), m.is_member, m.membership_valid_until
  into current_username, current_member_is_active, current_membership_valid_until
  from public.members m
  where m.user_id = auth.uid();

  if current_username is null or current_username = '' then
    raise exception 'username is required before commenting';
  end if;

  if current_member_is_active is not true
     or current_membership_valid_until is null
     or current_membership_valid_until < (now() at time zone 'Europe/Amsterdam')::date then
    raise exception 'only active members can comment';
  end if;

  normalized_body := btrim(new.body);
  compact_body := lower(regexp_replace(normalized_body, '\\s+', '', 'g'));
  if compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' then
    raise exception 'inappropriate language is not allowed';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then
      raise exception 'cannot comment for another user';
    end if;
    if exists (
      select 1 from public.restaurant_comments c
      where c.restaurant_id = new.restaurant_id
        and c.user_id = auth.uid()
        and (c.created_at at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date
    ) then
      raise exception 'one comment per restaurant per day';
    end if;
    new.username := current_username;
  else
    if old.user_id <> auth.uid() then
      raise exception 'cannot edit another user comment';
    end if;
    new.user_id := old.user_id;
    new.restaurant_id := old.restaurant_id;
    new.username := current_username;
  end if;

  new.body := normalized_body;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."prepare_restaurant_comment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_restaurant_note"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  requester_id uuid := (SELECT auth.uid());
  content_changed boolean;
  needs_author_checks boolean;
  owner_username text;
  owner_profile_image_url text;
  owner_is_active boolean;
  owner_membership_valid_until date;
  normalized_body text;
  compact_body text;
  trusted_review record;
  note_day date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM requester_id THEN
      RAISE EXCEPTION 'cannot leave a note for another user';
    END IF;
    content_changed := true;
    needs_author_checks := true;
  ELSE
    -- Identity and provenance never change after creation.
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.restaurant_id := OLD.restaurant_id;
    NEW.source_review_id := OLD.source_review_id;
    NEW.source_redemption_id := OLD.source_redemption_id;
    NEW.source_store_id := OLD.source_store_id;
    NEW.source_rating := OLD.source_rating;
    NEW.source_tags := OLD.source_tags;

    content_changed := NEW.body IS DISTINCT FROM OLD.body
      OR NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous;
    -- Making a note anonymous only hides the author, so it needs no author
    -- checks (used when a member clears their username). Any other content
    -- change must come from the active owner.
    needs_author_checks := NEW.body IS DISTINCT FROM OLD.body
      OR (NEW.is_anonymous IS DISTINCT FROM OLD.is_anonymous
          AND NEW.is_anonymous IS NOT TRUE);

    IF needs_author_checks AND OLD.user_id IS DISTINCT FROM requester_id THEN
      RAISE EXCEPTION 'cannot edit another user note';
    END IF;
  END IF;

  -- Author display always comes from the note owner, not the requester.
  SELECT btrim(m.username), m.profile_image_url,
         m.is_member, m.membership_valid_until
  INTO owner_username, owner_profile_image_url,
       owner_is_active, owner_membership_valid_until
  FROM public.members AS m
  WHERE m.user_id = NEW.user_id;

  IF needs_author_checks THEN
    IF owner_is_active IS NOT TRUE
       OR owner_membership_valid_until IS NULL
       OR owner_membership_valid_until < (now() AT TIME ZONE 'Europe/Amsterdam')::date THEN
      RAISE EXCEPTION 'only active members can leave notes';
    END IF;

    normalized_body := btrim(NEW.body);
    compact_body := lower(regexp_replace(normalized_body, '\s+', '', 'g'));
    IF compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' THEN
      RAISE EXCEPTION 'inappropriate language is not allowed';
    END IF;
    NEW.body := normalized_body;
  END IF;

  IF content_changed THEN
    NEW.updated_at := now();
  ELSE
    -- Moderation or profile refresh: content and its timestamp stay as they were.
    NEW.body := OLD.body;
    NEW.is_anonymous := OLD.is_anonymous;
    NEW.updated_at := OLD.updated_at;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source_review_id IS NOT NULL THEN
      SELECT r.id, r.redemption_id, r.store_id, r.rating, r.tags
      INTO trusted_review
      FROM public.reviews AS r
      JOIN public.redemptions AS d ON d.id = r.redemption_id
      JOIN public.restaurants AS restaurant
        ON restaurant.id = NEW.restaurant_id
       AND restaurant.partnership_id = r.store_id
      WHERE r.id = NEW.source_review_id
        AND r.user_id = requester_id
        AND d.user_id = requester_id
        AND d.store_id = r.store_id
        AND d.redeemed_at IS NOT NULL
        AND d.redeemed_at <= now();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'source review is not owned by this member or restaurant';
      END IF;

      IF owner_username IS NULL OR owner_username = '' THEN
        NEW.is_anonymous := true;
      END IF;
      NEW.source_redemption_id := trusted_review.redemption_id;
      NEW.source_store_id := trusted_review.store_id;
      NEW.source_rating := trusted_review.rating;
      NEW.source_tags := trusted_review.tags;
    ELSE
      IF owner_username IS NULL OR owner_username = '' THEN
        RAISE EXCEPTION 'username is required before leaving a note';
      END IF;

      NEW.source_review_id := NULL;
      NEW.source_redemption_id := NULL;
      NEW.source_store_id := NULL;
      NEW.source_rating := NULL;
      NEW.source_tags := NULL;
    END IF;

    note_day := (NEW.created_at AT TIME ZONE 'Europe/Amsterdam')::date;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        NEW.user_id::text || ':' || NEW.restaurant_id::text || ':' || note_day::text,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.restaurant_notes AS n
      WHERE n.restaurant_id = NEW.restaurant_id
        AND n.user_id = requester_id
        AND (n.created_at AT TIME ZONE 'Europe/Amsterdam')::date = note_day
    ) THEN
      RAISE EXCEPTION 'one note per restaurant per day';
    END IF;
  ELSIF needs_author_checks AND (owner_username IS NULL OR owner_username = '') THEN
    IF OLD.source_review_id IS NOT NULL OR NEW.is_anonymous IS TRUE THEN
      NEW.is_anonymous := true;
    ELSE
      RAISE EXCEPTION 'username is required before leaving a note';
    END IF;
  END IF;

  IF NEW.is_anonymous IS TRUE OR owner_username IS NULL OR owner_username = '' THEN
    NEW.username := '익명';
    NEW.profile_image_url := NULL;
    NEW.avatar_color_seed := NULL;
  ELSE
    NEW.username := owner_username;
    -- Build the path from the owner's id; never trust a stored path.
    NEW.profile_image_url := CASE
      WHEN owner_profile_image_url IS NOT NULL
        THEN 'avatars/' || NEW.user_id::text || '.jpg'
    END;
    NEW.avatar_color_seed := owner_username;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prepare_restaurant_note"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_stamp_card_size_change_after_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND NOT EXISTS (
       SELECT 1
       FROM public.stamp_card_config AS existing
       WHERE existing.restaurant_id = NEW.restaurant_id
     )
     AND (
       EXISTS (
         SELECT 1
         FROM public.stamp_card_visits AS visit
         WHERE visit.restaurant_id = NEW.restaurant_id
       )
       OR EXISTS (
         SELECT 1
         FROM public.stamp_card_rewards AS reward
         WHERE reward.restaurant_id = NEW.restaurant_id
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'STAMP_CARD_TOTAL_STAMPS_LOCKED: 스탬프 기록이 있는 카드의 총 칸 수는 변경할 수 없습니다. 기록을 초기화한 뒤 다시 시도해 주세요.';
  ELSIF TG_OP = 'UPDATE'
     AND (
       NEW.total_stamps IS DISTINCT FROM OLD.total_stamps
       OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     )
     AND (
       EXISTS (
         SELECT 1
         FROM public.stamp_card_visits AS visit
         WHERE visit.restaurant_id IN (OLD.restaurant_id, NEW.restaurant_id)
       )
       OR EXISTS (
         SELECT 1
         FROM public.stamp_card_rewards AS reward
         WHERE reward.restaurant_id IN (OLD.restaurant_id, NEW.restaurant_id)
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'STAMP_CARD_TOTAL_STAMPS_LOCKED: 스탬프 기록이 있는 카드의 총 칸 수는 변경할 수 없습니다. 기록을 초기화한 뒤 다시 시도해 주세요.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_stamp_card_size_change_after_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_expired_member_anonymizations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  queued_count integer := 0;
  affected_count integer := 0;
  inactive_count integer := 0;
BEGIN
  UPDATE public.members AS member
  SET membership_ended_at = membership_valid_until
  WHERE member.membership_ended_at IS NULL
    AND member.membership_valid_until IS NOT NULL
    AND member.membership_valid_until < current_date - interval '12 months'
    AND member.identity_anonymized_at IS NULL
    AND coalesce(member.is_test_account, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = member.user_id
    );

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_expired_member_ids (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.gdpr12_expired_member_ids;

  INSERT INTO pg_temp.gdpr12_expired_member_ids (user_id)
  SELECT result.anonymized_user_id
  FROM public.anonymize_expired_members_for_sheets() AS result
  WHERE result.anonymized_user_id IS NOT NULL
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.members AS member
  SET username = NULL,
      pending_student_number = NULL,
      is_member = false
  WHERE member.user_id IN (
    SELECT expired.user_id FROM pg_temp.gdpr12_expired_member_ids AS expired
  );

  INSERT INTO public.privacy_sheet_sync_queue (
    user_id, delete_auth_user, sync_master_sheet
  )
  SELECT expired.user_id, true, true
  FROM pg_temp.gdpr12_expired_member_ids AS expired
  ON CONFLICT (user_id) DO UPDATE
  SET delete_auth_user = true,
      sync_master_sheet = true,
      lease_until = NULL;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  CREATE TEMP TABLE IF NOT EXISTS gdpr12_inactive_account_ids (
    user_id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.gdpr12_inactive_account_ids;

  WITH stale_accounts AS (
    SELECT member.id
    FROM public.members AS member
    JOIN auth.users AS auth_user ON auth_user.id = member.user_id
    WHERE member.is_member IS FALSE
      AND member.membership_valid_until IS NULL
      AND member.membership_ended_at IS NULL
      AND member.identity_anonymized_at IS NULL
      AND member.account_status = 'active'
      AND auth_user.created_at < now() - interval '12 months'
      AND coalesce(member.is_test_account, false) IS FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_roles AS admin_role
        WHERE admin_role.user_id = member.user_id
      )
    ORDER BY auth_user.created_at, member.id
    FOR UPDATE OF member SKIP LOCKED
  ), scrubbed_accounts AS (
    UPDATE public.members AS member
    SET first_name = NULL,
        last_name = NULL,
        first_name_korean = NULL,
        last_name_korean = NULL,
        "University" = NULL,
        student_number = NULL,
        pending_student_number = NULL,
        major = NULL,
        education_level = NULL,
        year_number = NULL,
        year_of_birth = NULL,
        country_of_origin = NULL,
        gender = NULL,
        username = NULL,
        profile_image_url = NULL,
        session_token = NULL,
        is_member = false,
        account_status = 'anonymized',
        identity_anonymized_at = now()
    FROM stale_accounts
    WHERE member.id = stale_accounts.id
    RETURNING member.user_id
  )
  INSERT INTO pg_temp.gdpr12_inactive_account_ids (user_id)
  SELECT scrubbed_accounts.user_id
  FROM scrubbed_accounts
  WHERE scrubbed_accounts.user_id IS NOT NULL;

  SELECT count(*)::integer INTO inactive_count
  FROM pg_temp.gdpr12_inactive_account_ids;

  IF inactive_count > 0 THEN
    INSERT INTO public.privacy_action_log (action, record_count, details)
    VALUES (
      'anonymize_inactive_member_accounts',
      inactive_count,
      jsonb_build_object(
        'retention_rule', 'auth.users.created_at + 12 months; no membership dates',
        'auth_account_deletion_queued', true
      )
    );
  END IF;

  INSERT INTO public.privacy_sheet_sync_queue (
    user_id, delete_auth_user, sync_master_sheet
  )
  SELECT DISTINCT inactive.user_id, true, false
  FROM pg_temp.gdpr12_inactive_account_ids AS inactive
  ON CONFLICT (user_id) DO UPDATE
  SET delete_auth_user = true,
      sync_master_sheet = false,
      lease_until = NULL;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  queued_count := queued_count + affected_count;

  RETURN queued_count;
END;
$$;


ALTER FUNCTION "public"."queue_expired_member_anonymizations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") RETURNS TABLE("enabled" boolean, "already_stamped" boolean, "reward_pending" boolean, "cycle_completed" boolean, "current_count" integer, "new_count" integer, "card_cycle" integer, "total_stamps" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := clock_timestamp();
  v_total integer;
  v_prior_count integer;
  v_cycle integer;
  v_today_count integer;
  v_pending boolean;
  v_new_count integer;
BEGIN
  IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'user and restaurant are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_restaurant_id::text, 0)
  );

  SELECT GREATEST(1, c.total_stamps)
    INTO v_total
  FROM public.restaurants AS r
  JOIN public.stamp_card_config AS c ON c.restaurant_id = r.id
  WHERE r.id = p_restaurant_id
    AND r.stamp_card_enabled IS TRUE
    AND r.is_archived IS FALSE
  LIMIT 1;

  IF v_total IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stamp_card_rewards AS reward
    WHERE reward.user_id = p_user_id
      AND reward.restaurant_id = p_restaurant_id
      AND reward.redeemed IS FALSE
      AND (reward.expires_at IS NULL OR reward.expires_at > v_now)
  ) INTO v_pending;

  SELECT count(*)::integer INTO v_prior_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id AND visit.restaurant_id = p_restaurant_id;

  v_cycle := (v_prior_count / v_total) + 1;

  IF v_pending THEN
    RETURN QUERY SELECT true, false, true, true, v_prior_count % v_total, v_prior_count,
      v_cycle - 1, v_total;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_today_count
  FROM public.stamp_card_visits AS visit
  WHERE visit.user_id = p_user_id
    AND visit.restaurant_id = p_restaurant_id
    AND visit.added_by_admin IS FALSE
    AND (visit.visited_at AT TIME ZONE 'Europe/Amsterdam')::date =
        (v_now AT TIME ZONE 'Europe/Amsterdam')::date;

  IF v_today_count > 0 THEN
    RETURN QUERY SELECT true, true, false, false, v_prior_count % v_total, v_prior_count,
      v_cycle, v_total;
    RETURN;
  END IF;

  INSERT INTO public.stamp_card_visits (user_id, restaurant_id, visited_at, card_cycle, added_by_admin)
  VALUES (p_user_id, p_restaurant_id, v_now, v_cycle, false);

  v_new_count := v_prior_count + 1;
  IF v_new_count % v_total = 0 THEN
    INSERT INTO public.stamp_card_rewards (user_id, restaurant_id, card_cycle, redeemed)
    VALUES (p_user_id, p_restaurant_id, v_cycle, false)
    ON CONFLICT (user_id, restaurant_id, card_cycle) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true, false, false, (v_new_count % v_total = 0),
    v_new_count % v_total, v_new_count, v_cycle, v_total;
END;
$$;


ALTER FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_member_note_authors"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Touching the rows makes prepare_restaurant_note rebuild the author fields
  -- from this member row. Clearing the username also makes the member's
  -- existing notes permanently anonymous (as the old client sync did), so
  -- choosing a new username later does not reveal them.
  UPDATE public.restaurant_notes AS n
  SET is_anonymous = CASE
        WHEN NULLIF(btrim(NEW.username), '') IS NULL THEN true
        ELSE n.is_anonymous
      END
  WHERE n.user_id = NEW.user_id;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."refresh_member_note_authors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restaurants_track_review_criteria_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.review_criteria_since := CASE WHEN NEW.review_criteria IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.review_criteria IS DISTINCT FROM OLD.review_criteria THEN
    NEW.review_criteria_since := now();
  ELSE
    -- Only the trigger moves the reset time.
    NEW.review_criteria_since := OLD.review_criteria_since;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."restaurants_track_review_criteria_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_note_report_decision_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR
     NEW.decision IS DISTINCT FROM OLD.decision OR
     NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'only an administrator can resolve a report';
    END IF;

    IF NEW.status = 'pending' AND NEW.decision IS NULL THEN
      NEW.decision_reason := NULL;
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
      RETURN NEW;
    END IF;

    IF NEW.status <> 'resolved' OR NEW.decision IS NULL THEN
      RAISE EXCEPTION 'a resolved decision is required';
    END IF;

    NEW.decision_reason := NULL;
    NEW.reviewed_at := pg_catalog.now();
    NEW.reviewed_by := (SELECT auth.uid());
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_note_report_decision_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_report_reviewed_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ BEGIN NEW.reviewed_at := now(); NEW.reviewed_by := auth.uid(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_report_reviewed_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_report_submission_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.created_at := pg_catalog.now();
  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_report_submission_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
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


ALTER FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_member_analytics_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.member_analytics_profiles (
    user_id,
    university,
    region_of_origin,
    faculty_group,
    study_stage,
    age_group,
    gender,
    updated_at
  )
  values (
    new.user_id,
    new."University",
    public.country_to_region(new.country_of_origin),
    public.major_to_faculty(new.major),
    public.study_stage(new.education_level, new.year_number),
    public.birth_year_to_age_group(new.year_of_birth),
    new.gender,
    now()
  )
  on conflict (user_id) do update set
    university = excluded.university,
    region_of_origin = excluded.region_of_origin,
    faculty_group = excluded.faculty_group,
    study_stage = excluded.study_stage,
    age_group = excluded.age_group,
    gender = excluded.gender,
    updated_at = now();

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_member_analytics_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_membership_ended_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  -- active membership
  if new.membership_valid_until is not null
     and new.membership_valid_until >= current_date then
    new.membership_ended_at = null;
    new.account_status = 'active';
  end if;

  -- expired membership
  if new.membership_valid_until is not null
     and new.membership_valid_until < current_date
     and new.identity_anonymized_at is null then
    new.membership_ended_at = coalesce(new.membership_ended_at, new.membership_valid_until);
    new.account_status = 'expired';
  end if;

  -- already anonymized
  if new.identity_anonymized_at is not null then
    new.account_status = 'anonymized';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_membership_ended_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_partnership_apps_script_secret"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_partnership_apps_script_secret"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "first_name" "text",
    "student_number" "text",
    "major" "text",
    "is_member" boolean DEFAULT false,
    "membership_valid_until" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "session_token" "text",
    "University" "text",
    "last_name" "text",
    "year_of_birth" integer,
    "country_of_origin" "text",
    "gender" "text",
    "education_level" "text",
    "year_number" integer,
    "profile_image_url" "text",
    "first_name_korean" "text",
    "last_name_korean" "text",
    "membership_ended_at" "date",
    "identity_anonymized_at" timestamp with time zone,
    "privacy_policy_version" "text",
    "privacy_accepted_at" timestamp with time zone,
    "account_status" "text" DEFAULT 'active'::"text",
    "is_test_account" boolean DEFAULT false NOT NULL,
    "tutorial_completed_at" timestamp with time zone,
    "username" "text",
    "pending_student_number" "text",
    "sheet_member_ref" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "members_education_level_check" CHECK (("education_level" = ANY (ARRAY['foundation'::"text", 'bachelor'::"text", 'master'::"text", 'alumni'::"text"]))),
    CONSTRAINT "members_gender_check" CHECK (("gender" = ANY (ARRAY['male'::"text", 'female'::"text", 'non_binary'::"text", 'prefer_not_to_say'::"text"]))),
    CONSTRAINT "members_username_length_check" CHECK ((("username" IS NULL) OR "public"."is_valid_member_username"("username"))),
    CONSTRAINT "members_year_number_check" CHECK ((("year_number" IS NULL) OR (("year_number" >= 1) AND ("year_number" <= 4))))
);


ALTER TABLE "public"."members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."members"."student_number" IS 'Student number confirmed by an administrator; unique values are reserved here.';



COMMENT ON COLUMN "public"."members"."is_test_account" IS 'When true, QR check-ins return success without writing redemptions, stamp visits, rewards, or sheet logs.';



COMMENT ON COLUMN "public"."members"."tutorial_completed_at" IS 'Timestamp when the member completed the first-login welcome tour.';



COMMENT ON COLUMN "public"."members"."username" IS 'Member-selected public display name for community comments.';



COMMENT ON COLUMN "public"."members"."pending_student_number" IS 'Unverified student-number claim submitted during registration; not unique and not valid for membership display.';



CREATE TABLE IF NOT EXISTS "public"."redemptions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "gen_random_uuid"(),
    "store_id" "text",
    "redeemed_at" timestamp with time zone
);


ALTER TABLE "public"."redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "address" "text",
    "latitude" double precision,
    "longitude" double precision,
    "discount_info" "text",
    "rating" double precision DEFAULT 0,
    "review" "text",
    "reviewer_name" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text" DEFAULT '맛집'::"text",
    "price_range" "text" DEFAULT ''::"text",
    "is_sponsored" boolean DEFAULT false,
    "image_urls" "text"[] DEFAULT '{}'::"text"[],
    "discount_terms" "text" DEFAULT ''::"text",
    "map_label" "text" DEFAULT ''::"text",
    "partnership_id" "text",
    "one_line_review" "text",
    "show_rating" boolean DEFAULT true NOT NULL,
    "stamp_card_enabled" boolean DEFAULT false NOT NULL,
    "spot_card_height" "text" DEFAULT 'compact'::"text" NOT NULL,
    "show_google_maps_button" boolean DEFAULT true NOT NULL,
    "usullang_star_count" smallint DEFAULT 0 NOT NULL,
    "show_usullang_stars" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "commercial_display_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "review_box_type" "text" DEFAULT 'usullang'::"text" NOT NULL,
    "scrap_board" "jsonb" DEFAULT '{"h": 380, "v": 1, "items": []}'::"jsonb" NOT NULL,
    "review_criteria" "jsonb",
    "review_criteria_since" timestamp with time zone,
    CONSTRAINT "restaurants_commercial_display_type_check" CHECK (("commercial_display_type" = ANY (ARRAY['none'::"text", 'member_discount'::"text", 'paid_ad'::"text"]))),
    CONSTRAINT "restaurants_review_box_type_check" CHECK (("review_box_type" = ANY (ARRAY['usullang'::"text", 'scrap'::"text", 'scrap_rating'::"text"]))),
    CONSTRAINT "restaurants_review_criteria_shape_check" CHECK ((("review_criteria" IS NULL) OR (("jsonb_typeof"("review_criteria") = 'array'::"text") AND ("jsonb_array_length"("review_criteria") = 4) AND ("pg_column_size"("review_criteria") <= 4096)))),
    CONSTRAINT "restaurants_scrap_board_shape_check" CHECK ((("jsonb_typeof"("scrap_board") = 'object'::"text") AND ("jsonb_typeof"(("scrap_board" -> 'items'::"text")) = 'array'::"text") AND ("jsonb_array_length"(("scrap_board" -> 'items'::"text")) <= 60) AND ("pg_column_size"("scrap_board") <= 65536))),
    CONSTRAINT "restaurants_spot_card_height_check" CHECK (("spot_card_height" = ANY (ARRAY['compact'::"text", 'full'::"text"]))),
    CONSTRAINT "restaurants_usullang_star_count_check" CHECK ((("usullang_star_count" >= 0) AND ("usullang_star_count" <= 3)))
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."restaurants"."one_line_review" IS '한 줄 평가 – shown on SpotCard between photos and 멤버 리뷰';



COMMENT ON COLUMN "public"."restaurants"."usullang_star_count" IS 'Admin-curated 0–3 우슐랭 stars displayed only on full SpotCards.';



COMMENT ON COLUMN "public"."restaurants"."show_usullang_stars" IS 'Whether the three 우슐랭 stars are displayed on a full SpotCard.';



COMMENT ON COLUMN "public"."restaurants"."commercial_display_type" IS 'Public disclosure label for member discounts or paid advertising';



COMMENT ON COLUMN "public"."restaurants"."review_box_type" IS 'First slide of the SpotCard review box: usullang (default), scrap (낙서장), or scrap_rating (낙서장 + 멤버 평가).';



COMMENT ON COLUMN "public"."restaurants"."scrap_board" IS '낙서장 board JSON {v, h, items[]} edited by admins; photos must be in the place-images bucket.';



COMMENT ON COLUMN "public"."restaurants"."review_criteria" IS '멤버 평가 criteria for the 4 review tag slots: [{label, icon}] x4, or NULL for the default restaurant criteria.';



COMMENT ON COLUMN "public"."restaurants"."review_criteria_since" IS 'Set automatically when review_criteria changes; 멤버 평가 tag counts include only reviews from this time.';



CREATE TABLE IF NOT EXISTS "public"."stamp_card_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "card_cycle" integer NOT NULL,
    "redeemed" boolean DEFAULT false NOT NULL,
    "redeemed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "delete_after" timestamp with time zone
);


ALTER TABLE "public"."stamp_card_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stamp_card_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "visited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "card_cycle" integer DEFAULT 1 NOT NULL,
    "added_by_admin" boolean DEFAULT false NOT NULL,
    "admin_note" "text"
);


ALTER TABLE "public"."stamp_card_visits" OWNER TO "postgres";


CREATE OR REPLACE VIEW "private"."admin_member_scan_audit" WITH ("security_invoker"='true') AS
 SELECT 'discount_scan'::"text" AS "event_type",
    ("r"."redeemed_at" AT TIME ZONE 'Europe/Amsterdam'::"text") AS "event_at_amsterdam",
    "r"."store_id" AS "partnership_id",
    COALESCE("rest"."name", "r"."store_id") AS "store_name",
    ("r"."id")::"text" AS "event_id",
    "r"."user_id" AS "member_user_id",
    "u"."email" AS "member_email",
    "concat_ws"(' '::"text", NULLIF("m"."first_name", ''::"text"), NULLIF("m"."last_name", ''::"text")) AS "member_name",
    "m"."student_number",
    "m"."username",
    "m"."is_member",
    "m"."membership_valid_until",
    "m"."account_status",
    NULL::integer AS "stamp_card_cycle",
    NULL::boolean AS "added_by_admin",
    NULL::boolean AS "reward_claimed",
    "m"."sheet_member_ref" AS "member_ref"
   FROM ((("public"."redemptions" "r"
     JOIN "public"."members" "m" ON (("m"."user_id" = "r"."user_id")))
     LEFT JOIN "auth"."users" "u" ON (("u"."id" = "r"."user_id")))
     LEFT JOIN "public"."restaurants" "rest" ON (("rest"."partnership_id" = "r"."store_id")))
UNION ALL
 SELECT 'stamp_visit'::"text" AS "event_type",
    ("v"."visited_at" AT TIME ZONE 'Europe/Amsterdam'::"text") AS "event_at_amsterdam",
    "rest"."partnership_id",
    "rest"."name" AS "store_name",
    ("v"."id")::"text" AS "event_id",
    "v"."user_id" AS "member_user_id",
    "u"."email" AS "member_email",
    "concat_ws"(' '::"text", NULLIF("m"."first_name", ''::"text"), NULLIF("m"."last_name", ''::"text")) AS "member_name",
    "m"."student_number",
    "m"."username",
    "m"."is_member",
    "m"."membership_valid_until",
    "m"."account_status",
    "v"."card_cycle" AS "stamp_card_cycle",
    "v"."added_by_admin",
    NULL::boolean AS "reward_claimed",
    "m"."sheet_member_ref" AS "member_ref"
   FROM ((("public"."stamp_card_visits" "v"
     JOIN "public"."members" "m" ON (("m"."user_id" = "v"."user_id")))
     LEFT JOIN "auth"."users" "u" ON (("u"."id" = "v"."user_id")))
     JOIN "public"."restaurants" "rest" ON (("rest"."id" = "v"."restaurant_id")))
UNION ALL
 SELECT 'stamp_reward_claim'::"text" AS "event_type",
    ("reward"."redeemed_at" AT TIME ZONE 'Europe/Amsterdam'::"text") AS "event_at_amsterdam",
    "rest"."partnership_id",
    "rest"."name" AS "store_name",
    ("reward"."id")::"text" AS "event_id",
    "reward"."user_id" AS "member_user_id",
    "u"."email" AS "member_email",
    "concat_ws"(' '::"text", NULLIF("m"."first_name", ''::"text"), NULLIF("m"."last_name", ''::"text")) AS "member_name",
    "m"."student_number",
    "m"."username",
    "m"."is_member",
    "m"."membership_valid_until",
    "m"."account_status",
    "reward"."card_cycle" AS "stamp_card_cycle",
    NULL::boolean AS "added_by_admin",
    "reward"."redeemed" AS "reward_claimed",
    "m"."sheet_member_ref" AS "member_ref"
   FROM ((("public"."stamp_card_rewards" "reward"
     JOIN "public"."members" "m" ON (("m"."user_id" = "reward"."user_id")))
     LEFT JOIN "auth"."users" "u" ON (("u"."id" = "reward"."user_id")))
     JOIN "public"."restaurants" "rest" ON (("rest"."id" = "reward"."restaurant_id")))
  WHERE (("reward"."redeemed" IS TRUE) AND ("reward"."redeemed_at" IS NOT NULL));


ALTER VIEW "private"."admin_member_scan_audit" OWNER TO "postgres";


COMMENT ON VIEW "private"."admin_member_scan_audit" IS 'Owner-only event audit joined to member email, student number, store, and opaque sheet reference. Filter by partnership_id for one store.';



CREATE TABLE IF NOT EXISTS "public"."admin_action_audit" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "changed_fields" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "db_role" "text",
    "db_application" "text"
);


ALTER TABLE "public"."admin_action_audit" OWNER TO "postgres";


ALTER TABLE "public"."admin_action_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_action_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkin_review_decisions" (
    "user_id" "uuid" NOT NULL,
    "reviewed_through" timestamp with time zone NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_by" "uuid"
);


ALTER TABLE "public"."checkin_review_decisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkin_sheet_queue" (
    "id" bigint NOT NULL,
    "redemption_id" bigint NOT NULL,
    "target" "text" NOT NULL,
    "store_id" "text" NOT NULL,
    "stamp_status" "text" DEFAULT ''::"text" NOT NULL,
    "stamp_progress" "text" DEFAULT ''::"text" NOT NULL,
    "stamp_card_claimed_after_scan" boolean DEFAULT false NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checkin_sheet_queue_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 60))),
    CONSTRAINT "checkin_sheet_queue_stamp_progress_check" CHECK (("char_length"("stamp_progress") <= 20)),
    CONSTRAINT "checkin_sheet_queue_stamp_status_check" CHECK (("char_length"("stamp_status") <= 40)),
    CONSTRAINT "checkin_sheet_queue_store_id_check" CHECK ((("char_length"("store_id") >= 1) AND ("char_length"("store_id") <= 200))),
    CONSTRAINT "checkin_sheet_queue_target_check" CHECK (("target" = ANY (ARRAY['master'::"text", 'partner'::"text"])))
);


ALTER TABLE "public"."checkin_sheet_queue" OWNER TO "postgres";


ALTER TABLE "public"."checkin_sheet_queue" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."checkin_sheet_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."content_report_notice_log" (
    "report_id" "uuid" NOT NULL,
    "recipient_kind" "text" NOT NULL,
    "content_digest" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_report_notice_log_content_digest_check" CHECK ((("char_length"("content_digest") >= 16) AND ("char_length"("content_digest") <= 64))),
    CONSTRAINT "content_report_notice_log_recipient_kind_check" CHECK (("recipient_kind" = ANY (ARRAY['reporter'::"text", 'author'::"text"])))
);


ALTER TABLE "public"."content_report_notice_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_rate_limits" (
    "key_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "edge_rate_limits_key_hash_check" CHECK (("length"("key_hash") = 64)),
    CONSTRAINT "edge_rate_limits_request_count_check" CHECK (("request_count" > 0))
);


ALTER TABLE "public"."edge_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_confirmation_return_signals" (
    "token_hash" "text" NOT NULL,
    "status" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "email_confirmation_return_signals_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text", 'registration_error'::"text", 'email_change_error'::"text"]))),
    CONSTRAINT "email_confirmation_return_signals_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."email_confirmation_return_signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "event_date" timestamp with time zone,
    "location" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "instagram_url" "text",
    "image_urls" "text"[] DEFAULT '{}'::"text"[],
    "is_archived" boolean DEFAULT false,
    "event_end_date" timestamp with time zone,
    "event_dates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "calendar_highlight_mode" "text" DEFAULT 'separate'::"text" NOT NULL,
    "participation_url" "text",
    "is_registration_closed" boolean DEFAULT false NOT NULL,
    "location_description" "text",
    "show_participation_button" boolean DEFAULT true NOT NULL,
    "participation_without_signup" boolean DEFAULT false NOT NULL,
    CONSTRAINT "events_calendar_highlight_mode_check" CHECK (("calendar_highlight_mode" = ANY (ARRAY['separate'::"text", 'range'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."participation_without_signup" IS 'When true, the event participation button is displayed as the non-clickable status "신청 없이 참여".';



CREATE TABLE IF NOT EXISTS "public"."legal_consent_receipts" (
    "user_id" "uuid" NOT NULL,
    "document_key" "text" NOT NULL,
    "document_version" "text" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_consent_receipts_document_key_check" CHECK (("document_key" = ANY (ARRAY['terms'::"text", 'privacy'::"text", 'community'::"text", 'age_16_plus'::"text"]))),
    CONSTRAINT "legal_consent_receipts_document_version_check" CHECK ((("length"("document_version") >= 1) AND ("length"("document_version") <= 80)))
);


ALTER TABLE "public"."legal_consent_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_otp_exempt_users" (
    "user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "login_otp_exempt_users_reason_check" CHECK (("reason" = ANY (ARRAY['admin'::"text", 'test'::"text"])))
);


ALTER TABLE "public"."login_otp_exempt_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_otp_verified_sessions" (
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "verified_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."login_otp_verified_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_analytics_profiles" (
    "user_id" "uuid" NOT NULL,
    "university" "text",
    "region_of_origin" "text",
    "faculty_group" "text",
    "study_stage" "text",
    "age_group" "text",
    "gender" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."member_analytics_profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."partner_monthly_insights_view" WITH ("security_invoker"='true') AS
 SELECT "v"."restaurant_id",
    ("date_trunc"('month'::"text", "v"."visited_at"))::"date" AS "report_month",
    "count"(*) AS "total_scans",
    "count"(DISTINCT "v"."user_id") AS "unique_visitors",
    "a"."university",
    "a"."region_of_origin",
    "a"."faculty_group",
    "a"."study_stage",
    "a"."age_group",
    "a"."gender",
    "count"(DISTINCT "v"."user_id") AS "visitors_in_segment",
    "count"(*) AS "scans_in_segment"
   FROM ("public"."stamp_card_visits" "v"
     LEFT JOIN "public"."member_analytics_profiles" "a" ON (("a"."user_id" = "v"."user_id")))
  GROUP BY "v"."restaurant_id", (("date_trunc"('month'::"text", "v"."visited_at"))::"date"), "a"."university", "a"."region_of_origin", "a"."faculty_group", "a"."study_stage", "a"."age_group", "a"."gender"
 HAVING ("count"(DISTINCT "v"."user_id") >= 5);


ALTER VIEW "public"."partner_monthly_insights_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."partner_monthly_insights_owner_view" WITH ("security_invoker"='true') AS
 SELECT "restaurant_id",
    "report_month",
    "total_scans",
    "unique_visitors",
    "university",
    "region_of_origin",
    "faculty_group",
    "study_stage",
    "age_group",
    "gender",
    "visitors_in_segment",
    "scans_in_segment"
   FROM "public"."partner_monthly_insights_view";


ALTER VIEW "public"."partner_monthly_insights_owner_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."partner_operations_view" WITH ("security_invoker"='true') AS
 SELECT "v"."restaurant_id",
    ("v"."visited_at")::"date" AS "scan_date",
    "to_char"("v"."visited_at", 'HH24:MI'::"text") AS "scan_time",
    ("v"."id")::"text" AS "scan_id",
    "v"."card_cycle",
    COALESCE("r"."redeemed", false) AS "reward_redeemed",
    ("r"."id")::"text" AS "reward_id",
    "r"."redeemed_at",
        CASE
            WHEN (COALESCE("r"."redeemed", false) = true) THEN 'Redeemed'::"text"
            WHEN ("r"."id" IS NOT NULL) THEN 'Reward Available'::"text"
            ELSE 'Active'::"text"
        END AS "reward_status"
   FROM ("public"."stamp_card_visits" "v"
     LEFT JOIN "public"."stamp_card_rewards" "r" ON ((("r"."user_id" = "v"."user_id") AND ("r"."restaurant_id" = "v"."restaurant_id") AND ("r"."card_cycle" = "v"."card_cycle"))));


ALTER VIEW "public"."partner_operations_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."partner_operations_owner_view" WITH ("security_invoker"='true') AS
 SELECT "restaurant_id",
    "scan_date",
    "scan_time",
    "scan_id",
    "card_cycle",
    "reward_redeemed",
    "reward_id",
    "redeemed_at",
    "reward_status"
   FROM "public"."partner_operations_view";


ALTER VIEW "public"."partner_operations_owner_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partnership_apps_script_secrets" (
    "partnership_id" "text" NOT NULL,
    "secret" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "partnership_apps_script_secrets_secret_check" CHECK (("length"("secret") >= 32))
);


ALTER TABLE "public"."partnership_apps_script_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partnership_integrations" (
    "partnership_id" "text" NOT NULL,
    "master_apps_script_url" "text",
    "partner_apps_script_url" "text",
    "partner_sheet_url" "text"
);


ALTER TABLE "public"."partnership_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."partnerships" (
    "id" "text" NOT NULL,
    "sheet_name" "text" NOT NULL,
    "master_apps_script_url" "text",
    "name" "text" NOT NULL,
    "partner_sheet_url" "text",
    "partner_apps_script_url" "text"
);


ALTER TABLE "public"."partnerships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."password_reset_return_signals" (
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "password_reset_return_signals_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."password_reset_return_signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_email_changes" (
    "new_user_id" "uuid" NOT NULL,
    "old_user_id" "uuid" NOT NULL,
    "new_email" "text" NOT NULL,
    "original_created_at" timestamp with time zone NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pending_email_changes_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'transferred'::"text"])))
);


ALTER TABLE "public"."pending_email_changes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."privacy_action_log" (
    "id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "now"(),
    "record_count" integer DEFAULT 0 NOT NULL,
    "details" "jsonb"
);


ALTER TABLE "public"."privacy_action_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."privacy_action_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."privacy_action_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."privacy_action_log_id_seq" OWNED BY "public"."privacy_action_log"."id";



CREATE TABLE IF NOT EXISTS "public"."privacy_sheet_sync_queue" (
    "user_id" "uuid" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lease_until" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "delete_auth_user" boolean DEFAULT false NOT NULL,
    "sync_master_sheet" boolean DEFAULT true NOT NULL,
    "database_done" boolean DEFAULT false NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "privacy_sheet_sync_queue_attempts_check" CHECK (("attempts" >= 0))
);


ALTER TABLE "public"."privacy_sheet_sync_queue" OWNER TO "postgres";


ALTER TABLE "public"."redemptions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."redemptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."restaurant_comment_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid"
);


ALTER TABLE "public"."restaurant_comment_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "restaurant_comments_body_check" CHECK ((("char_length"("btrim"("body")) >= 1) AND ("char_length"("btrim"("body")) <= 200)))
);


ALTER TABLE "public"."restaurant_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."restaurant_comments" IS 'Newest ten member comments per restaurant, with a one-comment-per-Europe/Amsterdam-day rule.';



CREATE OR REPLACE VIEW "public"."restaurant_comments_safe" WITH ("security_barrier"='true') AS
 SELECT "id",
    "restaurant_id",
    ("user_id" = ( SELECT "auth"."uid"() AS "uid")) AS "is_mine",
        CASE
            WHEN "is_anonymous" THEN '익명'::"text"
            ELSE "username"
        END AS "username",
    "is_anonymous",
    "body",
    "created_at",
    "updated_at",
        CASE
            WHEN "is_anonymous" THEN false
            ELSE (EXISTS ( SELECT 1
               FROM "public"."admin_roles" "admin_role"
              WHERE ("admin_role"."user_id" = "comment"."user_id")))
        END AS "author_is_admin"
   FROM "public"."restaurant_comments" "comment"
  WHERE ((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text") AND "public"."is_current_device_session"());


ALTER VIEW "public"."restaurant_comments_safe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_note_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid",
    "reporter_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reporter_name" "text",
    "reporter_email" "text",
    "reason" "text",
    "explanation" "text",
    "good_faith" boolean,
    "note_snapshot" "text",
    "restaurant_name_snapshot" "text",
    "content_author_id" "uuid",
    "content_author_email" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decision" "text",
    "decision_reason" "text",
    "content_author_name_snapshot" "text",
    CONSTRAINT "restaurant_note_reports_decision_check" CHECK ((("decision" IS NULL) OR ("decision" = ANY (ARRAY['no_action'::"text", 'content_hidden'::"text", 'content_deleted'::"text"])))),
    CONSTRAINT "restaurant_note_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."restaurant_note_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_review_id" "uuid",
    "source_redemption_id" bigint,
    "source_store_id" "text",
    "source_rating" numeric,
    "source_tags" "text"[],
    "profile_image_url" "text",
    "avatar_color_seed" "text",
    "hidden_at" timestamp with time zone,
    CONSTRAINT "restaurant_notes_body_check" CHECK ((("char_length"("btrim"("body")) >= 1) AND ("char_length"("btrim"("body")) <= 200)))
);


ALTER TABLE "public"."restaurant_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."restaurant_notes" IS 'Newest ten Good to Know Notes per restaurant, with a one-note-per-Europe/Amsterdam-day rule.';



CREATE OR REPLACE VIEW "public"."restaurant_notes_safe" WITH ("security_barrier"='true') AS
 SELECT "id",
    "restaurant_id",
    ("user_id" = ( SELECT "auth"."uid"() AS "uid")) AS "is_mine",
        CASE
            WHEN "is_anonymous" THEN '익명'::"text"
            ELSE "username"
        END AS "username",
        CASE
            WHEN "is_anonymous" THEN NULL::"text"
            ELSE "username"
        END AS "avatar_color_seed",
    NULL::"text" AS "profile_image_url",
    "is_anonymous",
    "body",
    "created_at",
    "updated_at",
        CASE
            WHEN ("user_id" = ( SELECT "auth"."uid"() AS "uid")) THEN "source_redemption_id"
            ELSE NULL::bigint
        END AS "source_redemption_id",
        CASE
            WHEN ("user_id" = ( SELECT "auth"."uid"() AS "uid")) THEN "source_store_id"
            ELSE NULL::"text"
        END AS "source_store_id",
        CASE
            WHEN ("user_id" = ( SELECT "auth"."uid"() AS "uid")) THEN "source_rating"
            ELSE NULL::numeric
        END AS "source_rating",
        CASE
            WHEN ("user_id" = ( SELECT "auth"."uid"() AS "uid")) THEN "source_tags"
            ELSE NULL::"text"[]
        END AS "source_tags",
        CASE
            WHEN "is_anonymous" THEN false
            ELSE (EXISTS ( SELECT 1
               FROM "public"."admin_roles" "admin_role"
              WHERE ("admin_role"."user_id" = "note"."user_id")))
        END AS "author_is_admin",
    (EXISTS ( SELECT 1
           FROM ("public"."redemptions" "redemption"
             JOIN "public"."restaurants" "restaurant" ON ((("restaurant"."id" = "note"."restaurant_id") AND ("restaurant"."partnership_id" = "redemption"."store_id"))))
          WHERE (("redemption"."user_id" = "note"."user_id") AND ("redemption"."redeemed_at" IS NOT NULL) AND ("redemption"."redeemed_at" <= "note"."created_at")))) AS "is_visit_verified",
    (("is_anonymous" IS NOT TRUE) AND ("profile_image_url" IS NOT NULL)) AS "has_author_photo"
   FROM "public"."restaurant_notes" "note"
  WHERE (("hidden_at" IS NULL) AND (( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text") AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session"));


ALTER VIEW "public"."restaurant_notes_safe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "redemption_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "store_id" "text" NOT NULL,
    "prompt_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_prompts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'submitted'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."review_prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_sheet_queue" (
    "id" bigint NOT NULL,
    "redemption_id" bigint NOT NULL,
    "target" "text" NOT NULL,
    "store_id" "text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_sheet_queue_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 60))),
    CONSTRAINT "review_sheet_queue_store_id_check" CHECK ((("char_length"("store_id") >= 1) AND ("char_length"("store_id") <= 200))),
    CONSTRAINT "review_sheet_queue_target_check" CHECK (("target" = ANY (ARRAY['master'::"text", 'partner'::"text"])))
);


ALTER TABLE "public"."review_sheet_queue" OWNER TO "postgres";


ALTER TABLE "public"."review_sheet_queue" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."review_sheet_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "redemption_id" bigint NOT NULL,
    "user_id" "uuid",
    "store_id" "text" NOT NULL,
    "rating" numeric(3,1) NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_comment_length" CHECK ((("comment" IS NULL) OR ("char_length"("comment") <= 200))),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 0.5) AND ("rating" <= 5.0) AND (("rating" * (2)::numeric) = "floor"(("rating" * (2)::numeric))))),
    CONSTRAINT "reviews_tags_known" CHECK ((("tags" IS NULL) OR ("tags" <@ ARRAY['GREAT_FOOD'::"text", 'FRIENDLY_STAFF'::"text", 'NICE_ATMOSPHERE'::"text", 'GOOD_VALUE'::"text"])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reward_claim_sheet_queue" (
    "id" bigint NOT NULL,
    "reward_id" "uuid" NOT NULL,
    "target" "text" NOT NULL,
    "store_id" "text" NOT NULL,
    "redemption_id" bigint NOT NULL,
    "claimed_at" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reward_claim_sheet_queue_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 60))),
    CONSTRAINT "reward_claim_sheet_queue_store_id_check" CHECK ((("char_length"("store_id") >= 1) AND ("char_length"("store_id") <= 200))),
    CONSTRAINT "reward_claim_sheet_queue_target_check" CHECK (("target" = ANY (ARRAY['master'::"text", 'partner'::"text"])))
);


ALTER TABLE "public"."reward_claim_sheet_queue" OWNER TO "postgres";


ALTER TABLE "public"."reward_claim_sheet_queue" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."reward_claim_sheet_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."stamp_card_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "total_stamps" integer DEFAULT 10 NOT NULL,
    "stamps_per_row" integer DEFAULT 5 NOT NULL,
    "title" "text",
    "subtitle" "text",
    "reward_text" "text",
    "accent_color" "text" DEFAULT '#ef4444'::"text" NOT NULL,
    "text_color" "text" DEFAULT '#ffffff'::"text" NOT NULL,
    "wallpaper_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "background_color" "text" DEFAULT '#ffffff'::"text" NOT NULL,
    "stamp_color" "text" DEFAULT '#111827'::"text" NOT NULL
);


ALTER TABLE "public"."stamp_card_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stamp_card_rewards_archive" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "card_cycle" integer NOT NULL,
    "redeemed" boolean NOT NULL,
    "redeemed_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_by" "uuid" NOT NULL,
    "delete_after" timestamp with time zone DEFAULT ("now"() + '1 year'::interval) NOT NULL
);


ALTER TABLE "public"."stamp_card_rewards_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stamp_card_visits_archive" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "visited_at" timestamp with time zone NOT NULL,
    "card_cycle" integer NOT NULL,
    "added_by_admin" boolean NOT NULL,
    "admin_note" "text",
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_by" "uuid" NOT NULL,
    "delete_after" timestamp with time zone DEFAULT ("now"() + '1 year'::interval) NOT NULL
);


ALTER TABLE "public"."stamp_card_visits_archive" OWNER TO "postgres";


ALTER TABLE ONLY "public"."privacy_action_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."privacy_action_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_action_audit"
    ADD CONSTRAINT "admin_action_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."checkin_review_decisions"
    ADD CONSTRAINT "checkin_review_decisions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."checkin_sheet_queue"
    ADD CONSTRAINT "checkin_sheet_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkin_sheet_queue"
    ADD CONSTRAINT "checkin_sheet_queue_redemption_id_target_key" UNIQUE ("redemption_id", "target");



ALTER TABLE ONLY "public"."content_report_notice_log"
    ADD CONSTRAINT "content_report_notice_log_pkey" PRIMARY KEY ("report_id", "recipient_kind", "content_digest");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("key_hash");



ALTER TABLE ONLY "public"."email_confirmation_return_signals"
    ADD CONSTRAINT "email_confirmation_return_signals_pkey" PRIMARY KEY ("token_hash");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_consent_receipts"
    ADD CONSTRAINT "legal_consent_receipts_pkey" PRIMARY KEY ("user_id", "document_key", "document_version");



ALTER TABLE ONLY "public"."login_otp_exempt_users"
    ADD CONSTRAINT "login_otp_exempt_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."login_otp_verified_sessions"
    ADD CONSTRAINT "login_otp_verified_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."login_otp_verified_sessions"
    ADD CONSTRAINT "login_otp_verified_sessions_user_session_unique" UNIQUE ("user_id", "session_id");



ALTER TABLE ONLY "public"."member_analytics_profiles"
    ADD CONSTRAINT "member_analytics_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_student_number_key" UNIQUE ("student_number");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."partnership_apps_script_secrets"
    ADD CONSTRAINT "partnership_apps_script_secrets_pkey" PRIMARY KEY ("partnership_id");



ALTER TABLE ONLY "public"."partnership_integrations"
    ADD CONSTRAINT "partnership_integrations_pkey" PRIMARY KEY ("partnership_id");



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."password_reset_return_signals"
    ADD CONSTRAINT "password_reset_return_signals_pkey" PRIMARY KEY ("token_hash");



ALTER TABLE ONLY "public"."pending_email_changes"
    ADD CONSTRAINT "pending_email_changes_old_user_id_key" UNIQUE ("old_user_id");



ALTER TABLE ONLY "public"."pending_email_changes"
    ADD CONSTRAINT "pending_email_changes_pkey" PRIMARY KEY ("new_user_id");



ALTER TABLE ONLY "public"."privacy_action_log"
    ADD CONSTRAINT "privacy_action_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."privacy_sheet_sync_queue"
    ADD CONSTRAINT "privacy_sheet_sync_queue_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."redemptions"
    ADD CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_comment_id_reporter_id_key" UNIQUE ("comment_id", "reporter_id");



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_note_id_reporter_id_key" UNIQUE ("note_id", "reporter_id");



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_notes"
    ADD CONSTRAINT "restaurant_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_redemption_id_key" UNIQUE ("redemption_id");



ALTER TABLE ONLY "public"."review_sheet_queue"
    ADD CONSTRAINT "review_sheet_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_sheet_queue"
    ADD CONSTRAINT "review_sheet_queue_redemption_id_target_key" UNIQUE ("redemption_id", "target");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_redemption_id_key" UNIQUE ("redemption_id");



ALTER TABLE ONLY "public"."reward_claim_sheet_queue"
    ADD CONSTRAINT "reward_claim_sheet_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_claim_sheet_queue"
    ADD CONSTRAINT "reward_claim_sheet_queue_reward_id_target_key" UNIQUE ("reward_id", "target");



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."stamp_card_rewards_archive"
    ADD CONSTRAINT "stamp_card_rewards_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_visits_archive"
    ADD CONSTRAINT "stamp_card_visits_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_action_audit_actor_created_at_idx" ON "public"."admin_action_audit" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "admin_action_audit_created_at_idx" ON "public"."admin_action_audit" USING "btree" ("created_at" DESC);



CREATE INDEX "admin_action_audit_resource_idx" ON "public"."admin_action_audit" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "checkin_sheet_queue_due_idx" ON "public"."checkin_sheet_queue" USING "btree" ("next_attempt_at");



CREATE INDEX "email_confirmation_return_signals_expiry_idx" ON "public"."email_confirmation_return_signals" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "login_otp_exempt_users_single_test_account" ON "public"."login_otp_exempt_users" USING "btree" ("reason") WHERE ("reason" = 'test'::"text");



CREATE INDEX "members_pending_student_number_idx" ON "public"."members" USING "btree" ("pending_student_number") WHERE ("pending_student_number" IS NOT NULL);



CREATE UNIQUE INDEX "members_sheet_member_ref_uidx" ON "public"."members" USING "btree" ("sheet_member_ref");



CREATE UNIQUE INDEX "members_username_canonical_unique" ON "public"."members" USING "btree" ("regexp_replace"("lower"(NORMALIZE("btrim"("username"), NFKC)), '[_-]+'::"text", ''::"text", 'g'::"text")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "members_username_lower_unique" ON "public"."members" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE INDEX "privacy_sheet_sync_queue_claim_idx" ON "public"."privacy_sheet_sync_queue" USING "btree" ("database_done", "next_attempt_at", "queued_at");



CREATE INDEX "redemptions_user_redeemed_idx" ON "public"."redemptions" USING "btree" ("user_id", "redeemed_at" DESC);



CREATE INDEX "redemptions_user_store_redeemed_idx" ON "public"."redemptions" USING "btree" ("user_id", "store_id", "redeemed_at" DESC);



CREATE INDEX "restaurant_comment_reports_open_created_idx" ON "public"."restaurant_comment_reports" USING "btree" ("created_at" DESC) WHERE ("reviewed_at" IS NULL);



CREATE INDEX "restaurant_comment_reports_reporter_id_idx" ON "public"."restaurant_comment_reports" USING "btree" ("reporter_id");



CREATE INDEX "restaurant_comments_restaurant_created_idx" ON "public"."restaurant_comments" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "restaurant_comments_user_id_idx" ON "public"."restaurant_comments" USING "btree" ("user_id");



CREATE INDEX "restaurant_note_reports_content_author_id_idx" ON "public"."restaurant_note_reports" USING "btree" ("content_author_id");



CREATE INDEX "restaurant_note_reports_open_created_idx" ON "public"."restaurant_note_reports" USING "btree" ("created_at" DESC) WHERE ("reviewed_at" IS NULL);



CREATE INDEX "restaurant_note_reports_reporter_id_idx" ON "public"."restaurant_note_reports" USING "btree" ("reporter_id");



CREATE INDEX "restaurant_note_reports_resolved_retention_idx" ON "public"."restaurant_note_reports" USING "btree" ("reviewed_at") WHERE ("status" = 'resolved'::"text");



CREATE INDEX "restaurant_notes_restaurant_created_idx" ON "public"."restaurant_notes" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE UNIQUE INDEX "restaurant_notes_source_review_id_uidx" ON "public"."restaurant_notes" USING "btree" ("source_review_id") WHERE ("source_review_id" IS NOT NULL);



CREATE INDEX "restaurant_notes_user_id_idx" ON "public"."restaurant_notes" USING "btree" ("user_id");



CREATE INDEX "restaurants_partnership_id_idx" ON "public"."restaurants" USING "btree" ("partnership_id");



CREATE INDEX "review_prompts_pending_user_prompt_idx" ON "public"."review_prompts" USING "btree" ("user_id", "prompt_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "review_prompts_store_id_idx" ON "public"."review_prompts" USING "btree" ("store_id");



CREATE INDEX "review_prompts_user_id_idx" ON "public"."review_prompts" USING "btree" ("user_id");



CREATE INDEX "review_sheet_queue_due_idx" ON "public"."review_sheet_queue" USING "btree" ("next_attempt_at");



CREATE INDEX "reviews_user_id_idx" ON "public"."reviews" USING "btree" ("user_id");



CREATE INDEX "reward_claim_sheet_queue_due_idx" ON "public"."reward_claim_sheet_queue" USING "btree" ("next_attempt_at");



CREATE INDEX "stamp_card_rewards_archive_delete_after_idx" ON "public"."stamp_card_rewards_archive" USING "btree" ("delete_after");



CREATE INDEX "stamp_card_rewards_archive_restaurant_idx" ON "public"."stamp_card_rewards_archive" USING "btree" ("restaurant_id");



CREATE INDEX "stamp_card_rewards_archive_user_idx" ON "public"."stamp_card_rewards_archive" USING "btree" ("user_id");



CREATE UNIQUE INDEX "stamp_card_rewards_cycle_unique" ON "public"."stamp_card_rewards" USING "btree" ("user_id", "restaurant_id", "card_cycle");



CREATE INDEX "stamp_card_rewards_restaurant_id_idx" ON "public"."stamp_card_rewards" USING "btree" ("restaurant_id");



CREATE INDEX "stamp_card_visits_archive_delete_after_idx" ON "public"."stamp_card_visits_archive" USING "btree" ("delete_after");



CREATE INDEX "stamp_card_visits_archive_restaurant_idx" ON "public"."stamp_card_visits_archive" USING "btree" ("restaurant_id");



CREATE INDEX "stamp_card_visits_archive_user_idx" ON "public"."stamp_card_visits_archive" USING "btree" ("user_id");



CREATE UNIQUE INDEX "stamp_card_visits_member_daily_unique" ON "public"."stamp_card_visits" USING "btree" ("user_id", "restaurant_id", ((("visited_at" AT TIME ZONE 'Europe/Amsterdam'::"text"))::"date")) WHERE ("added_by_admin" IS FALSE);



CREATE INDEX "stamp_card_visits_restaurant_user_visited_idx" ON "public"."stamp_card_visits" USING "btree" ("restaurant_id", "user_id", "visited_at");



CREATE OR REPLACE TRIGGER "a_force_server_created_at" BEFORE INSERT OR UPDATE ON "public"."restaurant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."force_user_content_created_at"();



CREATE OR REPLACE TRIGGER "a_force_server_created_at" BEFORE INSERT OR UPDATE ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."force_user_content_created_at"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."admin_roles" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."login_otp_exempt_users" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."partnership_apps_script_secrets" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."partnership_integrations" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."restaurant_comment_reports" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."restaurant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."restaurant_note_reports" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."stamp_card_config" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "audit_admin_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."stamp_card_rewards" FOR EACH ROW EXECUTE FUNCTION "public"."log_admin_action"();



CREATE OR REPLACE TRIGGER "capture_restaurant_note_report" BEFORE INSERT ON "public"."restaurant_note_reports" FOR EACH ROW EXECUTE FUNCTION "public"."capture_restaurant_note_report"();



CREATE OR REPLACE TRIGGER "create_apps_script_secret" AFTER INSERT ON "public"."partnerships" FOR EACH ROW EXECUTE FUNCTION "public"."create_partnership_apps_script_secret"();



CREATE OR REPLACE TRIGGER "enforce_daily_review_limit" BEFORE INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_daily_review_limit"();



CREATE OR REPLACE TRIGGER "expire_restaurant_rewards_on_archive" AFTER UPDATE OF "is_archived" ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."expire_restaurant_rewards_on_archive"();



CREATE OR REPLACE TRIGGER "guard_restaurant_note_hidden_at" BEFORE UPDATE OF "hidden_at" ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."guard_restaurant_note_hidden_at"();



CREATE OR REPLACE TRIGGER "on_redemption_created" AFTER INSERT ON "public"."redemptions" FOR EACH ROW EXECUTE FUNCTION "public"."create_review_prompt_on_redemption"();



CREATE OR REPLACE TRIGGER "prepare_restaurant_comment" BEFORE INSERT OR UPDATE ON "public"."restaurant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_restaurant_comment"();



CREATE OR REPLACE TRIGGER "prepare_restaurant_note" BEFORE INSERT OR UPDATE ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_restaurant_note"();



CREATE OR REPLACE TRIGGER "prevent_stamp_card_size_change_after_progress" BEFORE INSERT OR UPDATE OF "restaurant_id", "total_stamps" ON "public"."stamp_card_config" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_stamp_card_size_change_after_progress"();



CREATE OR REPLACE TRIGGER "refresh_member_note_authors" AFTER UPDATE OF "username", "profile_image_url" ON "public"."members" FOR EACH ROW WHEN ((("old"."username" IS DISTINCT FROM "new"."username") OR ("old"."profile_image_url" IS DISTINCT FROM "new"."profile_image_url"))) EXECUTE FUNCTION "public"."refresh_member_note_authors"();



CREATE OR REPLACE TRIGGER "restaurants_track_review_criteria_change" BEFORE INSERT OR UPDATE ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."restaurants_track_review_criteria_change"();



CREATE OR REPLACE TRIGGER "set_comment_report_reviewed_metadata" BEFORE UPDATE OF "reviewed_at", "reviewed_by" ON "public"."restaurant_comment_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_report_reviewed_metadata"();



CREATE OR REPLACE TRIGGER "set_comment_report_submission_metadata" BEFORE INSERT ON "public"."restaurant_comment_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_report_submission_metadata"();



CREATE OR REPLACE TRIGGER "set_note_report_decision_metadata" BEFORE UPDATE ON "public"."restaurant_note_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_note_report_decision_metadata"();



CREATE OR REPLACE TRIGGER "set_note_report_submission_metadata" BEFORE INSERT ON "public"."restaurant_note_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_report_submission_metadata"();



CREATE OR REPLACE TRIGGER "touch_updated_at" BEFORE UPDATE ON "public"."partnership_apps_script_secrets" FOR EACH ROW EXECUTE FUNCTION "public"."touch_partnership_apps_script_secret"();



CREATE OR REPLACE TRIGGER "trg_sync_member_analytics_profile" AFTER INSERT OR UPDATE OF "University", "country_of_origin", "major", "education_level", "year_number", "year_of_birth", "gender" ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_member_analytics_profile"();



CREATE OR REPLACE TRIGGER "trg_sync_membership_ended_at" BEFORE INSERT OR UPDATE OF "membership_valid_until" ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_membership_ended_at"();



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkin_review_decisions"
    ADD CONSTRAINT "checkin_review_decisions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."checkin_review_decisions"
    ADD CONSTRAINT "checkin_review_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkin_sheet_queue"
    ADD CONSTRAINT "checkin_sheet_queue_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_report_notice_log"
    ADD CONSTRAINT "content_report_notice_log_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."restaurant_note_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legal_consent_receipts"
    ADD CONSTRAINT "legal_consent_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."login_otp_exempt_users"
    ADD CONSTRAINT "login_otp_exempt_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."login_otp_verified_sessions"
    ADD CONSTRAINT "login_otp_verified_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."login_otp_verified_sessions"
    ADD CONSTRAINT "login_otp_verified_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partnership_apps_script_secrets"
    ADD CONSTRAINT "partnership_apps_script_secrets_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partnership_integrations"
    ADD CONSTRAINT "partnership_integrations_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."restaurant_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_content_author_id_fkey" FOREIGN KEY ("content_author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."restaurant_notes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_notes"
    ADD CONSTRAINT "restaurant_notes_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_notes"
    ADD CONSTRAINT "restaurant_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."partnerships"("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_sheet_queue"
    ADD CONSTRAINT "review_sheet_queue_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_claim_sheet_queue"
    ADD CONSTRAINT "reward_claim_sheet_queue_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "public"."stamp_card_rewards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards_archive"
    ADD CONSTRAINT "stamp_card_rewards_archive_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards_archive"
    ADD CONSTRAINT "stamp_card_rewards_archive_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits_archive"
    ADD CONSTRAINT "stamp_card_visits_archive_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits_archive"
    ADD CONSTRAINT "stamp_card_visits_archive_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete any restaurant comment" ON "public"."restaurant_comments" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can delete any restaurant note" ON "public"."restaurant_notes" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can hide any restaurant note" ON "public"."restaurant_notes" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can read note reports" ON "public"."restaurant_note_reports" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins can read restaurant comments for moderation" ON "public"."restaurant_comments" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session")));



CREATE POLICY "Admins can read restaurant notes for moderation" ON "public"."restaurant_notes" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session")));



CREATE POLICY "Admins can review comment reports" ON "public"."restaurant_comment_reports" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND ("reviewed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("reviewed_at" IS NOT NULL)));



CREATE POLICY "Admins can review note reports" ON "public"."restaurant_note_reports" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND ((("status" = 'resolved'::"text") AND ("reviewed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("reviewed_at" IS NOT NULL) AND ("decision" IS NOT NULL)) OR (("status" = 'pending'::"text") AND ("decision" IS NULL) AND ("reviewed_at" IS NULL) AND ("reviewed_by" IS NULL)))));



CREATE POLICY "Admins delete members" ON "public"."members" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage events" ON "public"."events" TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage restaurants" ON "public"."restaurants" TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Auth hook reads login OTP grants" ON "public"."login_otp_exempt_users" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Auth hook reads verified login sessions" ON "public"."login_otp_verified_sessions" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Members and admins can read member rows" ON "public"."members" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members and admins can read own redemptions" ON "public"."redemptions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members and admins can read own reviews" ON "public"."reviews" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members and admins can read stamp rewards" ON "public"."stamp_card_rewards" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members and admins can read stamp visits" ON "public"."stamp_card_visits" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members and admins can update member rows" ON "public"."members" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members can delete their own restaurant notes" ON "public"."restaurant_notes" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can insert review for own redemption" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."redemptions" "redemption"
  WHERE (("redemption"."id" = "reviews"."redemption_id") AND ("redemption"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("redemption"."store_id" = "reviews"."store_id") AND ("redemption"."redeemed_at" IS NOT NULL) AND ("redemption"."redeemed_at" <= "now"()))))));



CREATE POLICY "Members can insert their own restaurant notes" ON "public"."restaurant_notes" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read own restaurant comments" ON "public"."restaurant_comments" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read own restaurant notes" ON "public"."restaurant_notes" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can report comments once" ON "public"."restaurant_comment_reports" FOR INSERT TO "authenticated" WITH CHECK (("reporter_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can report restaurant notes" ON "public"."restaurant_note_reports" FOR INSERT TO "authenticated" WITH CHECK (("reporter_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can see their own reports" ON "public"."restaurant_comment_reports" FOR SELECT TO "authenticated" USING ((("reporter_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Members can update their own restaurant notes" ON "public"."restaurant_notes" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Public can read partnerships" ON "public"."partnerships" FOR SELECT USING (true);



CREATE POLICY "Public read events" ON "public"."events" FOR SELECT USING (true);



CREATE POLICY "Public read restaurants" ON "public"."restaurants" FOR SELECT USING (true);



CREATE POLICY "Stamp card reads require active membership" ON "public"."stamp_card_rewards" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."members" "member"
  WHERE (("member"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("member"."is_member" IS TRUE) AND ("member"."account_status" = 'active'::"text") AND ("member"."identity_anonymized_at" IS NULL) AND ("member"."membership_valid_until" >= (("now"() AT TIME ZONE 'Europe/Amsterdam'::"text"))::"date"))))));



CREATE POLICY "Stamp card reads require active membership" ON "public"."stamp_card_visits" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."members" "member"
  WHERE (("member"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("member"."is_member" IS TRUE) AND ("member"."account_status" = 'active'::"text") AND ("member"."identity_anonymized_at" IS NULL) AND ("member"."membership_valid_until" >= (("now"() AT TIME ZONE 'Europe/Amsterdam'::"text"))::"date"))))));



CREATE POLICY "Users can read own admin role" ON "public"."admin_roles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can read own prompts" ON "public"."review_prompts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own prompts" ON "public"."review_prompts" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."admin_action_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkin_review_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkin_sheet_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_report_notice_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_confirmation_return_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_consent_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_otp_exempt_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_otp_verified_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_analytics_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partnership_apps_script_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partnership_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partnerships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."password_reset_return_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_email_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."privacy_action_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."privacy_sheet_sync_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public read config" ON "public"."stamp_card_config" FOR SELECT USING (true);



ALTER TABLE "public"."redemptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "require_app_login" ON "public"."admin_roles" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."events" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."member_analytics_profiles" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."members" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."partnerships" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."privacy_action_log" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."redemptions" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_comment_reports" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_comments" AS RESTRICTIVE TO "authenticated" USING ((COALESCE((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text"), false) AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session"))) WITH CHECK ((COALESCE((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text"), false) AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session")));



CREATE POLICY "require_app_login" ON "public"."restaurant_note_reports" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_notes" AS RESTRICTIVE TO "authenticated" USING ((COALESCE((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text"), false) AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session"))) WITH CHECK ((COALESCE((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text"), false) AND ( SELECT "public"."is_current_device_session"() AS "is_current_device_session")));



CREATE POLICY "require_app_login" ON "public"."restaurants" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."review_prompts" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."reviews" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_config" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_rewards" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_visits" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



ALTER TABLE "public"."restaurant_comment_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_note_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_sheet_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_claim_sheet_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stamp_card_config insert admin" ON "public"."stamp_card_config" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "stamp_card_config select admin" ON "public"."stamp_card_config" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "stamp_card_config select authenticated" ON "public"."stamp_card_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "stamp_card_config update admin" ON "public"."stamp_card_config" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."stamp_card_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_rewards_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_visits_archive" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stamp_card_rewards";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."stamp_card_visits";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";











































































































































































REVOKE ALL ON FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_checkin_review"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_checkin_review"("p_days" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_checkin_review"("p_days" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_list_admin_user_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_admin_user_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_list_admin_user_ids"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_list_stamp_card_members"("p_restaurant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_stamp_card_members"("p_restaurant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_partner_sheet_link_issues"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_partner_sheet_link_issues"() TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_partner_sheet_link_issues"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."admin_reset_stamp_progress"("p_restaurant_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reset_stamp_progress"("p_restaurant_id" "uuid", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_checkin_review"("p_user_id" "uuid", "p_reviewed" boolean, "p_through" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_checkin_review"("p_user_id" "uuid", "p_reviewed" boolean, "p_through" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."admin_set_checkin_review"("p_user_id" "uuid", "p_reviewed" boolean, "p_through" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."anonymize_expired_members"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."anonymize_expired_members_for_sheets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anonymize_expired_members_for_sheets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."capture_restaurant_note_report"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."checkin_daily_store_limit_reached"("p_user_id" "uuid", "p_store_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."checkin_daily_store_limit_reached"("p_user_id" "uuid", "p_store_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_privacy_retention_batch"("p_batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_privacy_retention_batch"("p_batch_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_privacy_sheet_sync_batch"("p_batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_privacy_sheet_sync_batch"("p_batch_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_single_device_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_single_device_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_single_device_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_orphaned_pending_email_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_orphaned_pending_email_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_privacy_sheet_sync"("p_user_id" "uuid", "p_success" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_privacy_sheet_sync"("p_user_id" "uuid", "p_success" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_overdue_member_retention"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_overdue_member_retention"() TO "service_role";



GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_partnership_apps_script_secret"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_partnership_apps_script_secret"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_review_prompt_on_redemption"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_review_prompt_on_redemption"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."enforce_daily_review_limit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."expire_restaurant_rewards_on_archive"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_restaurant_rewards_on_archive"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_expired_signup_auth_users"("p_batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_expired_signup_auth_users"("p_batch_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finish_privacy_retention_database"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finish_privacy_retention_database"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."force_user_content_created_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_store_review_summaries"("p_store_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_store_review_summaries"("p_store_ids" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_restaurant_note_hidden_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_current_device_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_current_device_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_device_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keep_ten_restaurant_notes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_notes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_admin_action"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_restaurant_comment"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_restaurant_comment"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_restaurant_note"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prevent_stamp_card_size_change_after_progress"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."queue_expired_member_anonymizations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_expired_member_anonymizations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_member_note_authors"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."restaurants_track_review_criteria_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restaurants_track_review_criteria_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_note_report_decision_metadata"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_report_submission_metadata"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_member_analytics_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_member_analytics_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_partnership_apps_script_secret"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_partnership_apps_script_secret"() TO "service_role";
























GRANT ALL ON TABLE "public"."members" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("profile_image_url") ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("tutorial_completed_at") ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("username") ON TABLE "public"."members" TO "authenticated";



GRANT ALL ON TABLE "public"."redemptions" TO "service_role";
GRANT SELECT ON TABLE "public"."redemptions" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";
GRANT SELECT ON TABLE "public"."restaurants" TO "anon";



GRANT ALL ON TABLE "public"."stamp_card_rewards" TO "service_role";
GRANT SELECT ON TABLE "public"."stamp_card_rewards" TO "authenticated";



GRANT ALL ON TABLE "public"."stamp_card_visits" TO "service_role";
GRANT SELECT ON TABLE "public"."stamp_card_visits" TO "authenticated";



GRANT SELECT,INSERT ON TABLE "public"."admin_action_audit" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."admin_action_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."checkin_review_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."checkin_sheet_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."checkin_sheet_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."content_report_notice_log" TO "service_role";



GRANT ALL ON TABLE "public"."edge_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."email_confirmation_return_signals" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."legal_consent_receipts" TO "service_role";



GRANT SELECT ON TABLE "public"."login_otp_exempt_users" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."login_otp_exempt_users" TO "service_role";



GRANT SELECT ON TABLE "public"."login_otp_verified_sessions" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."login_otp_verified_sessions" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."member_analytics_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."member_analytics_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."partner_monthly_insights_view" TO "service_role";



GRANT ALL ON TABLE "public"."partner_monthly_insights_owner_view" TO "service_role";



GRANT ALL ON TABLE "public"."partner_operations_view" TO "service_role";



GRANT ALL ON TABLE "public"."partner_operations_owner_view" TO "service_role";



GRANT ALL ON TABLE "public"."partnership_apps_script_secrets" TO "service_role";



GRANT SELECT ON TABLE "public"."partnership_integrations" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."partnerships" TO "authenticated";
GRANT ALL ON TABLE "public"."partnerships" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."partnerships" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."partnerships" TO "authenticated";



GRANT ALL ON TABLE "public"."password_reset_return_signals" TO "service_role";



GRANT ALL ON TABLE "public"."pending_email_changes" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."privacy_action_log" TO "authenticated";
GRANT ALL ON TABLE "public"."privacy_action_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."privacy_action_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."privacy_sheet_sync_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."redemptions_id_seq" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."restaurant_comment_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comment_reports" TO "service_role";



GRANT INSERT("comment_id") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT INSERT("reporter_id") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT UPDATE("reviewed_at") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT UPDATE("reviewed_by") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."restaurant_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comments" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."restaurant_comments" TO "authenticated";



GRANT SELECT("username") ON TABLE "public"."restaurant_comments" TO "authenticated";



GRANT SELECT("is_anonymous") ON TABLE "public"."restaurant_comments" TO "authenticated";



GRANT SELECT("body") ON TABLE "public"."restaurant_comments" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."restaurant_comments" TO "authenticated";



GRANT ALL ON TABLE "public"."restaurant_comments_safe" TO "service_role";
GRANT SELECT ON TABLE "public"."restaurant_comments_safe" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."restaurant_note_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_note_reports" TO "service_role";



GRANT INSERT("note_id") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT INSERT("reporter_id") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT UPDATE("reviewed_at") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT UPDATE("reviewed_by") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT INSERT("reporter_name") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT INSERT("reason") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT INSERT("explanation") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT INSERT("good_faith") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT UPDATE("status") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT UPDATE("decision") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT SELECT("content_author_name_snapshot") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT SELECT,DELETE,MAINTAIN ON TABLE "public"."restaurant_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_notes" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("restaurant_id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("user_id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT SELECT("username"),INSERT("username") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT SELECT("is_anonymous"),INSERT("is_anonymous"),UPDATE("is_anonymous") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT SELECT("body"),INSERT("body"),UPDATE("body") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("source_review_id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("source_redemption_id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("source_store_id") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("source_rating") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT INSERT("source_tags") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT UPDATE("hidden_at") ON TABLE "public"."restaurant_notes" TO "authenticated";



GRANT ALL ON TABLE "public"."restaurant_notes_safe" TO "service_role";
GRANT SELECT ON TABLE "public"."restaurant_notes_safe" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."review_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."review_prompts" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."review_prompts" TO "authenticated";



GRANT ALL ON TABLE "public"."review_sheet_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."review_sheet_queue_id_seq" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."reward_claim_sheet_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reward_claim_sheet_queue_id_seq" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."stamp_card_config" TO "authenticated";
GRANT ALL ON TABLE "public"."stamp_card_config" TO "service_role";



GRANT ALL ON TABLE "public"."stamp_card_rewards_archive" TO "service_role";



GRANT ALL ON TABLE "public"."stamp_card_visits_archive" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE ALL ON FUNCTIONS FROM PUBLIC;
































