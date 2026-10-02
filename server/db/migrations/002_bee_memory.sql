-- Engine v2: turns scale with the garden, and bees keep read-only memories of earlier rounds.

-- Turns each bee had in this round (turnsPerFlower × flowers, or a fixed override).
ALTER TABLE rounds ADD COLUMN turns int;

-- What each bee kept at the end of a round: its top-level plain-data variables, serialised for its
-- language (a Python literal or tagged JSON). Later rounds receive these, read-only, as MEMORY.
-- Private to the team, like its code, until a finished game is revealed.
CREATE TABLE bee_memories (
  game_id   uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no  int  NOT NULL,
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  snapshot  text,                 -- null when nothing was kept (too big, or the bee crashed)
  bytes     int  NOT NULL DEFAULT 0,
  note      text,
  PRIMARY KEY (game_id, round_no, team_id)
);
