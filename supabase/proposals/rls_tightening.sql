-- PROPOSAL, not applied anywhere. Review before running it in the SQL editor
-- (or move it into supabase/migrations/ once agreed).
--
-- Limit of any RLS here: the site has no login and the publishable key is in the page
-- source, so whoever opens the site can still do everything the site can do. This only
-- removes what the site never needs, so a stray or scripted request cannot do more.
-- Real protection would need Supabase Auth (e.g. anonymous sign-in plus a shared code).
--
-- Every change below was checked against the current front-end code (2026-10-16);
-- none of them needs a code change.

begin;

-- 1. rounds is only written through the RPCs. Run them as owner and drop direct writes,
--    so nobody can set a winner without going through round_claim.
alter function public.round_claim(text, text, text) security definer;
alter function public.round_release(text, text)     security definer;
alter function public.round_finish(text, jsonb)     security definer;
alter function public.round_new(text)               security definer;
drop policy if exists "anyone can add"    on public.rounds;
drop policy if exists "anyone can change" on public.rounds;

-- 2. game_results: the only delete is the Ladder undo of its own last entry.
drop policy if exists "anyone can delete" on public.game_results;
create policy "ladder undo can delete" on public.game_results
  for delete to anon using (mode = 'ladder');

-- 3. bump() is the only function without a fixed search_path (Supabase advisor warning).
alter function public.bump(text, text, integer) set search_path to 'public';

-- 4. Legacy tables and RPCs are unused: keep the data, but make them read-only.
drop policy if exists "anyone can change" on public.hunt_state;
drop policy if exists "anyone can change" on public.bingo_state;
drop policy if exists "anyone can add"    on public.stat_events;
revoke execute on function public.hunt_declare(text), public.hunt_new_run(), public.hunt_results(),
                           public.bingo_declare(text, jsonb), public.bingo_new_round()
  from public, anon, authenticated;

-- 5. RPCs are executable by PUBLIC by default; grant only what the site calls.
revoke execute on function public.bump(text, text, integer), public.round_claim(text, text, text),
                           public.round_release(text, text), public.round_finish(text, jsonb),
                           public.round_new(text), public.bingo_toggle(text, integer, text),
                           public.wheel_set_sel(text, boolean), public.wheel_set_opt(text, boolean)
  from public;
grant execute on function public.bump(text, text, integer), public.round_claim(text, text, text),
                          public.round_release(text, text), public.round_finish(text, jsonb),
                          public.bingo_toggle(text, integer, text),
                          public.wheel_set_sel(text, boolean), public.wheel_set_opt(text, boolean)
  to anon, authenticated;

-- 6. Table privileges the API never uses.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

commit;
