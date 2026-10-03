-- The rewarding flower is renamed: its program kind 'clover' becomes 'cosmos' (the garden cosmos, an honest,
-- many-coloured nectar flower). Renames the kind in every stored program, change budget and action, the CHECK
-- constraints that list the kinds (named by Postgres in 001_init.sql), and every game's config, whose per-kind
-- budgets move from budgets.clover to budgets.cosmos.
ALTER TABLE programs DROP CONSTRAINT programs_kind_check;
ALTER TABLE actions DROP CONSTRAINT actions_kind_check;

UPDATE programs SET kind = 'cosmos' WHERE kind = 'clover';
UPDATE banks SET kind = 'cosmos' WHERE kind = 'clover';
UPDATE actions SET kind = 'cosmos' WHERE kind = 'clover';

ALTER TABLE programs ADD CONSTRAINT programs_kind_check CHECK (kind IN ('cosmos', 'orchid', 'bee'));
ALTER TABLE actions ADD CONSTRAINT actions_kind_check CHECK (kind IN ('cosmos', 'orchid'));

UPDATE games
   SET config = jsonb_set(config #- '{budgets,clover}', '{budgets,cosmos}', config -> 'budgets' -> 'clover')
 WHERE config -> 'budgets' ? 'clover';
