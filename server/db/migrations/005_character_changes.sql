-- Change budgets now count characters of edit between the minified versions of a program, not
-- syntax-tree edits. Stored budgets are scaled by 7/3 (the median minified characters per syntax-tree
-- node across all programs played before). Stored distances are recomputed by `npm run remeasure`.
UPDATE games
SET config = jsonb_set(config, '{budgets}', (
  SELECT jsonb_object_agg(k, v || jsonb_build_object('changes', round((v->>'changes')::numeric * 7 / 3)::int))
  FROM jsonb_each(config->'budgets') AS e(k, v)))
WHERE jsonb_typeof(config->'budgets') = 'object';
