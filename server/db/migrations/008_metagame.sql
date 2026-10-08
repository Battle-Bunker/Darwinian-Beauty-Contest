-- Prevalence on both sides and the feed price (server/lib/prevalence.js; RULES.md "Prevalence" and "The feed
-- price"). This replaces 007's one-sided form: its samples' p and success are the flowers' (pF, F); the bees'
-- (pB, B), each team's fitness so far and the round's slots are added. A game from before has neither.
ALTER TABLE actions ADD COLUMN price double precision;    -- on a feed: the feed price the bee paid (net = nectar - price)
ALTER TABLE games ADD COLUMN fitness jsonb;               -- {"sum": [Σ over rounds of F × B, per team], "rounds"}
ALTER TABLE prevalence RENAME COLUMN p TO flower_p;       -- [p^F_s]: the chance a visit is to species s
ALTER TABLE prevalence RENAME COLUMN success TO flower_success; -- [F_s]
ALTER TABLE prevalence ADD COLUMN bee_p jsonb;            -- [p^B_b]: bee b's share of the bee weights
ALTER TABLE prevalence ADD COLUMN bee_success jsonb;      -- [B_b]
ALTER TABLE prevalence ADD COLUMN fitness jsonb;          -- [fitness so far]: the time-average of F × B
ALTER TABLE prevalence ADD COLUMN slots int;              -- bees visiting each round: ceil(slots × N)
