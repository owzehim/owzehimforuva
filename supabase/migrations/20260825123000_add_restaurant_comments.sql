create table if not exists public.restaurant_comments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  is_anonymous boolean not null default false,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_comments_restaurant_created_idx
on public.restaurant_comments (restaurant_id, created_at desc);

create or replace function public.prepare_restaurant_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.keep_ten_restaurant_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists prepare_restaurant_comment on public.restaurant_comments;
create trigger prepare_restaurant_comment
before insert or update on public.restaurant_comments
for each row execute function public.prepare_restaurant_comment();

drop trigger if exists keep_ten_restaurant_comments on public.restaurant_comments;
create trigger keep_ten_restaurant_comments
after insert on public.restaurant_comments
for each row execute function public.keep_ten_restaurant_comments();

alter table public.restaurant_comments enable row level security;

create policy "Authenticated members can read restaurant comments"
on public.restaurant_comments for select to authenticated using (true);

create policy "Members can insert their own restaurant comments"
on public.restaurant_comments for insert to authenticated
with check (user_id = auth.uid());

create policy "Members can update their own restaurant comments"
on public.restaurant_comments for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Members can delete their own restaurant comments"
on public.restaurant_comments for delete to authenticated
using (user_id = auth.uid());

alter publication supabase_realtime add table public.restaurant_comments;

comment on table public.restaurant_comments
is 'Newest ten member comments per restaurant, with a one-comment-per-Europe/Amsterdam-day rule.';
