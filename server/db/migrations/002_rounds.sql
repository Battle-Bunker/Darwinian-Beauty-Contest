-- A round is one turn for every bee that isn't feeding. Each action records the round it happened in,
-- and the game how many rounds it has played.
ALTER TABLE actions ADD COLUMN round bigint;
ALTER TABLE games ADD COLUMN round bigint NOT NULL DEFAULT 0;
