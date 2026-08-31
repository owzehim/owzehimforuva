alter table public.members
add column if not exists username text;

alter table public.members
drop constraint if exists members_username_length_check;

alter table public.members
add constraint members_username_length_check
check (username is null or (char_length(btrim(username)) between 2 and 24));

create unique index if not exists members_username_lower_unique
on public.members (lower(username))
where username is not null;

create table if not exists public.restaurant_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  is_anonymous boolean not null default false,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_notes_restaurant_created_idx
on public.restaurant_notes (restaurant_id, created_at desc);

create table if not exists public.restaurant_note_reports (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.restaurant_notes(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, reporter_id)
);

create table if not exists public.restaurant_note_translations (
  note_id uuid not null references public.restaurant_notes(id) on delete cascade,
  target_language text not null,
  translated_body text not null,
  created_at timestamptz not null default now(),
  primary key (note_id, target_language)
);

create or replace function public.prepare_restaurant_note()
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

    new.username := current_username;
  else
    if old.user_id <> auth.uid() then
      raise exception 'cannot edit another user note';
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

create or replace function public.keep_ten_restaurant_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists prepare_restaurant_note on public.restaurant_notes;
create trigger prepare_restaurant_note
before insert or update on public.restaurant_notes
for each row execute function public.prepare_restaurant_note();

drop trigger if exists keep_ten_restaurant_notes on public.restaurant_notes;
create trigger keep_ten_restaurant_notes
after insert on public.restaurant_notes
for each row execute function public.keep_ten_restaurant_notes();

alter table public.restaurant_notes enable row level security;
alter table public.restaurant_note_reports enable row level security;
alter table public.restaurant_note_translations enable row level security;

create policy "Authenticated members can read restaurant notes"
on public.restaurant_notes for select to authenticated using (true);

create policy "Members can insert their own restaurant notes"
on public.restaurant_notes for insert to authenticated
with check (user_id = auth.uid());

create policy "Members can update their own restaurant notes"
on public.restaurant_notes for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Members can delete their own restaurant notes"
on public.restaurant_notes for delete to authenticated
using (user_id = auth.uid());

create policy "Admins can delete any restaurant note"
on public.restaurant_notes for delete to authenticated
using (public.is_admin());

create policy "Members can report restaurant notes"
on public.restaurant_note_reports for insert to authenticated
with check (reporter_id = auth.uid());

create policy "Members can read note translations"
on public.restaurant_note_translations for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.restaurant_notes;
exception
  when duplicate_object then null;
end;
$$;

comment on table public.restaurant_notes
is 'Newest ten Good to Know Notes per restaurant, with a one-note-per-Europe/Amsterdam-day rule.';
