-- Darwinian Beauty Contest: initial schema.
-- Every game and all of its generated data lives here, so any page load (live or later) can rebuild
-- the exact same view for the same viewer.

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  -- Which identity provider vouches for this user: 'dev' (name-only login, local only) or e.g. 'replit'.
  auth_provider text NOT NULL,
  auth_subject  text NOT NULL,
  profile       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,           -- sha256 of the bearer/cookie token
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE rooms (
  id          uuid PRIMARY KEY,
  code        text NOT NULL UNIQUE,       -- Crockford base32 of id (26 chars)
  prefix_len  int  NOT NULL,              -- shortest unique prefix length at creation time
  owner_id    uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_code_prefix ON rooms(code text_pattern_ops);

CREATE TABLE games (
  id            uuid PRIMARY KEY,
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code          text NOT NULL,
  prefix_len    int  NOT NULL,            -- unique within the room
  config        jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'running', 'finished')),
  rounds_played int  NOT NULL DEFAULT 0,
  running_round int,                      -- non-null while a round is being simulated
  participants  uuid[],                   -- team ids fixed when round 1 runs (column order of ledgers)
  version       bigint NOT NULL DEFAULT 0, -- bumped on every change; clients refetch when it moves
  last_error    text,                     -- why the last attempt to run a round failed, if it did
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  UNIQUE (room_id, code)
);
CREATE INDEX games_code_prefix ON games(room_id, code text_pattern_ops);

CREATE TABLE teams (
  id          uuid PRIMARY KEY,
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name        text NOT NULL,
  join_code   text NOT NULL,              -- shown only to members; lets teammates join
  color       text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, name)
);

CREATE TABLE team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (game_id, user_id)               -- one team per user per game
);

-- Pending programs for the next round (latest submission per team and kind wins).
CREATE TABLE submissions (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('clover', 'orchid', 'bee')),
  code         text NOT NULL,
  nodes        int  NOT NULL,
  distance     int,                       -- AST edits from the previous round's program (null before round 1)
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, team_id, kind)
);

CREATE TABLE rounds (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no     int  NOT NULL,
  seed         bigint NOT NULL,
  feeds        jsonb NOT NULL,            -- N×N ledger, participants order
  nectar       jsonb NOT NULL,            -- N×N ledger, participants order
  scores       jsonb NOT NULL,            -- per-team breakdown for this round alone
  totals       jsonb NOT NULL,            -- per-team breakdown for all rounds so far (the game score)
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, round_no)
);

-- The exact programs that played each round.
CREATE TABLE round_programs (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no     int  NOT NULL,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  code         text NOT NULL,
  nodes        int  NOT NULL,
  distance     int,
  carried_over boolean NOT NULL,
  problem      text,                      -- first load/runtime error, shown to the owning team only
  PRIMARY KEY (game_id, round_no, team_id, kind)
);

-- One row per flower visit. Public: who visited whose patch, when, how many asks, feed + nectar.
-- Private: challenge/response values (bee's team, and the patch owner if flowerLogs), flower kind
-- (patch owner only), errors and bee print output (bee's team only).
CREATE TABLE visits (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no     int  NOT NULL,
  bee_team     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  seq          int  NOT NULL,             -- order within this bee's round
  patch_team   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('clover', 'orchid')),
  turn_start   int  NOT NULL,
  turn_end     int  NOT NULL,
  action       text NOT NULL CHECK (action IN ('feed', 'leave', 'error')),
  nectar       boolean,                   -- only when action = 'feed'
  steps        jsonb NOT NULL,            -- [{c, r, challengeError?, flowerError?}]
  bee_error    text,
  bee_log      text,
  note         text,
  PRIMARY KEY (game_id, round_no, bee_team, seq)
);
CREATE INDEX visits_patch ON visits(game_id, round_no, patch_team);
