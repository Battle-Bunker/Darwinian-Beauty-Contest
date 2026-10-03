-- How long the bee took to decide each action (its forage call, plus tasted after a feed), like `ms`
-- for a flower's answer.
ALTER TABLE actions ADD COLUMN bee_ms real;
