-- Querying history (server/query/sql.js), and the bees' MEMORY.

-- Each team's bee's MEMORY as last saved (canonical JSON), and the bee version it belongs to. Written by the
-- garden with the rest of the live state, so a restarted server picks it up; nothing else writes it.
CREATE TABLE bee_memories (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  bee_version  int,
  memory       text NOT NULL,             -- canonical JSON: sorted keys, no spaces
  bytes        int  NOT NULL,             -- its size in bytes (UTF-8)
  error        text,                      -- the last write that was refused (over the cap, not JSON)
  at_round     bigint NOT NULL DEFAULT 0, -- the round it was saved in
  PRIMARY KEY (game_id, team_id)
);

-- Turns (a turn's end: feed or leave) by round, and by bee and flower within a round.
CREATE INDEX actions_turns_round ON actions(game_id, round) WHERE action <> 'arrive';
CREATE INDEX actions_turns_pair ON actions(game_id, bee_team, flower_team, round) WHERE action <> 'arrive';
-- A room's finished games, for queries across them.
CREATE INDEX games_room_status ON games(room_id, status);
