-- Program size can be measured two ways (the game's `complexity` setting): "chars", characters of the
-- minified program, or "nodes", weighted syntax-tree nodes. Sizes are stored as `size`, in the game's
-- unit, and budgets as `size` too. Every game so far measured characters.
ALTER TABLE submissions RENAME COLUMN chars TO size;
ALTER TABLE round_programs RENAME COLUMN chars TO size;

UPDATE games
SET config = jsonb_set(config, '{budgets}', (
  SELECT jsonb_object_agg(k, (v - 'chars') || jsonb_build_object('size', v->'chars'))
  FROM jsonb_each(config->'budgets') AS e(k, v))) || jsonb_build_object('complexity', 'chars')
WHERE jsonb_typeof(config->'budgets') = 'object';
