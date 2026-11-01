-- Hero Bingo: option to allow only one square per hero on a card (their win or one of their hero challenges).
-- Additive and safe to run before the site update ships.
alter table public.bingo_settings
  add column if not exists one_per_hero boolean not null default false;
