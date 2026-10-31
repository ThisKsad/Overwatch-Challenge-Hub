-- Hero Bingo: two more challenge lists next to the general pool.
-- "Win a match as <hero>" squares are built on the page from the hero list; only the heroes switched off are stored here.
-- Hero-specific challenges ("Hit 4 sleeps as Ana") live in their own table, so the general pool stays untouched.
-- Additive and safe to run before the site update ships.

create table if not exists public.bingo_settings (
  id integer primary key default 1 check (id = 1),
  win_per_card integer not null default 2 check (win_per_card between 0 and 25),
  hero_per_card integer not null default 4 check (hero_per_card between 0 and 25),
  win_off jsonb not null default '[]'::jsonb
);
insert into public.bingo_settings (id) values (1) on conflict (id) do nothing;

alter table public.bingo_settings enable row level security;
drop policy if exists "anyone can read" on public.bingo_settings;
create policy "anyone can read" on public.bingo_settings for select using (true);
drop policy if exists "anyone can change" on public.bingo_settings;
create policy "anyone can change" on public.bingo_settings for update using (true) with check (true);

create table if not exists public.bingo_hero_pool (
  id text primary key,
  hero text not null,
  text text not null,
  enabled boolean not null default true,
  sort bigint not null default 0
);

alter table public.bingo_hero_pool enable row level security;
drop policy if exists "anyone can read" on public.bingo_hero_pool;
create policy "anyone can read" on public.bingo_hero_pool for select using (true);
drop policy if exists "anyone can add" on public.bingo_hero_pool;
create policy "anyone can add" on public.bingo_hero_pool for insert with check (true);
drop policy if exists "anyone can change" on public.bingo_hero_pool;
create policy "anyone can change" on public.bingo_hero_pool for update using (true) with check (true);
drop policy if exists "anyone can delete" on public.bingo_hero_pool;
create policy "anyone can delete" on public.bingo_hero_pool for delete using (true);

grant select, update on public.bingo_settings to anon, authenticated;
grant select, insert, update, delete on public.bingo_hero_pool to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bingo_settings') then
    alter publication supabase_realtime add table public.bingo_settings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bingo_hero_pool') then
    alter publication supabase_realtime add table public.bingo_hero_pool;
  end if;
end $$;
