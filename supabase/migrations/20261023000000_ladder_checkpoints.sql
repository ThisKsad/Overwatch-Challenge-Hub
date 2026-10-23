-- Hero Ladder checkpoints: after every n cleared heroes a loss no longer drops a player below that rung.
-- 0 turns checkpoints off. Additive and safe to run before the site update ships.
alter table public.ladder_settings
  add column if not exists checkpoint_every integer not null default 0
  check (checkpoint_every >= 0);
