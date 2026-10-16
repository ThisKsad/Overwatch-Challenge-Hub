# Supabase

The site talks to the Supabase project **Ultimate Hunt** (`dwsieddjvldzurosjdpp`) with the publishable key, as the `anon` role. There is no login.

| File | What it is |
| --- | --- |
| `migrations/20261009000000_baseline.sql` | Tables, RPCs, RLS policies and Realtime publication exactly as they are live (read on 2026-10-16). Idempotent: safe to run against the live project, rebuilds a new one from scratch. |
| `seed.sql` | The 25 default Hero Bingo challenges. |
| `proposals/rls_tightening.sql` | Proposal to remove write access the site never uses. **Not applied.** |

## Which page uses what

| Page | Tables (direct) | RPCs |
| --- | --- | --- |
| Ultimate Hunt | `ultimates` (read, delete on reset), `rounds` (read) | `bump`, `round_claim`, `round_finish` |
| Hero Bingo | `bingo_pool` (read/write), `bingo_cards` (read/upsert), `rounds` (read) | `bingo_toggle`, `round_claim`, `round_release`, `round_finish` |
| Mystery Wheel | `wheel_removed`, `wheel_order`, `wheel_state` (read/write), `game_results` (insert) | `wheel_set_sel`, `wheel_set_opt` |
| Hero Ladder | `ladder_players`, `ladder_settings` (read/write), `game_results` (insert, delete on undo) | none |
| Stats | `game_results`, `ultimates`, `ladder_players`, `wheel_removed` (read) | none |

`hunt_state`, `bingo_state`, `stat_events` and the RPCs `hunt_declare`, `hunt_new_run`, `hunt_results`, `bingo_declare`, `bingo_new_round` are from an earlier version and no longer used by the site. They are in the baseline because they still exist live.

## New project from scratch

Run `migrations/20261009000000_baseline.sql`, then `seed.sql`, in the SQL editor (or `supabase db reset` with the CLI), and put the new URL and publishable key into the pages.

## Using the CLI against the live project

The live project has no migration history, so mark the baseline as applied before the first `supabase db push`:

```sh
supabase link --project-ref dwsieddjvldzurosjdpp
supabase migration repair --status applied 20261009000000
```
