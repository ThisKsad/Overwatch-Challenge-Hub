-- Baseline schema of the Supabase project "Ultimate Hunt" (ref dwsieddjvldzurosjdpp),
-- read from the live database on 2026-10-16. The site had no migrations before this one.
--
-- The script is idempotent: running it against the live database changes nothing,
-- running it against an empty project rebuilds everything the site needs.
-- If you use the Supabase CLI against the live project, mark it as applied first:
--   supabase migration repair --status applied 20261009000000

-- Players are fixed: lukas, philipp, daniel. 'tie' is only a valid winner, 'shared' only a bingo card.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

-- Current round of Ultimate Hunt and Hero Bingo (one row per mode).
create table if not exists public.rounds (
  mode       text primary key check (mode in ('hunt', 'bingo')),
  winner     text check (winner in ('lukas', 'philipp', 'daniel', 'tie')),
  won_at     timestamptz,
  how        text,
  started_at timestamptz not null default now()
);

-- Finished games of every mode, read by the stats page.
create table if not exists public.game_results (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null check (mode in ('hunt', 'bingo', 'ladder', 'wheel')),
  finished_at timestamptz not null default now(),
  winner      text check (winner in ('lukas', 'philipp', 'daniel', 'tie')),
  data        jsonb not null default '{}'::jsonb
);

-- Ultimate Hunt: ultimates landed per player and hero.
create table if not exists public.ultimates (
  player text not null check (player in ('lukas', 'philipp', 'daniel')),
  hero   text not null,
  count  integer not null default 0 check (count >= 0),
  primary key (player, hero)
);

-- Mystery Wheel
create table if not exists public.wheel_removed (
  player text not null check (player in ('lukas', 'philipp', 'daniel')),
  hero   text not null,
  primary key (player, hero)
);

create table if not exists public.wheel_order (
  player     text primary key check (player in ('lukas', 'philipp', 'daniel')),
  hero_order text[] not null
);

create table if not exists public.wheel_state (
  id      integer primary key check (id = 1),
  sel     jsonb not null default '{"lukas": true, "daniel": true, "philipp": true}'::jsonb,
  opts    jsonb not null default '{"limits": true, "balance": true}'::jsonb,
  pending jsonb
);

-- Hero Ladder
create table if not exists public.ladder_settings (
  id           integer primary key check (id = 1),
  drop_on_loss boolean not null default true,
  squad        boolean not null default false, -- not read by the site any more
  role_limits  boolean not null default false
);

create table if not exists public.ladder_players (
  player     text primary key check (player in ('lukas', 'philipp', 'daniel')),
  hero_order text[] not null,
  pos        integer not null default 0,
  w          integer not null default 0,
  l          integer not null default 0,
  hist       jsonb not null default '[]'::jsonb
);

-- Hero Bingo
create table if not exists public.bingo_pool (
  id      text primary key,
  text    text not null,
  enabled boolean not null default true,
  sort    bigint not null default 0
);

-- cells: jsonb array of 25 objects; own cards use {"d": bool}, the shared card {"by": [players]}.
create table if not exists public.bingo_cards (
  card  text primary key check (card in ('lukas', 'philipp', 'daniel', 'shared')),
  cells jsonb not null
);

-- Legacy: superseded by rounds/game_results and no longer used by the site.
-- Kept because they exist (with data) in the live project.
create table if not exists public.hunt_state (
  id      integer primary key check (id = 1),
  run_no  integer not null default 1,
  winner  text,
  won_at  timestamptz
);

create table if not exists public.bingo_state (
  id       integer primary key check (id = 1),
  round_no integer not null default 1,
  winner   text,
  won_at   timestamptz
);

create table if not exists public.stat_events (
  id     bigint generated always as identity primary key,
  ts     timestamptz not null default now(),
  mode   text not null check (mode in ('hunt', 'bingo', 'ladder', 'wheel')),
  kind   text not null,
  player text,
  hero   text,
  data   jsonb not null default '{}'::jsonb
);
create index if not exists stat_events_mode_kind on public.stat_events (mode, kind);

------------------------------------------------------------------------------
-- Singleton rows the site expects to exist
------------------------------------------------------------------------------

insert into public.rounds (mode) values ('hunt'), ('bingo') on conflict do nothing;
insert into public.wheel_state (id) values (1) on conflict do nothing;
insert into public.ladder_settings (id) values (1) on conflict do nothing;
insert into public.hunt_state (id) values (1) on conflict do nothing;
insert into public.bingo_state (id) values (1) on conflict do nothing;

------------------------------------------------------------------------------
-- RPCs used by the site
------------------------------------------------------------------------------

-- Ultimate Hunt: add p_delta (may be negative) to a player's count for a hero, never below 0.
create or replace function public.bump(p_player text, p_hero text, p_delta integer)
returns integer
language plpgsql
as $function$
declare
  new_count integer;
begin
  insert into public.ultimates as u (player, hero, count)
  values (p_player, p_hero, greatest(0, p_delta))
  on conflict (player, hero)
  do update set count = greatest(0, u.count + p_delta)
  returning u.count into new_count;
  return new_count;
end;
$function$;

-- Claim the current round; only the first claim wins. Returns true if this call won.
create or replace function public.round_claim(p_mode text, p_winner text, p_how text)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare n integer;
begin
  if p_mode not in ('hunt', 'bingo') or p_winner not in ('lukas', 'philipp', 'daniel', 'tie') then return false; end if;
  update public.rounds set winner = p_winner, won_at = now(), how = p_how where mode = p_mode and winner is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$function$;

-- Bingo: give back a bingo win when the winning line is unticked again.
create or replace function public.round_release(p_mode text, p_winner text)
returns void
language sql
set search_path to 'public'
as $function$
  update public.rounds set winner = null, won_at = null, how = null
  where mode = p_mode and winner = p_winner and how = 'bingo';
$function$;

-- Write the claimed round to game_results and start a new one.
create or replace function public.round_finish(p_mode text, p_data jsonb)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare w text; h text;
begin
  if p_mode not in ('hunt', 'bingo') then return false; end if;
  select winner, how into w, h from public.rounds where mode = p_mode for update;
  if w is null then return false; end if;
  insert into public.game_results (mode, winner, data) values (p_mode, w, coalesce(p_data, '{}'::jsonb) || jsonb_build_object('how', h));
  update public.rounds set winner = null, won_at = null, how = null, started_at = now() where mode = p_mode;
  return true;
end;
$function$;

-- Reset a round without recording a result. Not called by the site today.
create or replace function public.round_new(p_mode text)
returns void
language sql
set search_path to 'public'
as $function$
  update public.rounds set winner = null, won_at = null, how = null, started_at = now() where mode = p_mode;
$function$;

-- Bingo: toggle one cell atomically. Own cards flip "d"; the shared card adds/removes the player in "by".
create or replace function public.bingo_toggle(p_card text, p_idx integer, p_player text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  cur jsonb;
  cell jsonb;
  arr jsonb;
begin
  if p_idx < 0 or p_idx > 24 or p_player not in ('lukas', 'philipp', 'daniel') then return; end if;
  select cells into cur from public.bingo_cards where card = p_card for update;
  if cur is null then return; end if;
  cell := cur -> p_idx;
  if p_card = 'shared' then
    if coalesce(cell -> 'by', '[]'::jsonb) @> to_jsonb(p_player) then
      select coalesce(jsonb_agg(v), '[]'::jsonb) into arr from jsonb_array_elements(cell -> 'by') v where v <> to_jsonb(p_player);
    else
      select coalesce(jsonb_agg(x.v order by x.o), '[]'::jsonb) into arr
      from (select v, case v #>> '{}' when 'lukas' then 1 when 'philipp' then 2 else 3 end as o
            from jsonb_array_elements(coalesce(cell -> 'by', '[]'::jsonb) || to_jsonb(p_player)) v) x;
    end if;
    cell := jsonb_set(cell, '{by}', arr);
  else
    cell := jsonb_set(cell, '{d}', to_jsonb(not coalesce((cell ->> 'd')::boolean, false)));
  end if;
  update public.bingo_cards set cells = jsonb_set(cells, array[p_idx::text], cell) where card = p_card;
end;
$function$;

-- Mystery Wheel: set one key in wheel_state.sel / wheel_state.opts without overwriting the others.
create or replace function public.wheel_set_sel(p_player text, p_value boolean)
returns void
language sql
set search_path to 'public'
as $function$
  update public.wheel_state set sel = jsonb_set(sel, array[p_player], to_jsonb(p_value)) where id = 1 and p_player in ('lukas', 'philipp', 'daniel');
$function$;

create or replace function public.wheel_set_opt(p_key text, p_value boolean)
returns void
language sql
set search_path to 'public'
as $function$
  update public.wheel_state set opts = jsonb_set(opts, array[p_key], to_jsonb(p_value)) where id = 1 and p_key in ('limits', 'balance');
$function$;

------------------------------------------------------------------------------
-- Legacy RPCs (work on hunt_state/bingo_state/stat_events, not called by the site)
------------------------------------------------------------------------------

create or replace function public.hunt_results()
returns jsonb
language sql
set search_path to 'public'
as $function$
  select jsonb_object_agg(p.pl, jsonb_build_object('heroes', coalesce(u.h, 0), 'total', coalesce(u.t, 0)))
  from (select unnest(array['lukas', 'philipp', 'daniel']) as pl) p
  left join (select player, count(*) filter (where count > 0) as h, sum(count) as t from public.ultimates group by player) u on u.player = p.pl;
$function$;

create or replace function public.hunt_declare(p_player text)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare
  rn integer;
  heroes integer;
begin
  select count(*) into heroes from public.ultimates where player = p_player and count > 0;
  if heroes < 54 or p_player not in ('lukas', 'philipp', 'daniel') then return false; end if;
  update public.hunt_state set winner = p_player, won_at = now() where id = 1 and winner is null returning run_no into rn;
  if not found then return false; end if;
  insert into public.stat_events (mode, kind, player, data)
  values ('hunt', 'run_end', p_player, jsonb_build_object('run', rn, 'winner', p_player, 'results', public.hunt_results()));
  return true;
end;
$function$;

create or replace function public.hunt_new_run()
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  s record;
begin
  select * into s from public.hunt_state where id = 1 for update;
  if s.winner is null and exists (select 1 from public.ultimates where count > 0) then
    insert into public.stat_events (mode, kind, data)
    values ('hunt', 'run_abandoned', jsonb_build_object('run', s.run_no, 'winner', null, 'results', public.hunt_results()));
  end if;
  update public.hunt_state set run_no = run_no + 1, winner = null, won_at = null where id = 1;
end;
$function$;

create or replace function public.bingo_declare(p_player text, p_data jsonb)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare
  rn integer;
begin
  if p_player not in ('lukas', 'philipp', 'daniel') then return false; end if;
  update public.bingo_state set winner = p_player, won_at = now() where id = 1 and winner is null returning round_no into rn;
  if not found then return false; end if;
  insert into public.stat_events (mode, kind, player, data)
  values ('bingo', 'round_end', p_player, coalesce(p_data, '{}'::jsonb) || jsonb_build_object('round', rn, 'winner', p_player));
  return true;
end;
$function$;

create or replace function public.bingo_new_round()
returns void
language sql
set search_path to 'public'
as $function$
  update public.bingo_state set round_no = round_no + 1, winner = null, won_at = null where id = 1;
$function$;

------------------------------------------------------------------------------
-- Row Level Security (as live: the site has no login, everything runs as anon)
------------------------------------------------------------------------------

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['rounds', 'game_results', 'ultimates', 'wheel_removed', 'wheel_order', 'wheel_state',
                           'ladder_settings', 'ladder_players', 'bingo_pool', 'bingo_cards',
                           'hunt_state', 'bingo_state', 'stat_events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- table, policy name, command
  for p in select * from (values
    ('rounds',          'anyone can read',   'select'),
    ('rounds',          'anyone can add',    'insert'),
    ('rounds',          'anyone can change', 'update'),
    ('game_results',    'anyone can read',   'select'),
    ('game_results',    'anyone can add',    'insert'),
    ('game_results',    'anyone can delete', 'delete'),
    ('ultimates',       'anyone can read',   'select'),
    ('ultimates',       'anyone can add',    'insert'),
    ('ultimates',       'anyone can change', 'update'),
    ('ultimates',       'anyone can delete', 'delete'),
    ('wheel_removed',   'anyone can read',   'select'),
    ('wheel_removed',   'anyone can add',    'insert'),
    ('wheel_removed',   'anyone can delete', 'delete'),
    ('wheel_order',     'anyone can read',   'select'),
    ('wheel_order',     'anyone can add',    'insert'),
    ('wheel_order',     'anyone can change', 'update'),
    ('wheel_state',     'anyone can read',   'select'),
    ('wheel_state',     'anyone can change', 'update'),
    ('ladder_settings', 'anyone can read',   'select'),
    ('ladder_settings', 'anyone can change', 'update'),
    ('ladder_players',  'anyone can read',   'select'),
    ('ladder_players',  'anyone can add',    'insert'),
    ('ladder_players',  'anyone can change', 'update'),
    ('bingo_pool',      'anyone can read',   'select'),
    ('bingo_pool',      'anyone can add',    'insert'),
    ('bingo_pool',      'anyone can change', 'update'),
    ('bingo_pool',      'anyone can delete', 'delete'),
    ('bingo_cards',     'anyone can read',   'select'),
    ('bingo_cards',     'anyone can add',    'insert'),
    ('bingo_cards',     'anyone can change', 'update'),
    ('hunt_state',      'anyone can read',   'select'),
    ('hunt_state',      'anyone can change', 'update'),
    ('bingo_state',     'anyone can read',   'select'),
    ('bingo_state',     'anyone can change', 'update'),
    ('stat_events',     'anyone can read',   'select'),
    ('stat_events',     'anyone can add',    'insert')
  ) as v(tbl, name, cmd) loop
    execute format('drop policy if exists %I on public.%I', p.name, p.tbl);
    execute format('create policy %I on public.%I for %s to anon %s', p.name, p.tbl, p.cmd,
      case p.cmd
        when 'select' then 'using (true)'
        when 'insert' then 'with check (true)'
        when 'update' then 'using (true) with check (true)'
        when 'delete' then 'using (true)'
      end);
  end loop;
end $$;

------------------------------------------------------------------------------
-- Realtime: every page subscribes to postgres_changes on its tables
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['rounds', 'game_results', 'ultimates', 'wheel_removed', 'wheel_order', 'wheel_state',
                           'ladder_settings', 'ladder_players', 'bingo_pool', 'bingo_cards',
                           'hunt_state', 'bingo_state'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
