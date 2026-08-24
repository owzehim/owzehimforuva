alter table public.restaurants
add column if not exists usullang_star_count smallint not null default 0
check (usullang_star_count between 0 and 3);

comment on column public.restaurants.usullang_star_count
is 'Admin-curated 0–3 우슐랭 stars displayed only on full SpotCards.';
