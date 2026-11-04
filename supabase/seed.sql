-- Default Hero Bingo challenges (the 25 entries in the live bingo_pool on 2026-10-16).
-- Only needed for a fresh project; the site edits the pool itself afterwards.
insert into public.bingo_pool (id, text, enabled, sort) values
  ('d25', 'Win two matches in a row', true, 1),
  ('d24', 'Win after switching heroes mid-game', true, 2),
  ('d23', 'Win a match as your least played role', true, 3),
  ('d22', 'Finish with the most damage on your team', true, 4),
  ('d21', 'Get 20 eliminations in one match', true, 5),
  ('d20', 'Win with a bottom-10 hero by playtime', true, 6),
  ('d19', 'Finish a match with 3 deaths or fewer', true, 7),
  ('d18', 'Win a match in under 10 minutes', true, 8),
  ('d17', 'All three of us use an ultimate in the same fight', true, 9),
  ('d16', 'Win a match on an Escort or Hybrid map', true, 10),
  ('d15', 'Win a match on a Push or Flashpoint map', true, 11),
  ('d14', 'Win a match on a Control map', true, 12),
  ('d13', 'Kill an enemy with the environment', true, 13),
  ('d12', 'Get a melee kill', true, 14),
  ('d11', 'Get the final kill of a match', true, 15),
  ('d10', 'Get a 4-kill streak', true, 16),
  ('d9',  'Get a gold medal in anything', true, 17),
  ('d8',  'Win after losing the first point', true, 18),
  ('d7',  'Win a match without swapping heroes', true, 19),
  ('d6',  'Interrupt an enemy ultimate', true, 20),
  ('d5',  'Kill 3 or more enemies with one ultimate', true, 21),
  ('d4',  'Get Play of the Game', true, 22),
  ('d3',  'Win a match as a Support', true, 23),
  ('d2',  'Win a match as a Damage hero', true, 24),
  ('d1',  'Win a match as a Tank', true, 25)
on conflict (id) do nothing;
