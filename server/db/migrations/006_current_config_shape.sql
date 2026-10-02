-- Every stored game config gets the current shape, so the code needs no fallbacks for older games:
--   * rounds played before turns were stored per round get the fixed turn count they actually used
--   * the fixed `turns` override is gone (turns are turnsPerFlower × flowers); older games get the
--     turnsPerFlower that reproduces their turn count as closely as possible
--   * games from before maxNodes and bee MEMORY get the values they effectively played with
UPDATE rounds r SET turns = COALESCE(NULLIF(g.config->>'turns', 'null')::int, 100)
FROM games g WHERE g.id = r.game_id AND r.turns IS NULL;

UPDATE games g SET config = (g.config - 'turns') || jsonb_build_object(
  'turnsPerFlower', COALESCE((g.config->>'turnsPerFlower')::int,
    GREATEST(1, round(COALESCE(NULLIF(g.config->>'turns', 'null')::int, 100)::numeric / (2 * GREATEST(1, (SELECT count(*) FROM teams t WHERE t.game_id = g.id)))))::int),
  'maxNodes', COALESCE((g.config->>'maxNodes')::int, (g.config->>'maxLen')::int),
  'beeMemoryKb', COALESCE((g.config->>'beeMemoryKb')::int, 0));
