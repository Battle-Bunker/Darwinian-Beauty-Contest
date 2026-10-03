-- Darwinian Beauty Contest, one flower per team: a continuous garden of turns. Every game and everything
-- it generates lives here, so any page load (live or later) rebuilds the same view for the same viewer.

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
  round         bigint NOT NULL DEFAULT 0, -- rounds played so far
  participants  uuid[],                   -- team ids fixed when the game starts (team index = position)
  feeds         jsonb,                    -- N×N: feeds[bee team][flower team], whole game so far
  nectar        jsonb,                    -- N×N: nectar[bee team][flower team] (node·ms)
  surplus       jsonb,                    -- N×N: surplus[bee team][flower team]: what the flower kept from that bee's feeds
  last_seq      bigint NOT NULL DEFAULT 0, -- the latest action's seq
  version       bigint NOT NULL DEFAULT 0, -- bumped on every public change but actions; clients refetch when it moves
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

-- Every version of every program. The latest version of each (team, kind) is the one playing. All of it
-- is private to its team during play; code stays private after the game unless it is revealed.
CREATE TABLE programs (
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('flower', 'bee')),
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
  kind     text NOT NULL CHECK (kind IN ('flower', 'bee')),
  bank     double precision NOT NULL DEFAULT 0,
  at_ms    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, team_id, kind)
);

-- Everything that happens in the garden. A turn writes two rows: its arrival, and its end ('feed' or
-- 'leave'), which carries the whole turn. Who may see which column during play is decided in
-- games.js (actionView); once the game is over, everyone sees everything (log: if revealed).
CREATE TABLE actions (
  game_id        uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq            bigint NOT NULL,         -- 1, 2, ... per game
  at_ms          bigint NOT NULL,         -- game time
  round          bigint NOT NULL,
  turn           int    NOT NULL,         -- the bee's turn number (1, 2, ...)
  bee_team       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  flower_team    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action         text NOT NULL CHECK (action IN ('arrive', 'feed', 'leave')),
  c              jsonb,                   -- the challenge (public, on the turn's end)
  r              jsonb,                   -- the response (public; null if the flower failed)
  percent        double precision,        -- flower's team: the share of E offered
  energy         double precision,        -- flower's team: E, node·ms
  cpu_ms         double precision,        -- flower's team: the flower's CPU time for the call
  surplus        double precision,        -- flower's team: what the turn added to its surplus
  flower_error   text,                    -- flower's team: why the response is null
  nectar         double precision,        -- bee's and flower's teams: nectar paid (feed only)
  bee_ms         double precision,        -- bee's team: how long the bee took to decide
  bee_error      text,                    -- bee's team: late, crashed, a bad reply or next challenge
  log            text,                    -- bee's team: what the bee printed
  bee_version    int,
  flower_version int,
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX actions_bee ON actions(game_id, bee_team, seq);
CREATE INDEX actions_flower ON actions(game_id, flower_team, seq);
