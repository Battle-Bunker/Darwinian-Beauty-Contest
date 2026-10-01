-- Complexity is now the length of the automatically minified program (vendor/complexity.js), not a
-- syntax-tree node count, and flowers are always stateless but not pure.
--   * program sizes are stored as `chars`; run `npm run remeasure` to recompute them under the
--     current rule (this migration only renames the columns)
--   * budgets in game configs move from `nodes` to `chars`, scaled by 7/3 (the median minified
--     characters per syntax-tree node across all programs played so far), so each game keeps its
--     relative tightness
--   * the old `pureFlowers` setting is dropped
ALTER TABLE submissions RENAME COLUMN nodes TO chars;
ALTER TABLE round_programs RENAME COLUMN nodes TO chars;

UPDATE games
SET config = (config - 'pureFlowers') || jsonb_build_object('budgets', (
  SELECT jsonb_object_agg(k, CASE WHEN v ? 'nodes'
    THEN (v - 'nodes') || jsonb_build_object('chars', round((v->>'nodes')::numeric * 7 / 3)::int)
    ELSE v END)
  FROM jsonb_each(config->'budgets') AS e(k, v)))
WHERE jsonb_typeof(config->'budgets') = 'object';

UPDATE games SET config = config - 'pureFlowers' WHERE config ? 'pureFlowers';
