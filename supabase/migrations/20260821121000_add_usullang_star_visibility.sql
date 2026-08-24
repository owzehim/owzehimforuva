alter table public.restaurants
add column if not exists show_usullang_stars boolean not null default false;

comment on column public.restaurants.show_usullang_stars
is 'Whether the three 우슐랭 stars are displayed on a full SpotCard.';
