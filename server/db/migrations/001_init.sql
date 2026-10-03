-- Darwinian Beauty Contest: a continuous garden. Every game and everything it generates lives here, so
-- any page load (live or later) rebuilds the same view for the same viewer.

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
  status        text NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'running', 'paused', 'finished')),
  clock_ms      bigint NOT NULL DEFAULT 0, -- game time played so far (it stops while paused)
  participants  uuid[],                   -- team ids fixed when the game starts (row/column order of ledgers)
  feeds         jsonb,                    -- N×N: feeds[bee team][patch team], whole game so far
  nectar        jsonb,                    -- N×N: nectar[bee team][patch team], whole game so far
  last_seq      bigint NOT NULL DEFAULT 0, -- the latest action's seq
  version       bigint NOT NULL DEFAULT 0, -- bumped on every change but actions; clients refetch when it moves
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
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

-- Every version of every program. The latest version of each (team, kind) is the one playing. Code is
-- private to its team until a finished game is revealed; everything else here is public.
CREATE TABLE programs (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('clover', 'orchid', 'bee')),
  version      int  NOT NULL,             -- 1, 2, ... per (team, kind)
  code         text NOT NULL,
  size         int  NOT NULL,             -- weighted nodes of the minified program
  distance     int,                       -- node edits from the previous version (null when written in the lobby)
  cost         int  NOT NULL DEFAULT 0,   -- change budget spent on it (0 in the lobby)
  at_ms        bigint NOT NULL DEFAULT 0, -- game time it went live (0: before the start)
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  problem      text,                      -- first error it hit while playing
  PRIMARY KEY (game_id, team_id, kind, version)
);

-- Change budget per (team, kind): `bank` nodes as of game time `at_ms`; more accrues from then on
-- (config budgets: perMinute, up to cap).
CREATE TABLE banks (
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id  uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind     text NOT NULL,
  bank     double precision NOT NULL DEFAULT 0,
  at_ms    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, team_id, kind)
);

-- Everything that happens in the garden, one row per bee action, public as soon as it happens (only
-- `log`, the bee's print output, stays with its team until a finished game is revealed).
--   ask:   the bee asked challenge c; the flower answered r (null if it failed: see error)
--   feed:  the bee fed; nectar says whether it was a clover
--   leave: the bee moved on
--   error: the bee broke (see error); the visit ends
CREATE TABLE actions (
  game_id        uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq            bigint NOT NULL,         -- 1, 2, ... per game
  at_ms          bigint NOT NULL,         -- game time
  bee_team       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  visit          int  NOT NULL,           -- the bee's visit number (1, 2, ...)
  patch_team     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('clover', 'orchid')),
  action         text NOT NULL CHECK (action IN ('ask', 'feed', 'leave', 'error')),
  c              jsonb,                   -- ask: the challenge
  r              jsonb,                   -- ask: the response
  after          boolean NOT NULL DEFAULT false, -- ask: asked after feeding
  nectar         boolean,                 -- feed: true at a clover
  ms             real,                    -- ask: how long the flower took
  error          text,
  error_by       text CHECK (error_by IN ('bee', 'challenge', 'flower', 'engine')),
  log            text,                    -- what the bee printed (private)
  bee_version    int,
  flower_version int,
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX actions_time ON actions(game_id, at_ms);
