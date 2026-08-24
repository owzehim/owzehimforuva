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

comment on column public.members.username
is 'Member-selected public display name for community comments.';
