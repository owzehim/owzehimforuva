


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "storage";


ALTER SCHEMA "storage" OWNER TO "supabase_admin";


CREATE TYPE "storage"."buckettype" AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE "storage"."buckettype" OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone DEFAULT "clock_timestamp"(), "p_admin_note" "text" DEFAULT NULL::"text") RETURNS TABLE("reward_pending" boolean, "cycle_completed" boolean, "new_count" integer, "card_cycle" integer, "total_stamps" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_total integer; v_prior_count integer; v_cycle integer; v_new_count integer; v_pending boolean;
BEGIN
 IF p_user_id IS NULL OR p_restaurant_id IS NULL OR p_visited_at IS NULL THEN RAISE EXCEPTION 'user, restaurant, and visit time are required'; END IF;
 IF length(coalesce(p_admin_note,''))>500 THEN RAISE EXCEPTION 'admin note is too long'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_restaurant_id::text,0));
 SELECT GREATEST(1,c.total_stamps) INTO v_total FROM public.restaurants r JOIN public.stamp_card_config c ON c.restaurant_id=r.id WHERE r.id=p_restaurant_id AND r.stamp_card_enabled IS TRUE LIMIT 1;
 IF v_total IS NULL THEN RAISE EXCEPTION 'stamp card is not enabled for this restaurant'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.stamp_card_rewards reward WHERE reward.user_id=p_user_id AND reward.restaurant_id=p_restaurant_id AND reward.redeemed IS FALSE) INTO v_pending;
 IF v_pending THEN RETURN QUERY SELECT true,true,0,0,v_total; RETURN; END IF;
 SELECT count(*)::integer INTO v_prior_count FROM public.stamp_card_visits visit WHERE visit.user_id=p_user_id AND visit.restaurant_id=p_restaurant_id;
 v_cycle:=(v_prior_count/v_total)+1;
 INSERT INTO public.stamp_card_visits(user_id,restaurant_id,visited_at,card_cycle,added_by_admin,admin_note) VALUES(p_user_id,p_restaurant_id,p_visited_at,v_cycle,true,nullif(p_admin_note,''));
 v_new_count:=v_prior_count+1;
 IF v_new_count%v_total=0 THEN INSERT INTO public.stamp_card_rewards(user_id,restaurant_id,card_cycle,redeemed) VALUES(p_user_id,p_restaurant_id,v_cycle,false) ON CONFLICT(user_id,restaurant_id,card_cycle) DO NOTHING; END IF;
 RETURN QUERY SELECT false,(v_new_count%v_total=0),v_new_count,v_cycle,v_total;
END; $$;


ALTER FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anonymize_expired_members"() RETURNS "void"
    LANGUAGE "plpgsql"
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
    SET "search_path" TO 'public'
    AS $$
begin
  create temporary table if not exists expired_members_for_privacy_job (
    user_id uuid primary key
  ) on commit drop;

  truncate table expired_members_for_privacy_job;

  insert into expired_members_for_privacy_job (user_id)
  select m.user_id
  from public.members m
  where m.membership_ended_at is not null
    and m.membership_ended_at < current_date - interval '12 months'
    and m.identity_anonymized_at is null;

  -- Preserve generalized analytics before removing raw member fields, if the
  -- analytics table/functions exist in this project.
  if to_regclass('public.member_analytics_profiles') is not null
     and to_regprocedure('public.country_to_region(text)') is not null
     and to_regprocedure('public.major_to_faculty(text)') is not null
     and to_regprocedure('public.study_stage(text, integer)') is not null
     and to_regprocedure('public.birth_year_to_age_group(integer)') is not null then
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
    select
      m.user_id,
      m."University",
      public.country_to_region(m.country_of_origin),
      public.major_to_faculty(m.major),
      public.study_stage(m.education_level, m.year_number),
      public.birth_year_to_age_group(m.year_of_birth),
      m.gender,
      now()
    from public.members m
    join expired_members_for_privacy_job e on e.user_id = m.user_id
    on conflict (user_id) do update set
      university = excluded.university,
      region_of_origin = excluded.region_of_origin,
      faculty_group = excluded.faculty_group,
      study_stage = excluded.study_stage,
      age_group = excluded.age_group,
      gender = excluded.gender,
      updated_at = now();
  end if;

  update public.members m
  set
    first_name = null,
    last_name = null,
    first_name_korean = null,
    last_name_korean = null,
    "University" = null,
    student_number = null,
    major = null,
    education_level = null,
    year_number = null,
    year_of_birth = null,
    country_of_origin = null,
    gender = null,
    profile_image_url = null,
    session_token = null,
    account_status = 'anonymized',
    identity_anonymized_at = now()
  from expired_members_for_privacy_job e
  where e.user_id = m.user_id;

  insert into public.privacy_action_log (action, record_count, details)
  select
    'anonymize_expired_members',
    count(*),
    jsonb_build_object(
      'retention_rule', 'membership_ended_at + 12 months',
      'sheet_sync_required', true
    )
  from expired_members_for_privacy_job;

  return query
  select e.user_id as anonymized_user_id
  from expired_members_for_privacy_job e;
end;
$$;


ALTER FUNCTION "public"."anonymize_expired_members_for_sheets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) RETURNS "text"
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") RETURNS TABLE("redemption_id" "text", "created" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz;
  v_existing_id text;
  v_new_id text;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL OR p_store_id = '' THEN
    RAISE EXCEPTION 'user and store are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_store_id, 0)
  );
  v_now := clock_timestamp();

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
    AS $$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  caller_session text := (SELECT auth.jwt() ->> 'session_id');
  changed_rows integer;
BEGIN
  IF caller_id IS NULL
     OR coalesce((SELECT auth.jwt() ->> 'app_access') = 'true', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Authorized application login is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = caller_id)
     OR EXISTS (
       SELECT 1 FROM public.login_otp_exempt_users
       WHERE user_id = caller_id AND reason = 'test'
     ) THEN
    RETURN true;
  END IF;

  IF caller_session IS NULL OR caller_session = '' THEN RETURN false; END IF;
  UPDATE public.members SET session_token = caller_session WHERE user_id = caller_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END;
$$;


ALTER FUNCTION "public"."claim_single_device_session"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."country_to_region"("country" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
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


CREATE OR REPLACE FUNCTION "public"."create_review_prompt_on_redemption"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) RETURNS TABLE("store_id" "text", "average_rating" numeric, "review_count" bigint, "tag_counts" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
 WITH requested AS (
  SELECT DISTINCT requested_store.store_id FROM unnest(coalesce(p_store_ids,ARRAY[]::text[])) AS requested_store(store_id)
  WHERE requested_store.store_id IS NOT NULL AND cardinality(coalesce(p_store_ids,ARRAY[]::text[]))<=100
 ), aggregates AS (
  SELECT requested.store_id,count(review.id)::bigint review_count,round(avg(review.rating),1)::numeric average_rating,
   count(review.id) FILTER(WHERE 'GREAT_FOOD'=ANY(review.tags))::bigint great_food,
   count(review.id) FILTER(WHERE 'FRIENDLY_STAFF'=ANY(review.tags))::bigint friendly_staff,
   count(review.id) FILTER(WHERE 'NICE_ATMOSPHERE'=ANY(review.tags))::bigint nice_atmosphere,
   count(review.id) FILTER(WHERE 'GOOD_VALUE'=ANY(review.tags))::bigint good_value
  FROM requested LEFT JOIN public.reviews review ON review.store_id=requested.store_id GROUP BY requested.store_id
 )
 SELECT aggregates.store_id,
  CASE WHEN aggregates.review_count>=5 THEN coalesce(aggregates.average_rating,0) ELSE 0 END,
  CASE WHEN aggregates.review_count>=5 THEN aggregates.review_count ELSE 0 END,
  CASE WHEN aggregates.review_count>=5 THEN jsonb_build_object('GREAT_FOOD',aggregates.great_food,'FRIENDLY_STAFF',aggregates.friendly_staff,'NICE_ATMOSPHERE',aggregates.nice_atmosphere,'GOOD_VALUE',aggregates.good_value)
       ELSE jsonb_build_object('GREAT_FOOD',0,'FRIENDLY_STAFF',0,'NICE_ATMOSPHERE',0,'GOOD_VALUE',0) END
 FROM aggregates;
$$;


ALTER FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) IS 'Returns compact aggregate review summaries for the requested store IDs.';



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
      SELECT 1 FROM public.admin_roles AS admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.login_otp_exempt_users AS exempt
      WHERE exempt.user_id = (SELECT auth.uid())
        AND exempt.reason = 'test'
    ) THEN true
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
  WITH normalized AS (SELECT lower(normalize(btrim(value), NFKC)) AS name),
  compact AS (SELECT name, regexp_replace(name, '[_-]+', '', 'g') AS compact_name FROM normalized)
  SELECT char_length(name) BETWEEN 2 AND 20
    AND name ~ '^[[:alnum:]_-]+$'
    AND compact_name NOT IN ('admin','administrator','moderator','mod','support','uvain','uva-in','운영진','관리자','운영자')
  FROM compact;
$_$;


ALTER FUNCTION "public"."is_valid_member_username"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_ten_restaurant_comments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.restaurant_comments
  where id in (
    select id from public.restaurant_comments
    where restaurant_id = new.restaurant_id
    order by created_at desc
    offset 10
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_ten_restaurant_comments"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."major_to_faculty"("major" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
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
    SET "search_path" TO 'public'
    AS $$
declare
  current_username text;
  current_profile_image_url text;
  current_avatar_color_seed text;
  current_member_is_active boolean;
  current_membership_valid_until date;
  normalized_body text;
  compact_body text;
begin
  select
    btrim(m.username),
    m.profile_image_url,
    coalesce(m.first_name, '') || coalesce(m.last_name, ''),
    m.is_member,
    m.membership_valid_until
  into
    current_username,
    current_profile_image_url,
    current_avatar_color_seed,
    current_member_is_active,
    current_membership_valid_until
  from public.members m
  where m.user_id = auth.uid();

  if current_username is null or current_username = '' then
    raise exception 'username is required before leaving a note';
  end if;

  if current_member_is_active is not true
     or current_membership_valid_until is null
     or current_membership_valid_until < (now() at time zone 'Europe/Amsterdam')::date then
    raise exception 'only active members can leave notes';
  end if;

  normalized_body := btrim(new.body);
  compact_body := lower(regexp_replace(normalized_body, '\s+', '', 'g'));

  if compact_body ~ '(fuck|shit|bitch|asshole|cunt|klootzak|tering|hoer|개새끼|병신|씨발|시발|좆)' then
    raise exception 'inappropriate language is not allowed';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then
      raise exception 'cannot leave a note for another user';
    end if;

    if exists (
      select 1 from public.restaurant_notes n
      where n.restaurant_id = new.restaurant_id
        and n.user_id = auth.uid()
        and (n.created_at at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date
    ) then
      raise exception 'one note per restaurant per day';
    end if;
  else
    if old.user_id <> auth.uid() then
      raise exception 'cannot edit another user note';
    end if;

    new.user_id := old.user_id;
    new.restaurant_id := old.restaurant_id;
  end if;

  new.username := current_username;
  new.profile_image_url := current_profile_image_url;
  new.avatar_color_seed := current_avatar_color_seed;
  new.body := normalized_body;
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."prepare_restaurant_note"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") RETURNS TABLE("enabled" boolean, "already_stamped" boolean, "reward_pending" boolean, "cycle_completed" boolean, "current_count" integer, "new_count" integer, "card_cycle" integer, "total_stamps" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_now timestamptz:=clock_timestamp(); v_total integer; v_prior_count integer; v_cycle integer; v_today_count integer; v_pending boolean; v_new_count integer;
BEGIN
 IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN RAISE EXCEPTION 'user and restaurant are required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_restaurant_id::text,0));
 SELECT GREATEST(1,c.total_stamps) INTO v_total FROM public.restaurants r JOIN public.stamp_card_config c ON c.restaurant_id=r.id WHERE r.id=p_restaurant_id AND r.stamp_card_enabled IS TRUE LIMIT 1;
 IF v_total IS NULL THEN RETURN QUERY SELECT false,false,false,false,0,0,0,0; RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM public.stamp_card_rewards reward WHERE reward.user_id=p_user_id AND reward.restaurant_id=p_restaurant_id AND reward.redeemed IS FALSE) INTO v_pending;
 SELECT count(*)::integer INTO v_prior_count FROM public.stamp_card_visits visit WHERE visit.user_id=p_user_id AND visit.restaurant_id=p_restaurant_id;
 v_cycle:=(v_prior_count/v_total)+1;
 IF v_pending THEN RETURN QUERY SELECT true,false,true,true,v_prior_count%v_total,v_prior_count,v_cycle-1,v_total; RETURN; END IF;
 SELECT count(*)::integer INTO v_today_count FROM public.stamp_card_visits visit WHERE visit.user_id=p_user_id AND visit.restaurant_id=p_restaurant_id AND visit.added_by_admin IS FALSE AND (visit.visited_at AT TIME ZONE 'Europe/Amsterdam')::date=(v_now AT TIME ZONE 'Europe/Amsterdam')::date;
 IF v_today_count>0 THEN RETURN QUERY SELECT true,true,false,false,v_prior_count%v_total,v_prior_count,v_cycle,v_total; RETURN; END IF;
 INSERT INTO public.stamp_card_visits(user_id,restaurant_id,visited_at,card_cycle,added_by_admin) VALUES(p_user_id,p_restaurant_id,v_now,v_cycle,false);
 v_new_count:=v_prior_count+1;
 IF v_new_count%v_total=0 THEN INSERT INTO public.stamp_card_rewards(user_id,restaurant_id,card_cycle,redeemed) VALUES(p_user_id,p_restaurant_id,v_cycle,false) ON CONFLICT(user_id,restaurant_id,card_cycle) DO NOTHING; END IF;
 RETURN QUERY SELECT true,false,false,(v_new_count%v_total=0),v_new_count%v_total,v_new_count,v_cycle,v_total;
END; $$;


ALTER FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if requested_characters < 1 then return true; end if;

  insert into public.translation_usage_months (month_start)
  values (current_month)
  on conflict (month_start) do nothing;

  update public.translation_usage_months
  set used_characters = used_characters + requested_characters,
      updated_at = now()
  where month_start = current_month
    and used_characters + requested_characters <= 450000;

  return found;
end;
$$;


ALTER FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."set_report_reviewed_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ BEGIN NEW.reviewed_at := now(); NEW.reviewed_by := auth.uid(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_report_reviewed_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when education_level ilike '%master%' then 'Master'
    when education_level ilike '%pre%' then 'Pre-Master'
    when education_level ilike '%bachelor%' and year_number = 1 then 'Early Bachelor'
    when education_level ilike '%bachelor%' and year_number >= 2 then 'Late Bachelor'
    when education_level is null and year_number = 1 then 'Early Bachelor'
    when education_level is null and year_number >= 2 then 'Late Bachelor'
    else 'Other / Unknown'
  end;
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


CREATE OR REPLACE FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION "storage"."allow_any_operation"("expected_operations" "text"[]) OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."allow_only_operation"("expected_operation" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION "storage"."allow_only_operation"("expected_operation" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION "storage"."can_insert_object"("bucketid" "text", "name" "text", "owner" "uuid", "metadata" "jsonb") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."enforce_bucket_lifecycle_service_role"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    AS $$
BEGIN
  IF current_user::text IS DISTINCT FROM TG_ARGV[0]
     AND (
       OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
       OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation
     ) THEN
    -- AFTER runs only after caller RLS has accepted the proposed row. The API
    -- recognizes this specific error after rolling back its permission probe;
    -- direct non-service writes still fail and cannot persist the change.
    RAISE EXCEPTION 'bucket control columns may only be changed by the configured storage service role'
      USING ERRCODE = 'PST01',
            SCHEMA = TG_TABLE_SCHEMA,
            TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_NAME;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "storage"."enforce_bucket_lifecycle_service_role"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."enforce_bucket_name_length"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION "storage"."enforce_bucket_name_length"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."extension"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION "storage"."extension"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."filename"("name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


ALTER FUNCTION "storage"."filename"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."foldername"("name" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION "storage"."foldername"("name" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
SELECT CASE
    WHEN p_delimiter <> ''
         AND position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(
        p_key,
        length(p_prefix)
            + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1))
            + length(p_delimiter) - 1
    )
    ELSE NULL
END;
$$;


ALTER FUNCTION "storage"."get_common_prefix"("p_key" "text", "p_prefix" "text", "p_delimiter" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."get_size_by_bucket"("noncurrent_versions" "text" DEFAULT 'include'::"text", "delete_markers" "text" DEFAULT 'include'::"text") RETURNS TABLE("size" bigint, "bucket_id" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'include');
    delete_markers := COALESCE(delete_markers, 'include');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'include';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'include';
    END IF;

    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        where (noncurrent_versions != 'exclude' OR obj.archived_at IS NULL)
          and (noncurrent_versions != 'only' OR obj.archived_at IS NOT NULL)
          and (delete_markers != 'exclude' OR NOT obj.is_delete_marker)
          and (delete_markers != 'only' OR obj.is_delete_marker)
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION "storage"."get_size_by_bucket"("noncurrent_versions" "text", "delete_markers" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "next_key_token" "text" DEFAULT ''::"text", "next_upload_token" "text" DEFAULT ''::"text", "raw_prefix_param" "text" DEFAULT NULL::"text") RETURNS TABLE("key" "text", "id" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $_$
WITH candidates AS (
    SELECT
        upload.key AS object_key,
        CASE
            WHEN position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0
            THEN left(
                upload.key,
                length(coalesce($7, $2))
                    + position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1))
                    + length($3) - 1
            )
            ELSE upload.key
        END AS result_key,
        upload.id,
        upload.created_at,
        position($3 IN substring(upload.key FROM length(coalesce($7, $2)) + 1)) > 0 AS is_common_prefix
    FROM storage.s3_multipart_uploads AS upload
    WHERE upload.bucket_id = $1
      AND upload.key COLLATE "C" LIKE $2 || '%'
), filtered AS (
    SELECT candidate.*
    FROM candidates AS candidate
    WHERE $5 = ''
       OR candidate.result_key COLLATE "C" > $5
       OR (
           candidate.result_key COLLATE "C" = $5
           AND NOT candidate.is_common_prefix
           AND $6 <> ''
           -- A completed or aborted marker repeats the remaining same-key uploads.
           AND COALESCE(
               (candidate.created_at, candidate.id COLLATE "C") > (
                   SELECT marker.created_at, marker.id COLLATE "C"
                   FROM storage.s3_multipart_uploads AS marker
                   WHERE marker.bucket_id = $1
                     AND marker.key COLLATE "C" = $5
                     AND marker.id = $6
               ),
               TRUE
           )
       )
), ranked AS (
    SELECT
        filtered.*,
        row_number() OVER (
            PARTITION BY filtered.result_key COLLATE "C"
            ORDER BY filtered.created_at, filtered.id COLLATE "C"
        ) AS prefix_rank
    FROM filtered
)
SELECT ranked.result_key, ranked.id, ranked.created_at
FROM ranked
WHERE NOT ranked.is_common_prefix OR ranked.prefix_rank = 1
ORDER BY ranked.result_key COLLATE "C", ranked.created_at, ranked.id COLLATE "C"
LIMIT $4;
$_$;


ALTER FUNCTION "storage"."list_multipart_uploads_with_delimiter"("bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "next_key_token" "text", "next_upload_token" "text", "raw_prefix_param" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer DEFAULT 100, "start_after" "text" DEFAULT ''::"text", "next_token" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text", "noncurrent_versions" "text" DEFAULT 'exclude'::"text", "delete_markers" "text" DEFAULT 'exclude'::"text", "next_token_archived_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "next_token_version" "text" DEFAULT ''::"text") RETURNS TABLE("name" "text", "id" "uuid", "metadata" "jsonb", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "version" "text", "archived_at" timestamp with time zone, "is_delete_marker" boolean, "is_versioned" boolean)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_start_relative TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;

    -- true when noncurrent_versions can return >1 row per name; keeps them
    -- ordered most-recent-first and lets pagination resume mid-key
    v_multi_row BOOLEAN;
    v_name_order TEXT;
    v_exact_range_predicate TEXT;
    v_strict_range_predicate TEXT;
    v_inclusive_range_predicate TEXT;

    -- Seek state for the current name. archived_at is normalized to JavaScript's
    -- millisecond precision and version breaks ties within the same millisecond.
    -- Current rows use 'infinity'; NULL means no tiebreak has been established.
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_cursor_is_folder BOOLEAN;
    v_count INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_batch_query_strict TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');
    v_name_order := CASE WHEN v_is_asc THEN 'ASC' ELSE 'DESC' END;

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Keep caller-provided cursors inside the requested prefix range.
    IF v_start <> '' AND v_upper_bound IS NOT NULL THEN
        IF v_is_asc THEN
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                v_start := '';
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                RETURN;
            END IF;
        ELSE
            IF v_start COLLATE "C" < v_prefix COLLATE "C" THEN
                RETURN;
            ELSIF v_start COLLATE "C" >= v_upper_bound COLLATE "C" THEN
                v_start := '';
            END IF;
        END IF;
    END IF;

    v_start_relative := substring(v_start FROM length(v_prefix) + 1);

    -- Direction affects only the indexed name range and its ordering. Cursor
    -- state transitions and within-key version ordering stay shared.
    IF v_is_asc THEN
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" > $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" >= $2';
        IF v_upper_bound IS NOT NULL THEN
            v_exact_range_predicate := 'o.name COLLATE "C" < $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" < $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" < $3';
        END IF;
    ELSE
        v_exact_range_predicate := 'TRUE';
        v_strict_range_predicate := 'o.name COLLATE "C" < $2';
        v_inclusive_range_predicate := 'o.name COLLATE "C" < $2';
        IF v_prefix <> '' THEN
            v_exact_range_predicate := 'o.name COLLATE "C" >= $3';
            v_strict_range_predicate := v_strict_range_predicate || ' AND o.name COLLATE "C" >= $3';
            v_inclusive_range_predicate := v_inclusive_range_predicate || ' AND o.name COLLATE "C" >= $3';
        END IF;
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    -- The multi-row order matches the externally serialized cursor exactly:
    -- archived_at at millisecond precision, then version as the final tiebreak.
    --
    -- When v_multi_row, the seek is a keyset tuple comparison ("name > $2 OR
    -- (name = $2 AND tiebreak)") - Postgres won't split that OR into indexable
    -- form (confirmed even with fully literal values), so as one WHERE clause
    -- it forces a full bucket scan filtered row-by-row. Splitting it into two
    -- independently-indexable branches (exact name match with the tiebreak
    -- filter, vs. strictly-past names) combined with UNION ALL lets each
    -- branch keep name as a real index condition; the outer ORDER BY/LIMIT
    -- re-merges them into the same page the single query used to produce.
    IF v_multi_row THEN
        v_batch_query := format(
            $sql$
            SELECT *
            FROM (
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND o.name COLLATE "C" = $2
                      AND %s
                      AND NOT $7::boolean
                      AND (
                          $5::timestamptz IS NULL
                          OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < $5
                          OR (
                              COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = $5
                              AND COALESCE(o.version, '') > $6
                          )
                      )
                      %s
                    ORDER BY
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
                UNION ALL
                (
                    SELECT o.name, o.id, o.updated_at, o.created_at,
                           o.last_accessed_at, o.metadata, o.version,
                           o.archived_at, o.is_delete_marker, o.is_versioned
                    FROM storage.objects o
                    WHERE o.bucket_id = $1
                      AND %s
                      %s
                    ORDER BY
                        o.name COLLATE "C" %s,
                        COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC,
                        COALESCE(o.version, '') ASC
                    LIMIT $4
                )
            ) sub
            ORDER BY
                sub.name COLLATE "C" %s,
                COALESCE(date_trunc('milliseconds', sub.archived_at), 'infinity'::timestamptz) DESC,
                COALESCE(sub.version, '') ASC
            LIMIT $4
            $sql$,
            v_exact_range_predicate,
            v_version_filter,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order,
            v_name_order
        );
    ELSE
        v_batch_query := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_inclusive_range_predicate,
            v_version_filter,
            v_name_order
        );

        -- Strict counterpart of the query above: used once the single-row
        -- ASC batch advance (below) has left v_next_seek pointing at the
        -- last row already emitted, so an inclusive predicate would
        -- re-match it forever. Only single-row mode ever sets strict mode,
        -- so this variant is never needed when v_multi_row.
        v_batch_query_strict := format(
            $sql$
            SELECT o.name, o.id, o.updated_at, o.created_at,
                   o.last_accessed_at, o.metadata, o.version,
                   o.archived_at, o.is_delete_marker, o.is_versioned
            FROM storage.objects o
            WHERE o.bucket_id = $1
              AND %s
              %s
            ORDER BY o.name COLLATE "C" %s, o.archived_at DESC
            LIMIT $4
            $sql$,
            v_strict_range_predicate,
            v_version_filter,
            v_name_order
        );
    END IF;

    -- The static peek predicates cannot use the partial delete-marker index
    -- once PL/pgSQL switches to a generic plan because whether
    -- is_delete_marker is required remains parameter-dependent. Reuse the
    -- already-specialized batch query with a one-row limit for this sparse
    -- filter so the plan sees a literal `o.is_delete_marker` predicate.
    IF delete_markers = 'only' THEN
        v_delete_marker_peek_query :=
            'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        IF NOT v_multi_row THEN
            v_delete_marker_peek_query_strict :=
                'SELECT marker_page.name FROM (' || v_batch_query_strict || ') marker_page LIMIT 1';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor performs one specialized initial seek so
            -- partial current-version and delete-marker indexes remain available.
            EXECUTE format(
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY o.name COLLATE "C" DESC LIMIT 1',
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND o.name COLLATE "C" >= $2 AND o.name COLLATE "C" < $3'
                    ELSE ''
                END,
                v_version_filter
            )
            INTO v_next_seek
            USING _bucket_id, v_prefix, v_upper_bound;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Folder continuation tokens retain their trailing delimiter. A
        -- delimiter-less startAfter is always a literal key boundary.
        v_cursor_is_folder := delimiter_param <> ''
            AND v_start_relative <> ''
            AND right(v_start_relative, length(delimiter_param)) = delimiter_param;

        IF v_cursor_is_folder THEN
            v_next_seek := CASE
                WHEN right(v_start, length(delimiter_param)) = delimiter_param
                    THEN v_start
                ELSE v_start || delimiter_param
            END;
            IF v_is_asc THEN
                v_next_seek := left(v_next_seek, -1)
                    || chr(ascii(right(v_next_seek, 1)) + 1);
            END IF;
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- leaf object: when v_multi_row, stay on v_start with the
            -- caller-supplied tiebreak so a page boundary mid-key resumes
            -- that key's remaining rows instead of skipping them. Truncate
            -- to milliseconds like every other v_next_seek_at assignment -
            -- harmless today since object.ts's cursor always round-trips
            -- through JS Date first, but this shouldn't rely on that.
            IF v_multi_row THEN
                v_next_seek := v_start;
                v_next_seek_at := date_trunc('milliseconds', next_token_archived_at);
                v_next_seek_version := coalesce(next_token_version, '');
                v_next_seek_strict := coalesce(next_token, '') = '';
            ELSIF v_is_asc THEN
                v_next_seek := v_start;
                v_next_seek_strict := true;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        -- v_multi_row is branched here (rather than folded into the WHERE
        -- clause as a bound parameter) so each concrete query keeps an
        -- unconditional seek predicate - once PL/pgSQL switches to its
        -- cached generic plan (after 5 calls), a parameter-gated
        -- "(NOT v_multi_row AND name >= $x) OR (v_multi_row AND ...)"
        -- predicate stops the planner from using name as an index
        -- condition at all, degrading every subsequent peek to a full
        -- index scan filtered row-by-row instead of a bounded range scan.
        -- v_multi_row's seek predicate is a keyset tuple comparison
        -- ("name > x OR (name = x AND tiebreak)") - Postgres does not
        -- split this OR into indexable form even with fully literal
        -- values, so it falls back to a full scan filtered row-by-row.
        -- Splitting it into two independently-indexable branches (exact
        -- name match with the tiebreak filter, vs. strictly-past name)
        -- combined with UNION ALL lets each branch keep name as a real
        -- index condition; the outer ORDER BY/LIMIT picks whichever of
        -- the (at most 2) rows sorts first.
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING _bucket_id, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END,
                    1, v_next_seek_at, v_next_seek_version, v_next_seek_strict;
        ELSIF v_multi_row THEN
            IF v_is_asc THEN
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" < v_upper_bound
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek AND o.name COLLATE "C" < v_upper_bound
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" > v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" ASC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND o.name COLLATE "C" >= v_prefix
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT sub.name INTO v_peek_name FROM (
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" = v_next_seek
                           AND NOT v_next_seek_strict
                           AND (v_next_seek_at IS NULL
                                OR COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) < v_next_seek_at
                                OR (COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) = v_next_seek_at
                                    AND COALESCE(o.version, '') > v_next_seek_version))
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY COALESCE(date_trunc('milliseconds', o.archived_at), 'infinity'::timestamptz) DESC, COALESCE(o.version, '') ASC LIMIT 1)
                        UNION ALL
                        (SELECT o.name FROM storage.objects o
                         WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                           AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                           AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                           AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                           AND (delete_markers != 'only' OR o.is_delete_marker)
                         ORDER BY o.name COLLATE "C" DESC LIMIT 1)
                    ) sub ORDER BY sub.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        ELSE
            -- Single-row mode is always noncurrent_versions='exclude'. Keep
            -- this predicate literal so generic plans use the current index.
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.name COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSE
                IF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.name COLLATE "C" >= v_prefix
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = _bucket_id
                      AND o.name COLLATE "C" < v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                      AND (delete_markers != 'only' OR o.is_delete_marker)
                    ORDER BY o.name COLLATE "C" DESC LIMIT 1;
                END IF;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := v_common_prefix;
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            version := NULL;
            archived_at := NULL;
            is_delete_marker := NULL;
            is_versioned := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1)
                    || chr(ascii(right(v_common_prefix, 1)) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
            v_next_seek_strict := NOT v_is_asc;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE CASE WHEN v_next_seek_strict AND NOT v_multi_row THEN v_batch_query_strict ELSE v_batch_query END
                USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size, v_next_seek_at, v_next_seek_version,
                v_next_seek_strict
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN v_current.name
                        ELSE v_current.name || delimiter_param
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                version := v_current.version;
                archived_at := v_current.archived_at;
                is_delete_marker := v_current.is_delete_marker;
                is_versioned := v_current.is_versioned;
                RETURN NEXT;
                v_count := v_count + 1;

                -- when v_multi_row, stay on this name and record its
                -- archived_at as the new tiebreak so remaining rows for the
                -- same key are picked up before moving to the next name
                IF v_multi_row THEN
                    v_next_seek := v_current.name;
                    v_next_seek_at := COALESCE(date_trunc('milliseconds', v_current.archived_at), 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                    v_next_seek_strict := false;
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor
                    -- would skip a real key like `name || '!'` (or any
                    -- character sorting below the delimiter), which sorts
                    -- between `name` and `name || delimiter`. Track the real
                    -- name and mark the next comparison strict instead.
                    v_next_seek := v_current.name;
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.list_objects_with_delimiter made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."list_objects_with_delimiter"("_bucket_id" "text", "prefix_param" "text", "delimiter_param" "text", "max_keys" integer, "start_after" "text", "next_token" "text", "sort_order" "text", "noncurrent_versions" "text", "delete_markers" "text", "next_token_archived_at" timestamp with time zone, "next_token_version" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."operation"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION "storage"."operation"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."protect_bucket_control_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format(
                  'Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.',
                  TG_ARGV[0]
                );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;

  IF NOT configuration_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     AND NEW.lifecycle_configuration_generation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "storage"."protect_bucket_control_columns"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."protect_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "storage"."protect_delete"() OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "offsets" integer DEFAULT 0, "search" "text" DEFAULT ''::"text", "sortcolumn" "text" DEFAULT 'name'::"text", "sortorder" "text" DEFAULT 'asc'::"text", "noncurrent_versions" "text" DEFAULT 'exclude'::"text", "delete_markers" "text" DEFAULT 'exclude'::"text") RETURNS TABLE("name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb", "version" "text", "archived_at" timestamp with time zone, "is_delete_marker" boolean, "is_versioned" boolean)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_prefix_len INT;
    v_prefix_start INT;
    v_combined_levels INT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;
    v_version_filter TEXT;
    v_multi_row BOOLEAN;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;
    v_delete_marker_peek_query TEXT;
    v_delete_marker_peek_query_strict TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_next_seek_at TIMESTAMPTZ;
    v_next_seek_version TEXT;
    v_next_seek_strict BOOLEAN := false;
    v_count INT := 0;
    v_skipped INT := 0;
    v_previous_seek TEXT;
    v_previous_seek_at TIMESTAMPTZ;
    v_previous_seek_version TEXT;
    v_previous_count INT;
    v_previous_skipped INT;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_prefix_len := length(coalesce(prefix, ''));
    v_prefix_start := coalesce(array_length(string_to_array(coalesce(prefix, ''), v_delimiter), 1), 1);
    v_combined_levels := coalesce(array_length(string_to_array(v_prefix, v_delimiter), 1), 1);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);
    v_next_seek_at := NULL;
    v_next_seek_version := '';

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    v_multi_row := noncurrent_versions IN ('only', 'include');

    v_version_filter := '';
    IF noncurrent_versions = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NULL';
    ELSIF noncurrent_versions = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.archived_at IS NOT NULL';
    END IF;
    IF delete_markers = 'exclude' THEN
        v_version_filter := v_version_filter || ' AND NOT o.is_delete_marker';
    ELSIF delete_markers = 'only' THEN
        v_version_filter := v_version_filter || ' AND o.is_delete_marker';
    END IF;

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT array_to_string(path_tokens[$1:$2], '/') AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $3 || '%%'
                  AND bucket_id = $4
                  AND array_length(objects.path_tokens, 1) <> $2
                  AND ($7 != 'exclude' OR objects.archived_at IS NULL)
                  AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
                  AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
                  AND ($8 != 'only' OR objects.is_delete_marker)
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata,
                   NULL::text AS version,
                   NULL::timestamptz AS archived_at,
                   NULL::boolean AS is_delete_marker,
                   NULL::boolean AS is_versioned FROM folders)
            UNION ALL
            (SELECT array_to_string(path_tokens[$1:$2], '/') AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata,
                   version, archived_at, is_delete_marker, is_versioned
             FROM storage.objects
             WHERE objects.name ILIKE $3 || '%%'
               AND bucket_id = $4
               AND array_length(objects.path_tokens, 1) = $2
               AND ($7 != 'exclude' OR objects.archived_at IS NULL)
               AND ($7 != 'only' OR objects.archived_at IS NOT NULL)
               AND ($8 != 'exclude' OR NOT objects.is_delete_marker)
               AND ($8 != 'only' OR objects.is_delete_marker)
             -- name, then version, as tiebreaks so two versions of the same
             -- key tying on the sort column still sort deterministically
             ORDER BY %I %s, name COLLATE "C" %s, COALESCE(version, '') %s)
            LIMIT $5 OFFSET $6
            $sql$, v_sort_order, v_order_by, v_sort_order, v_sort_order, v_sort_order
        ) USING v_prefix_start, v_combined_levels, v_prefix, bucketname, v_limit, offsets, noncurrent_versions, delete_markers;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build a resume-safe batch query. The exact-name branch returns remaining
    -- versions after the current (archived_at, version) boundary; the strict
    -- name branch returns subsequent keys. UNION ALL keeps both predicates
    -- independently indexable.
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2 AND lower(o.name) COLLATE "C" < $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" > $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" ASC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 AND lower(o.name) COLLATE "C" >= $3' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT * FROM (' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" = $2 AND ($5::timestamptz IS NULL OR COALESCE(o.archived_at, ''infinity''::timestamptz) < $5 OR (COALESCE(o.archived_at, ''infinity''::timestamptz) = $5 AND COALESCE(o.version, '''') > $6))' ||
                v_version_filter || ' ORDER BY COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4) UNION ALL ' ||
                '(SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata, o.version, o.archived_at, o.is_delete_marker, o.is_versioned FROM storage.objects o ' ||
                'WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2' || v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC, COALESCE(o.archived_at, ''infinity''::timestamptz) DESC, COALESCE(o.version, '''') ASC LIMIT $4)' ||
                ') sub ORDER BY lower(sub.name) COLLATE "C" DESC, COALESCE(sub.archived_at, ''infinity''::timestamptz) DESC, COALESCE(sub.version, '''') ASC LIMIT $4';
        END IF;
    END IF;

    -- Keep the delete-marker predicate literal so the cached generic
    -- plan can use idx_objects_delete_markers during the main-loop peek.
    IF delete_markers = 'only' THEN
        IF v_multi_row THEN
            v_delete_marker_peek_query :=
                'SELECT marker_page.name FROM (' || v_batch_query || ') marker_page LIMIT 1';
        ELSIF v_is_asc THEN
            -- Two separate literal query strings, not one gated by a bound
            -- boolean: folding "$n AND op1 OR NOT $n AND op2" into a single
            -- query defeats the generic plan's ability to push either
            -- comparison into the index. Branching in PL/pgSQL control flow
            -- instead keeps each query's index condition intact.
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" >= $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
            -- Strict variant: used once the single-row ASC batch advance
            -- (below) has left v_next_seek pointing at the last row already
            -- emitted, so a plain >= would re-match it forever.
            v_delete_marker_peek_query_strict :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" > $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" < $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1';
        ELSE
            v_delete_marker_peek_query :=
                'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1 ' ||
                'AND lower(o.name) COLLATE "C" < $2' ||
                CASE WHEN v_upper_bound IS NOT NULL
                    THEN ' AND lower(o.name) COLLATE "C" >= $3'
                    ELSE ''
                END ||
                v_version_filter ||
                ' ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC performs one specialized initial seek so partial current-version
        -- and delete-marker indexes remain available.
        EXECUTE format(
            'SELECT o.name FROM storage.objects o WHERE o.bucket_id = $1%s%s ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1',
            CASE WHEN v_upper_bound IS NOT NULL
                THEN ' AND lower(o.name) COLLATE "C" >= $2 AND lower(o.name) COLLATE "C" < $3'
                ELSE ''
            END,
            v_version_filter
        )
        INTO v_peek_name
        USING bucketname, v_prefix_lower, v_upper_bound;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch and
    -- the delete-marker-only path
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        v_previous_seek := v_next_seek;
        v_previous_seek_at := v_next_seek_at;
        v_previous_seek_version := v_next_seek_version;
        v_previous_count := v_count;
        v_previous_skipped := v_skipped;

        -- STEP 1: PEEK
        v_peek_name := NULL;
        IF delete_markers = 'only' THEN
            EXECUTE CASE WHEN v_next_seek_strict
                THEN v_delete_marker_peek_query_strict
                ELSE v_delete_marker_peek_query
            END
                INTO v_peek_name
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END,
                    1, v_next_seek_at, v_next_seek_version;
        ELSIF v_multi_row AND v_next_seek_at IS NOT NULL THEN
            SELECT o.name INTO v_peek_name
            FROM storage.objects o
            WHERE o.bucket_id = bucketname
              AND lower(o.name) COLLATE "C" = v_next_seek
              AND (COALESCE(o.archived_at, 'infinity'::timestamptz) < v_next_seek_at
                   OR (COALESCE(o.archived_at, 'infinity'::timestamptz) = v_next_seek_at
                       AND COALESCE(o.version, '') > v_next_seek_version))
              AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
              AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
              AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
              AND (delete_markers != 'only' OR o.is_delete_marker)
            ORDER BY COALESCE(o.archived_at, 'infinity'::timestamptz) DESC,
                     COALESCE(o.version, '') ASC
            LIMIT 1;

            -- The current key is exhausted. Clear its version boundary and
            -- make the following ASC name peek strict. Appending '/' is not a
            -- valid lexical successor because keys ending in characters such
            -- as '!' sort between the exhausted name and name || '/'.
            IF v_peek_name IS NULL THEN
                IF v_is_asc THEN
                    v_next_seek_strict := true;
                END IF;
                v_next_seek_at := NULL;
                v_next_seek_version := '';
            END IF;
        END IF;

        -- Single-row mode is always noncurrent_versions='exclude'. Keep the
        -- current-row predicate literal so generic plans use the current index.
        IF delete_markers != 'only' AND v_peek_name IS NULL AND NOT v_multi_row THEN
            IF v_is_asc THEN
                IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_next_seek_strict THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSIF v_upper_bound IS NOT NULL THEN
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                ELSE
                    SELECT o.name INTO v_peek_name FROM storage.objects o
                    WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                      AND o.archived_at IS NULL
                      AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                    ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
                END IF;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND o.archived_at IS NULL
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL AND v_is_asc THEN
            IF v_next_seek_strict AND v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_next_seek_strict THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" > v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSIF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSIF delete_markers != 'only' AND v_peek_name IS NULL THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                  AND (noncurrent_versions != 'exclude' OR o.archived_at IS NULL)
                  AND (noncurrent_versions != 'only' OR o.archived_at IS NOT NULL)
                  AND (delete_markers != 'exclude' OR NOT o.is_delete_marker)
                  AND (delete_markers != 'only' OR o.is_delete_marker)
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- If the peek landed on a different key than we were tracking, any
        -- version boundary belongs to the OLD key and must not leak into the
        -- new one - e.g. the deleteMarkers='only' peek doesn't know or care
        -- whether it's continuing the same key or jumping to a new one, so
        -- it never clears these itself.
        IF lower(v_peek_name) IS DISTINCT FROM v_next_seek THEN
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        END IF;

        -- The peek is authoritative for the next key to process. This is
        -- especially important after exhausting a multi-version key: the
        -- version boundary has been cleared, so executing the batch against
        -- a stale v_next_seek would replay every version of that old key.
        v_next_seek := lower(v_peek_name);
        v_next_seek_strict := false;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := substring(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter) from v_prefix_len + 1);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                version := NULL;
                archived_at := NULL;
                is_delete_marker := NULL;
                is_versioned := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
            v_next_seek_at := NULL;
            v_next_seek_version := '';
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size,
                    v_next_seek_at, v_next_seek_version
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it. Reset
                    -- strict mode too - it may have been set by an earlier
                    -- row in this same batch (see the single-row ASC advance
                    -- below), and v_next_seek here is the folder-triggering
                    -- row's own name, which the next peek must find inclusively.
                    v_next_seek := CASE
                        WHEN v_is_asc THEN lower(v_current.name)
                        ELSE lower(v_current.name) || v_delimiter
                    END;
                    v_next_seek_at := NULL;
                    v_next_seek_version := '';
                    v_next_seek_strict := false;
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := substring(v_current.name from v_prefix_len + 1);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    version := v_current.version;
                    archived_at := v_current.archived_at;
                    is_delete_marker := v_current.is_delete_marker;
                    is_versioned := v_current.is_versioned;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Multi-row mode must remain on this key until all of its
                -- versions have crossed the internal batch boundary.
                IF v_multi_row THEN
                    v_next_seek := lower(v_current.name);
                    v_next_seek_at := COALESCE(v_current.archived_at, 'infinity'::timestamptz);
                    v_next_seek_version := COALESCE(v_current.version, '');
                ELSIF v_is_asc THEN
                    -- Appending the delimiter as a fake lexical successor would
                    -- skip a real key like `name || '!'` (or any character
                    -- sorting below the delimiter), which sorts between `name`
                    -- and `name || delimiter`. Track the real name and mark the
                    -- next comparison strict instead - same fix as the
                    -- exhausted-key case above.
                    v_next_seek := lower(v_current.name);
                    v_next_seek_strict := true;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;

        IF v_count = v_previous_count
           AND v_skipped = v_previous_skipped
           AND v_next_seek IS NOT DISTINCT FROM v_previous_seek
           AND v_next_seek_at IS NOT DISTINCT FROM v_previous_seek_at
           AND v_next_seek_version IS NOT DISTINCT FROM v_previous_seek_version THEN
            RAISE EXCEPTION 'storage.search made no progress at seek (%, %, %)',
                v_next_seek, v_next_seek_at, v_next_seek_version;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION "storage"."search"("prefix" "text", "bucketname" "text", "limits" integer, "levels" integer, "offsets" integer, "search" "text", "sortcolumn" "text", "sortorder" "text", "noncurrent_versions" "text", "delete_markers" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text", "noncurrent_versions" "text" DEFAULT 'exclude'::"text", "delete_markers" "text" DEFAULT 'exclude'::"text", "p_start_after_version" "text" DEFAULT ''::"text") RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb", "version" "text", "archived_at" timestamp with time zone, "is_delete_marker" boolean, "is_versioned" boolean)
    LANGUAGE "plpgsql" STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
    v_prefix_pattern text;
    v_sort_order text;
    v_sort_column text;
    v_version_tiebreak text;
BEGIN
    v_prefix := coalesce(p_prefix, '');
    -- Keep the raw prefix for common-prefix calculations and escape only LIKE metacharacters.
    v_prefix_pattern := replace(v_prefix, chr(92), chr(92) || chr(92));
    v_prefix_pattern := replace(v_prefix_pattern, '%', chr(92) || '%');
    v_prefix_pattern := replace(v_prefix_pattern, '_', chr(92) || '_');

    -- COALESCE first: NULL NOT IN (...) evaluates to NULL (not TRUE), so a
    -- bare NOT IN check silently leaves an explicit NULL argument unreset.
    noncurrent_versions := COALESCE(noncurrent_versions, 'exclude');
    delete_markers := COALESCE(delete_markers, 'exclude');
    IF noncurrent_versions NOT IN ('exclude', 'only', 'include') THEN
        noncurrent_versions := 'exclude';
    END IF;
    IF delete_markers NOT IN ('exclude', 'only', 'include') THEN
        delete_markers := 'exclude';
    END IF;

    -- $9 is only populated in multi-row mode; it's always '' otherwise, so
    -- only use each row's real version as a tiebreak in multi-row mode.
    v_version_tiebreak := CASE WHEN noncurrent_versions IN ('only', 'include') THEN 'COALESCE(version, '''')' ELSE '''''' END;

    -- Defense-in-depth: this function is independently reachable and must
    -- not trust p_sort_order/p_sort_column to already be validated by a
    -- caller. Normalize to the same strict allow-list storage.search_v2
    -- uses before interpolating anything into dynamic SQL below.
    v_sort_order := lower(coalesce(p_sort_order, 'asc'));
    IF v_sort_order NOT IN ('asc', 'desc') THEN
        v_sort_order := 'asc';
    END IF;

    v_sort_column := lower(coalesce(p_sort_column, 'updated_at'));
    IF v_sort_column NOT IN ('updated_at', 'created_at') THEN
        v_sort_column := 'updated_at';
    END IF;

    IF v_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                o.version AS obj_version,
                o.archived_at AS obj_archived_at,
                o.is_delete_marker AS obj_is_delete_marker,
                o.is_versioned AS obj_is_versioned,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $10 || '%%'
              AND ($7 != 'exclude' OR o.archived_at IS NULL)
              AND ($7 != 'only' OR o.archived_at IS NOT NULL)
              AND ($8 != 'exclude' OR NOT o.is_delete_marker)
              AND ($8 != 'only' OR o.is_delete_marker)
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                common_prefix AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                NULL::text AS version,
                NULL::timestamptz AS archived_at,
                NULL::boolean AS is_delete_marker,
                NULL::boolean AS is_versioned,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                obj_version AS version,
                obj_archived_at AS archived_at,
                obj_is_delete_marker AS is_delete_marker,
                obj_is_versioned AS is_versioned,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz),
                    name COLLATE "C",
                    %s
                ) %s ROW(
                    -- truncated the same way as the stored value above
                    date_trunc('milliseconds', COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz)),
                    $5,
                    $9
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata,
            version,
            archived_at,
            is_delete_marker,
            is_versioned
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s,
            COALESCE(version, '') %s
        LIMIT $4
    $sql$,
        v_sort_column,
        v_version_tiebreak,
        v_cursor_op,
        v_sort_column,
        v_sort_order,
        v_sort_order,
        v_sort_order
    );

    -- version is the third tiebreak component for two versions of the same
    -- key tying on both timestamp and name (see filtered CTE / ORDER BY above)
    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after, noncurrent_versions, delete_markers, coalesce(p_start_after_version, ''), v_prefix_pattern;
END;
$_$;


ALTER FUNCTION "storage"."search_by_timestamp"("p_prefix" "text", "p_bucket_id" "text", "p_limit" integer, "p_level" integer, "p_start_after" "text", "p_sort_order" "text", "p_sort_column" "text", "p_sort_column_after" "text", "noncurrent_versions" "text", "delete_markers" "text", "p_start_after_version" "text") OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer DEFAULT 100, "levels" integer DEFAULT 1, "start_after" "text" DEFAULT ''::"text", "sort_order" "text" DEFAULT 'asc'::"text", "sort_column" "text" DEFAULT 'name'::"text", "sort_column_after" "text" DEFAULT ''::"text", "noncurrent_versions" "text" DEFAULT 'exclude'::"text", "delete_markers" "text" DEFAULT 'exclude'::"text", "start_after_archived_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "start_after_version" "text" DEFAULT ''::"text", "start_after_is_continuation" boolean DEFAULT false) RETURNS TABLE("key" "text", "name" "text", "id" "uuid", "updated_at" timestamp with time zone, "created_at" timestamp with time zone, "last_accessed_at" timestamp with time zone, "metadata" "jsonb", "version" "text", "archived_at" timestamp with time zone, "is_delete_marker" boolean, "is_versioned" boolean)
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata,
            l.version,
            l.archived_at,
            l.is_delete_marker,
            l.is_versioned
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            CASE WHEN start_after_is_continuation THEN '' ELSE start_after END,
            CASE WHEN start_after_is_continuation THEN start_after ELSE '' END,
            v_sort_ord,
            noncurrent_versions,
            delete_markers,
            start_after_archived_at,
            start_after_version
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after,
            noncurrent_versions, delete_markers, start_after_version
        );
    END IF;
END;
$$;


ALTER FUNCTION "storage"."search_v2"("prefix" "text", "bucket_name" "text", "limits" integer, "levels" integer, "start_after" "text", "sort_order" "text", "sort_column" "text", "sort_column_after" "text", "noncurrent_versions" "text", "delete_markers" "text", "start_after_archived_at" timestamp with time zone, "start_after_version" "text", "start_after_is_continuation" boolean) OWNER TO "supabase_storage_admin";


CREATE OR REPLACE FUNCTION "storage"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION "storage"."update_updated_at_column"() OWNER TO "supabase_storage_admin";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_rate_limits" (
    "key_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "request_count" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "edge_rate_limits_key_hash_check" CHECK (("length"("key_hash") = 64)),
    CONSTRAINT "edge_rate_limits_request_count_check" CHECK (("request_count" > 0))
);


ALTER TABLE "public"."edge_rate_limits" OWNER TO "postgres";


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
    CONSTRAINT "legal_consent_receipts_document_key_check" CHECK (("document_key" = ANY (ARRAY['terms'::"text", 'privacy'::"text", 'community'::"text"]))),
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
    CONSTRAINT "members_education_level_check" CHECK (("education_level" = ANY (ARRAY['bachelor'::"text", 'master'::"text", 'alumni'::"text"]))),
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


CREATE TABLE IF NOT EXISTS "public"."stamp_card_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "card_cycle" integer NOT NULL,
    "redeemed" boolean DEFAULT false NOT NULL,
    "redeemed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stamp_card_rewards" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."redemptions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "text",
    "redeemed_at" timestamp with time zone
);


ALTER TABLE "public"."redemptions" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."restaurant_comment_translations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "target_language" "text" NOT NULL,
    "translated_body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurant_comment_translations" OWNER TO "postgres";


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
    "updated_at"
   FROM "public"."restaurant_comments" "comment"
  WHERE ((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text") AND "public"."is_current_device_session"());


ALTER VIEW "public"."restaurant_comments_safe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_note_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid"
);


ALTER TABLE "public"."restaurant_note_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_note_translations" (
    "note_id" "uuid" NOT NULL,
    "target_language" "text" NOT NULL,
    "translated_body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurant_note_translations" OWNER TO "postgres";


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
            ELSE "avatar_color_seed"
        END AS "avatar_color_seed",
        CASE
            WHEN ("is_anonymous" OR ("user_id" <> ( SELECT "auth"."uid"() AS "uid"))) THEN NULL::"text"
            ELSE "profile_image_url"
        END AS "profile_image_url",
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
        END AS "source_tags"
   FROM "public"."restaurant_notes" "note"
  WHERE ((( SELECT ("auth"."jwt"() ->> 'app_access'::"text")) = 'true'::"text") AND "public"."is_current_device_session"());


ALTER VIEW "public"."restaurant_notes_safe" OWNER TO "postgres";


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
    CONSTRAINT "restaurants_spot_card_height_check" CHECK (("spot_card_height" = ANY (ARRAY['compact'::"text", 'full'::"text"]))),
    CONSTRAINT "restaurants_usullang_star_count_check" CHECK ((("usullang_star_count" >= 0) AND ("usullang_star_count" <= 3)))
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."restaurants"."one_line_review" IS '한 줄 평가 – shown on SpotCard between photos and 멤버 리뷰';



COMMENT ON COLUMN "public"."restaurants"."usullang_star_count" IS 'Admin-curated 0–3 우슐랭 stars displayed only on full SpotCards.';



COMMENT ON COLUMN "public"."restaurants"."show_usullang_stars" IS 'Whether the three 우슐랭 stars are displayed on a full SpotCard.';



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


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "redemption_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "store_id" "text" NOT NULL,
    "rating" numeric(3,1) NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 0.5) AND ("rating" <= 5.0) AND (("rating" * (2)::numeric) = "floor"(("rating" * (2)::numeric)))))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."translation_usage_months" (
    "month_start" "date" NOT NULL,
    "used_characters" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "translation_usage_months_used_characters_check" CHECK (("used_characters" >= 0))
);


ALTER TABLE "public"."translation_usage_months" OWNER TO "postgres";


COMMENT ON TABLE "public"."translation_usage_months" IS 'Hard safety cap for Google Translation: 450,000 source characters per calendar month.';



CREATE TABLE IF NOT EXISTS "storage"."buckets" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "public" boolean DEFAULT false,
    "avif_autodetection" boolean DEFAULT false,
    "file_size_limit" bigint,
    "allowed_mime_types" "text"[],
    "owner_id" "text",
    "type" "storage"."buckettype" DEFAULT 'STANDARD'::"storage"."buckettype" NOT NULL,
    "versioning_status" "text" DEFAULT 'DISABLED'::"text" NOT NULL,
    "lifecycle_configuration" "jsonb",
    "lifecycle_configuration_generation" "uuid",
    CONSTRAINT "buckets_lifecycle_configuration_pair_check" CHECK ((("lifecycle_configuration" IS NULL) = ("lifecycle_configuration_generation" IS NULL))),
    CONSTRAINT "buckets_lifecycle_configuration_shape_check" CHECK ((("lifecycle_configuration" IS NULL) OR (("jsonb_typeof"("lifecycle_configuration") = 'object'::"text") AND ("lifecycle_configuration" ? 'rules'::"text") AND
CASE
    WHEN ("jsonb_typeof"(("lifecycle_configuration" -> 'rules'::"text")) = 'array'::"text") THEN (("jsonb_array_length"(("lifecycle_configuration" -> 'rules'::"text")) >= 1) AND ("jsonb_array_length"(("lifecycle_configuration" -> 'rules'::"text")) <= 1000))
    ELSE false
END))),
    CONSTRAINT "buckets_lifecycle_configuration_standard_only_check" CHECK ((("type" = 'STANDARD'::"storage"."buckettype") OR (("lifecycle_configuration" IS NULL) AND ("lifecycle_configuration_generation" IS NULL)))),
    CONSTRAINT "buckets_versioning_dark_check" CHECK (("versioning_status" = 'DISABLED'::"text")),
    CONSTRAINT "buckets_versioning_standard_only_check" CHECK ((("type" = 'STANDARD'::"storage"."buckettype") OR ("versioning_status" = 'DISABLED'::"text"))),
    CONSTRAINT "buckets_versioning_status_check" CHECK (("versioning_status" = ANY (ARRAY['DISABLED'::"text", 'ENABLED'::"text", 'SUSPENDED'::"text"])))
);


ALTER TABLE "storage"."buckets" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."buckets"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."buckets_analytics" (
    "name" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'ANALYTICS'::"storage"."buckettype" NOT NULL,
    "format" "text" DEFAULT 'ICEBERG'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "storage"."buckets_analytics" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."buckets_vectors" (
    "id" "text" NOT NULL,
    "type" "storage"."buckettype" DEFAULT 'VECTOR'::"storage"."buckettype" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."buckets_vectors" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."migrations" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "hash" character varying(40) NOT NULL,
    "executed_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "storage"."migrations" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text",
    "name" "text",
    "owner" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_accessed_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb",
    "path_tokens" "text"[] GENERATED ALWAYS AS ("string_to_array"("name", '/'::"text")) STORED,
    "version" "text",
    "owner_id" "text",
    "user_metadata" "jsonb",
    "archived_at" timestamp with time zone,
    "is_delete_marker" boolean DEFAULT false NOT NULL,
    "is_versioned" boolean DEFAULT false NOT NULL
);


ALTER TABLE "storage"."objects" OWNER TO "supabase_storage_admin";


COMMENT ON COLUMN "storage"."objects"."owner" IS 'Field is deprecated, use owner_id instead';



CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads" (
    "id" "text" NOT NULL,
    "in_progress_size" bigint DEFAULT 0 NOT NULL,
    "upload_signature" "text" NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "version" "text" NOT NULL,
    "owner_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_metadata" "jsonb",
    "metadata" "jsonb"
);


ALTER TABLE "storage"."s3_multipart_uploads" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."s3_multipart_uploads_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "part_number" integer NOT NULL,
    "bucket_id" "text" NOT NULL,
    "key" "text" NOT NULL COLLATE "pg_catalog"."C",
    "etag" "text" NOT NULL,
    "owner_id" "text",
    "version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."s3_multipart_uploads_parts" OWNER TO "supabase_storage_admin";


CREATE TABLE IF NOT EXISTS "storage"."vector_indexes" (
    "id" "text" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL COLLATE "pg_catalog"."C",
    "bucket_id" "text" NOT NULL,
    "data_type" "text" NOT NULL,
    "dimension" integer NOT NULL,
    "distance_metric" "text" NOT NULL,
    "metadata_configuration" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "storage"."vector_indexes" OWNER TO "supabase_storage_admin";


ALTER TABLE ONLY "public"."privacy_action_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."privacy_action_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("key_hash");



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



ALTER TABLE ONLY "public"."partnership_integrations"
    ADD CONSTRAINT "partnership_integrations_pkey" PRIMARY KEY ("partnership_id");



ALTER TABLE ONLY "public"."partnerships"
    ADD CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_email_changes"
    ADD CONSTRAINT "pending_email_changes_old_user_id_key" UNIQUE ("old_user_id");



ALTER TABLE ONLY "public"."pending_email_changes"
    ADD CONSTRAINT "pending_email_changes_pkey" PRIMARY KEY ("new_user_id");



ALTER TABLE ONLY "public"."privacy_action_log"
    ADD CONSTRAINT "privacy_action_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."redemptions"
    ADD CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_comment_id_reporter_id_key" UNIQUE ("comment_id", "reporter_id");



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_comment_translations"
    ADD CONSTRAINT "restaurant_comment_translations_comment_id_target_language_key" UNIQUE ("comment_id", "target_language");



ALTER TABLE ONLY "public"."restaurant_comment_translations"
    ADD CONSTRAINT "restaurant_comment_translations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_note_id_reporter_id_key" UNIQUE ("note_id", "reporter_id");



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_note_translations"
    ADD CONSTRAINT "restaurant_note_translations_pkey" PRIMARY KEY ("note_id", "target_language");



ALTER TABLE ONLY "public"."restaurant_notes"
    ADD CONSTRAINT "restaurant_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_prompts"
    ADD CONSTRAINT "review_prompts_redemption_id_key" UNIQUE ("redemption_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_redemption_id_key" UNIQUE ("redemption_id");



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translation_usage_months"
    ADD CONSTRAINT "translation_usage_months_pkey" PRIMARY KEY ("month_start");



ALTER TABLE ONLY "storage"."buckets_analytics"
    ADD CONSTRAINT "buckets_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets"
    ADD CONSTRAINT "buckets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."buckets_vectors"
    ADD CONSTRAINT "buckets_vectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "storage"."migrations"
    ADD CONSTRAINT "migrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_pkey" PRIMARY KEY ("id");



CREATE INDEX "members_pending_student_number_idx" ON "public"."members" USING "btree" ("pending_student_number") WHERE ("pending_student_number" IS NOT NULL);



CREATE UNIQUE INDEX "members_username_canonical_unique" ON "public"."members" USING "btree" ("regexp_replace"("lower"(NORMALIZE("btrim"("username"), NFKC)), '[_-]+'::"text", ''::"text", 'g'::"text")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "members_username_lower_unique" ON "public"."members" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE INDEX "restaurant_comment_reports_open_created_idx" ON "public"."restaurant_comment_reports" USING "btree" ("created_at" DESC) WHERE ("reviewed_at" IS NULL);



CREATE INDEX "restaurant_comments_restaurant_created_idx" ON "public"."restaurant_comments" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "restaurant_note_reports_open_created_idx" ON "public"."restaurant_note_reports" USING "btree" ("created_at" DESC) WHERE ("reviewed_at" IS NULL);



CREATE INDEX "restaurant_notes_restaurant_created_idx" ON "public"."restaurant_notes" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE UNIQUE INDEX "stamp_card_rewards_cycle_unique" ON "public"."stamp_card_rewards" USING "btree" ("user_id", "restaurant_id", "card_cycle");



CREATE UNIQUE INDEX "stamp_card_visits_member_daily_unique" ON "public"."stamp_card_visits" USING "btree" ("user_id", "restaurant_id", ((("visited_at" AT TIME ZONE 'Europe/Amsterdam'::"text"))::"date")) WHERE ("added_by_admin" IS FALSE);



CREATE UNIQUE INDEX "bname" ON "storage"."buckets" USING "btree" ("name");



CREATE UNIQUE INDEX "buckets_analytics_unique_name_idx" ON "storage"."buckets_analytics" USING "btree" ("name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_multipart_uploads_list" ON "storage"."s3_multipart_uploads" USING "btree" ("bucket_id", "key", "created_at");



CREATE INDEX "idx_objects_bucket_id_name" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C");



CREATE INDEX "idx_objects_bucket_id_name_lower" ON "storage"."objects" USING "btree" ("bucket_id", "lower"("name") COLLATE "C");



CREATE UNIQUE INDEX "idx_objects_current_version" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C") WHERE ("archived_at" IS NULL);



CREATE INDEX "idx_objects_delete_markers" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C") WHERE "is_delete_marker";



CREATE UNIQUE INDEX "idx_objects_null_version" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C") WHERE (NOT "is_versioned");



CREATE INDEX "name_prefix_search" ON "storage"."objects" USING "btree" ("name" "text_pattern_ops");



CREATE UNIQUE INDEX "objects_bucket_id_name_version_key" ON "storage"."objects" USING "btree" ("bucket_id", "name" COLLATE "C", "version") NULLS NOT DISTINCT;



CREATE UNIQUE INDEX "vector_indexes_name_bucket_id_idx" ON "storage"."vector_indexes" USING "btree" ("name", "bucket_id");



CREATE OR REPLACE TRIGGER "keep_ten_restaurant_comments" AFTER INSERT ON "public"."restaurant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."keep_ten_restaurant_comments"();



CREATE OR REPLACE TRIGGER "keep_ten_restaurant_notes" AFTER INSERT ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."keep_ten_restaurant_notes"();



CREATE OR REPLACE TRIGGER "on_redemption_created" AFTER INSERT ON "public"."redemptions" FOR EACH ROW EXECUTE FUNCTION "public"."create_review_prompt_on_redemption"();



CREATE OR REPLACE TRIGGER "prepare_restaurant_comment" BEFORE INSERT OR UPDATE ON "public"."restaurant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_restaurant_comment"();



CREATE OR REPLACE TRIGGER "prepare_restaurant_note" BEFORE INSERT OR UPDATE ON "public"."restaurant_notes" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_restaurant_note"();



CREATE OR REPLACE TRIGGER "set_comment_report_reviewed_metadata" BEFORE UPDATE OF "reviewed_at", "reviewed_by" ON "public"."restaurant_comment_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_report_reviewed_metadata"();



CREATE OR REPLACE TRIGGER "set_note_report_reviewed_metadata" BEFORE UPDATE OF "reviewed_at", "reviewed_by" ON "public"."restaurant_note_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_report_reviewed_metadata"();



CREATE OR REPLACE TRIGGER "trg_sync_member_analytics_profile" AFTER INSERT OR UPDATE OF "University", "country_of_origin", "major", "education_level", "year_number", "year_of_birth", "gender" ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_member_analytics_profile"();



CREATE OR REPLACE TRIGGER "trg_sync_membership_ended_at" BEFORE INSERT OR UPDATE OF "membership_valid_until" ON "public"."members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_membership_ended_at"();



CREATE OR REPLACE TRIGGER "enforce_bucket_name_length_trigger" BEFORE INSERT OR UPDATE OF "name" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_name_length"();



CREATE OR REPLACE TRIGGER "protect_bucket_control_insert" BEFORE INSERT ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."protect_bucket_control_columns"('service_role');



CREATE OR REPLACE TRIGGER "protect_bucket_control_update" BEFORE UPDATE OF "lifecycle_configuration", "lifecycle_configuration_generation" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."protect_bucket_control_columns"();



CREATE OR REPLACE TRIGGER "protect_bucket_control_update_role" AFTER UPDATE OF "lifecycle_configuration", "lifecycle_configuration_generation" ON "storage"."buckets" FOR EACH ROW EXECUTE FUNCTION "storage"."enforce_bucket_lifecycle_service_role"('service_role');



CREATE OR REPLACE TRIGGER "protect_buckets_delete" BEFORE DELETE ON "storage"."buckets" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "protect_objects_delete" BEFORE DELETE ON "storage"."objects" FOR EACH STATEMENT EXECUTE FUNCTION "storage"."protect_delete"();



CREATE OR REPLACE TRIGGER "update_objects_updated_at" BEFORE UPDATE ON "storage"."objects" FOR EACH ROW EXECUTE FUNCTION "storage"."update_updated_at_column"();



ALTER TABLE ONLY "public"."admin_roles"
    ADD CONSTRAINT "admin_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."partnership_integrations"
    ADD CONSTRAINT "partnership_integrations_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."restaurant_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comment_reports"
    ADD CONSTRAINT "restaurant_comment_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comment_translations"
    ADD CONSTRAINT "restaurant_comment_translations_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."restaurant_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_comments"
    ADD CONSTRAINT "restaurant_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."restaurant_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_note_reports"
    ADD CONSTRAINT "restaurant_note_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_note_translations"
    ADD CONSTRAINT "restaurant_note_translations_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."restaurant_notes"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."redemptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_config"
    ADD CONSTRAINT "stamp_card_config_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_rewards"
    ADD CONSTRAINT "stamp_card_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stamp_card_visits"
    ADD CONSTRAINT "stamp_card_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."objects"
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads"
    ADD CONSTRAINT "s3_multipart_uploads_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");



ALTER TABLE ONLY "storage"."s3_multipart_uploads_parts"
    ADD CONSTRAINT "s3_multipart_uploads_parts_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "storage"."s3_multipart_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "storage"."vector_indexes"
    ADD CONSTRAINT "vector_indexes_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets_vectors"("id");



CREATE POLICY "Admins can delete any restaurant comment" ON "public"."restaurant_comments" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete any restaurant note" ON "public"."restaurant_notes" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read note reports" ON "public"."restaurant_note_reports" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can review comment reports" ON "public"."restaurant_comment_reports" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK (("public"."is_admin"() AND ("reviewed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("reviewed_at" IS NOT NULL)));



CREATE POLICY "Admins can review note reports" ON "public"."restaurant_note_reports" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK (("public"."is_admin"() AND ("reviewed_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("reviewed_at" IS NOT NULL)));



CREATE POLICY "Admins delete members" ON "public"."members" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins manage events" ON "public"."events" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins manage restaurants" ON "public"."restaurants" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Auth hook reads login OTP grants" ON "public"."login_otp_exempt_users" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Auth hook reads verified login sessions" ON "public"."login_otp_verified_sessions" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Authenticated members can read comment translations" ON "public"."restaurant_comment_translations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated members can read restaurant comments" ON "public"."restaurant_comments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated members can read restaurant notes" ON "public"."restaurant_notes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Members and admins can read member rows" ON "public"."members" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members and admins can read own redemptions" ON "public"."redemptions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members and admins can read own reviews" ON "public"."reviews" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members and admins can read stamp rewards" ON "public"."stamp_card_rewards" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members and admins can read stamp visits" ON "public"."stamp_card_visits" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members and admins can update member rows" ON "public"."members" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"())) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



CREATE POLICY "Members can delete their own restaurant comments" ON "public"."restaurant_comments" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can delete their own restaurant notes" ON "public"."restaurant_notes" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can insert review for own redemption" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."redemptions" "redemption"
  WHERE (("redemption"."id" = "reviews"."redemption_id") AND ("redemption"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("redemption"."store_id" = "reviews"."store_id") AND ("redemption"."redeemed_at" IS NOT NULL) AND ("redemption"."redeemed_at" <= "now"()))))));



CREATE POLICY "Members can insert their own restaurant comments" ON "public"."restaurant_comments" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can insert their own restaurant notes" ON "public"."restaurant_notes" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can read note translations" ON "public"."restaurant_note_translations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Members can report comments once" ON "public"."restaurant_comment_reports" FOR INSERT TO "authenticated" WITH CHECK (("reporter_id" = "auth"."uid"()));



CREATE POLICY "Members can report restaurant notes" ON "public"."restaurant_note_reports" FOR INSERT TO "authenticated" WITH CHECK (("reporter_id" = "auth"."uid"()));



CREATE POLICY "Members can see their own reports" ON "public"."restaurant_comment_reports" FOR SELECT TO "authenticated" USING ((("reporter_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Members can update their own restaurant comments" ON "public"."restaurant_comments" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can update their own restaurant notes" ON "public"."restaurant_notes" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Public can read partnerships" ON "public"."partnerships" FOR SELECT USING (true);



CREATE POLICY "Public read events" ON "public"."events" FOR SELECT USING (true);



CREATE POLICY "Public read restaurants" ON "public"."restaurants" FOR SELECT USING (true);



CREATE POLICY "Users can read own admin role" ON "public"."admin_roles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own prompts" ON "public"."review_prompts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own prompts" ON "public"."review_prompts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."admin_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_consent_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_otp_exempt_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_otp_verified_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_analytics_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partnership_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partnerships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_email_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."privacy_action_log" ENABLE ROW LEVEL SECURITY;


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



CREATE POLICY "require_app_login" ON "public"."restaurant_comment_translations" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_comments" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_note_reports" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_note_translations" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurant_notes" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."restaurants" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."review_prompts" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."reviews" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_config" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_rewards" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



CREATE POLICY "require_app_login" ON "public"."stamp_card_visits" AS RESTRICTIVE TO "authenticated" USING (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text"), false) AS "coalesce"));



ALTER TABLE "public"."restaurant_comment_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_comment_translations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_note_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_note_translations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stamp_card_config insert admin" ON "public"."stamp_card_config" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "stamp_card_config select admin" ON "public"."stamp_card_config" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "stamp_card_config select authenticated" ON "public"."stamp_card_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "stamp_card_config update admin" ON "public"."stamp_card_config" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."stamp_card_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stamp_card_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."translation_usage_months" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "관리자 멤버 삭제" ON "public"."members" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 식당 삭제" ON "public"."restaurants" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 식당 수정" ON "public"."restaurants" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 식당 추가" ON "public"."restaurants" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 이벤트 삭제" ON "public"."events" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 이벤트 수정" ON "public"."events" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "관리자 이벤트 추가" ON "public"."events" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_roles"
  WHERE ("admin_roles"."user_id" = "auth"."uid"()))));



CREATE POLICY "식당 공개 조회" ON "public"."restaurants" FOR SELECT USING (true);



CREATE POLICY "이벤트 공개 조회" ON "public"."events" FOR SELECT USING (true);



CREATE POLICY "Require app login for profile images" ON "storage"."objects" AS RESTRICTIVE TO "authenticated" USING ((("bucket_id" <> 'profile-images'::"text") OR COALESCE(( SELECT (("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text")), false))) WITH CHECK ((("bucket_id" <> 'profile-images'::"text") OR COALESCE(( SELECT (("auth"."jwt"() ->> 'app_access'::"text") = 'true'::"text")), false)));



CREATE POLICY "SEC07 admin manage event images" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'event-images'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'event-images'::"text") AND "public"."is_admin"()));



CREATE POLICY "SEC07 admin manage place images" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'place-images'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'place-images'::"text") AND "public"."is_admin"()));



CREATE POLICY "SEC07 admin manage profile images" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'profile-images'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'profile-images'::"text") AND "public"."is_admin"()));



CREATE POLICY "SEC07 profile owner delete own avatar" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'profile-images'::"text") AND ("name" = (('avatars/'::"text" || (( SELECT "auth"."uid"() AS "uid"))::"text") || '.jpg'::"text")) AND ("owner_id" = (( SELECT "auth"."uid"() AS "uid"))::"text")));



CREATE POLICY "SEC07 profile owner read own avatar" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'profile-images'::"text") AND ("name" = (('avatars/'::"text" || (( SELECT "auth"."uid"() AS "uid"))::"text") || '.jpg'::"text")) AND ("owner_id" = (( SELECT "auth"."uid"() AS "uid"))::"text")));



CREATE POLICY "SEC07 profile owner replace own avatar" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'profile-images'::"text") AND ("name" = (('avatars/'::"text" || (( SELECT "auth"."uid"() AS "uid"))::"text") || '.jpg'::"text")) AND ("owner_id" = (( SELECT "auth"."uid"() AS "uid"))::"text"))) WITH CHECK ((("bucket_id" = 'profile-images'::"text") AND ("name" = (('avatars/'::"text" || (( SELECT "auth"."uid"() AS "uid"))::"text") || '.jpg'::"text")) AND ("owner_id" = (( SELECT "auth"."uid"() AS "uid"))::"text")));



CREATE POLICY "SEC07 profile owner upload own avatar" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'profile-images'::"text") AND ("name" = (('avatars/'::"text" || (( SELECT "auth"."uid"() AS "uid"))::"text") || '.jpg'::"text")) AND ("owner_id" = (( SELECT "auth"."uid"() AS "uid"))::"text")));



ALTER TABLE "storage"."buckets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."buckets_vectors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."migrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."s3_multipart_uploads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."s3_multipart_uploads_parts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "storage"."vector_indexes" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "storage" TO "postgres" WITH GRANT OPTION;
GRANT USAGE ON SCHEMA "storage" TO "anon";
GRANT USAGE ON SCHEMA "storage" TO "authenticated";
GRANT USAGE ON SCHEMA "storage" TO "service_role";
GRANT ALL ON SCHEMA "storage" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON SCHEMA "storage" TO "dashboard_user";



REVOKE ALL ON FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_add_stamp_card_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid", "p_visited_at" timestamp with time zone, "p_admin_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."anonymize_expired_members"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."anonymize_expired_members_for_sheets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anonymize_expired_members_for_sheets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."birth_year_to_age_group"("birth_year" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_redemption_window"("p_user_id" "uuid", "p_store_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_single_device_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_single_device_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_single_device_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_pending_email_change"("p_new_user_id" "uuid", "p_confirmed_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_edge_rate_limit"("p_key_hash" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."country_to_region"("country" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_review_prompt_on_redemption"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_review_prompt_on_redemption"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_review_prompt_on_redemption"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_pending_auth_user_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_store_review_summaries"("p_store_ids" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_current_device_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_current_device_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_device_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_valid_member_username"("value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_comments"() TO "anon";
GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_comments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_comments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_notes"() TO "anon";
GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_notes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keep_ten_restaurant_notes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."major_to_faculty"("major" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_restaurant_comment"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_restaurant_comment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_restaurant_comment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_restaurant_note"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_restaurant_note"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_restaurant_note"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_member_stamp_visit"("p_user_id" "uuid", "p_restaurant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_translation_characters"("requested_characters" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_report_reviewed_metadata"() TO "service_role";



GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."study_stage"("education_level" "text", "year_number" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_member_analytics_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_member_analytics_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_member_analytics_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_membership_ended_at"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."edge_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."legal_consent_receipts" TO "service_role";



GRANT SELECT ON TABLE "public"."login_otp_exempt_users" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."login_otp_exempt_users" TO "service_role";



GRANT SELECT ON TABLE "public"."login_otp_verified_sessions" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."login_otp_verified_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."member_analytics_profiles" TO "anon";
GRANT ALL ON TABLE "public"."member_analytics_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."member_analytics_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."members" TO "service_role";
GRANT SELECT,DELETE ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("session_token") ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("profile_image_url") ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("tutorial_completed_at") ON TABLE "public"."members" TO "authenticated";



GRANT UPDATE("username") ON TABLE "public"."members" TO "authenticated";



GRANT ALL ON TABLE "public"."stamp_card_visits" TO "service_role";
GRANT SELECT ON TABLE "public"."stamp_card_visits" TO "authenticated";



GRANT ALL ON TABLE "public"."partner_monthly_insights_view" TO "service_role";



GRANT ALL ON TABLE "public"."partner_monthly_insights_owner_view" TO "service_role";



GRANT ALL ON TABLE "public"."stamp_card_rewards" TO "service_role";
GRANT SELECT ON TABLE "public"."stamp_card_rewards" TO "authenticated";



GRANT ALL ON TABLE "public"."partner_operations_view" TO "service_role";



GRANT ALL ON TABLE "public"."partner_operations_owner_view" TO "service_role";



GRANT SELECT ON TABLE "public"."partnership_integrations" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."partnerships" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."partnerships" TO "authenticated";
GRANT ALL ON TABLE "public"."partnerships" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."partnerships" TO "anon";
GRANT SELECT("id") ON TABLE "public"."partnerships" TO "authenticated";



GRANT SELECT("sheet_name") ON TABLE "public"."partnerships" TO "anon";
GRANT SELECT("sheet_name") ON TABLE "public"."partnerships" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."partnerships" TO "anon";
GRANT SELECT("name") ON TABLE "public"."partnerships" TO "authenticated";



GRANT ALL ON TABLE "public"."pending_email_changes" TO "service_role";



GRANT ALL ON TABLE "public"."privacy_action_log" TO "anon";
GRANT ALL ON TABLE "public"."privacy_action_log" TO "authenticated";
GRANT ALL ON TABLE "public"."privacy_action_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."privacy_action_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."privacy_action_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."privacy_action_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."redemptions" TO "service_role";
GRANT SELECT ON TABLE "public"."redemptions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."redemptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."redemptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."redemptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_comment_reports" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."restaurant_comment_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comment_reports" TO "service_role";



GRANT UPDATE("reviewed_at") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT UPDATE("reviewed_by") ON TABLE "public"."restaurant_comment_reports" TO "authenticated";



GRANT ALL ON TABLE "public"."restaurant_comment_translations" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_comment_translations" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comment_translations" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_comments" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comments" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_comments_safe" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_comments_safe" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_comments_safe" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_note_reports" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."restaurant_note_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_note_reports" TO "service_role";



GRANT UPDATE("reviewed_at") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT UPDATE("reviewed_by") ON TABLE "public"."restaurant_note_reports" TO "authenticated";



GRANT ALL ON TABLE "public"."restaurant_note_translations" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_note_translations" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_note_translations" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_notes" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_notes" TO "service_role";



GRANT ALL ON TABLE "public"."restaurant_notes_safe" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_notes_safe" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_notes_safe" TO "service_role";



GRANT ALL ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."review_prompts" TO "anon";
GRANT ALL ON TABLE "public"."review_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."review_prompts" TO "service_role";



GRANT REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."stamp_card_config" TO "anon";
GRANT ALL ON TABLE "public"."stamp_card_config" TO "authenticated";
GRANT ALL ON TABLE "public"."stamp_card_config" TO "service_role";



GRANT ALL ON TABLE "public"."translation_usage_months" TO "service_role";



REVOKE ALL ON TABLE "storage"."buckets" FROM "supabase_storage_admin";
GRANT ALL ON TABLE "storage"."buckets" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."buckets" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets" TO "anon";
GRANT ALL ON TABLE "storage"."buckets" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "storage"."buckets_analytics" TO "service_role";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "authenticated";
GRANT ALL ON TABLE "storage"."buckets_analytics" TO "anon";



GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "service_role";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "authenticated";
GRANT SELECT ON TABLE "storage"."buckets_vectors" TO "anon";



REVOKE ALL ON TABLE "storage"."objects" FROM "supabase_storage_admin";
GRANT ALL ON TABLE "storage"."objects" TO "supabase_storage_admin" WITH GRANT OPTION;
GRANT ALL ON TABLE "storage"."objects" TO "service_role";
GRANT ALL ON TABLE "storage"."objects" TO "authenticated";
GRANT ALL ON TABLE "storage"."objects" TO "anon";
GRANT ALL ON TABLE "storage"."objects" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "storage"."s3_multipart_uploads" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads" TO "anon";



GRANT ALL ON TABLE "storage"."s3_multipart_uploads_parts" TO "service_role";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "authenticated";
GRANT SELECT ON TABLE "storage"."s3_multipart_uploads_parts" TO "anon";



GRANT SELECT ON TABLE "storage"."vector_indexes" TO "service_role";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "authenticated";
GRANT SELECT ON TABLE "storage"."vector_indexes" TO "anon";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "storage" GRANT ALL ON TABLES TO "service_role";




