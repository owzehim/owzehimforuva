create table if not exists public.restaurant_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.restaurant_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);

create table if not exists public.restaurant_comment_translations (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.restaurant_comments(id) on delete cascade,
  target_language text not null,
  translated_body text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, target_language)
);

alter table public.restaurant_comment_reports enable row level security;
alter table public.restaurant_comment_translations enable row level security;

create policy "Members can report comments once" on public.restaurant_comment_reports
for insert to authenticated with check (reporter_id = auth.uid());
create policy "Members can see their own reports" on public.restaurant_comment_reports
for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "Authenticated members can read comment translations" on public.restaurant_comment_translations
for select to authenticated using (true);

create policy "Admins can delete any restaurant comment" on public.restaurant_comments
for delete to authenticated using (public.is_admin());
