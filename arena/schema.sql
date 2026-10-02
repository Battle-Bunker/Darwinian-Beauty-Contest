-- Arena: LLM-driven teams playing continuous games of Darwinian Beauty Contest through the HTTP API.
-- Lives in its own schema `arena` in the game's database (dbc_live). Idempotent: applied on every run.
-- Game data itself (rooms, games, programs, actions) stays in the game's own tables; we keep ids/urls.

CREATE SCHEMA IF NOT EXISTS arena;

-- One arena = a room + a sequence of games with a population of personas (evolving unless noEvolution).
CREATE TABLE IF NOT EXISTS arena.arenas (
  id            text PRIMARY KEY,
  preset        text NOT NULL,
  settings      jsonb NOT NULL,                 -- { config, minutesByGame, session, limits, teams, ... }
  owner_name    text NOT NULL,                  -- dev-login name of the room owner
  room_short_id text,
  room_url      text,
  status        text NOT NULL DEFAULT 'running',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Team agents. The persona prompt is wrapped with the standard arena frame (lib/prompts.js).
CREATE TABLE IF NOT EXISTS arena.personas (
  id              text PRIMARY KEY,             -- '<arena>/<slug>'
  arena_id        text NOT NULL REFERENCES arena.arenas(id),
  slug            text NOT NULL,
  name            text NOT NULL,
  team_name       text NOT NULL,
  model           text NOT NULL,                -- opus | sonnet | haiku (never fable)
  archetype       text NOT NULL,
  is_kid          boolean NOT NULL,
  persona_prompt  text NOT NULL,
  breeder_id      text,                         -- null for the hand-written founders
  generation_born int NOT NULL DEFAULT 1,
  replaced        text,                         -- persona id whose slot this one took
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_after   int,
  retire_reason   text,
  notebook        text NOT NULL DEFAULT '',     -- persistent notes, carried across sessions and games
  source          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One game per generation. stage: created -> lobby-done -> playing -> played -> interviewed -> judged -> done
CREATE TABLE IF NOT EXISTS arena.games (
  id            serial PRIMARY KEY,
  arena_id      text NOT NULL REFERENCES arena.arenas(id),
  generation    int NOT NULL,
  game_short_id text,
  game_url      text,
  game_uuid     uuid,
  config        jsonb,
  stage         text NOT NULL DEFAULT 'created',
  paused_by     text,                            -- the runner paused the game (pause file, shutdown); it resumes it
  metrics       jsonb,                           -- lib/metrics.js
  contaminated  text,                            -- quarantined (outage...): excluded from analysis and selection
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  UNIQUE (arena_id, generation)
);

-- A persona's participation in a game.
CREATE TABLE IF NOT EXISTS arena.entries (
  game_id      int NOT NULL REFERENCES arena.games(id),
  persona_id   text NOT NULL REFERENCES arena.personas(id),
  team_id      uuid,
  team_name    text,
  login_name   text,
  sat_out      boolean NOT NULL DEFAULT false,  -- no valid programs when the game started
  fitness      double precision,
  fitness_rank int,
  allure       double precision,
  forage       double precision,
  explanation  text,                            -- the interview ("teach us your code")
  social       double precision,                -- mean judge score, 0..10 (never mixed into fitness)
  social_rank  int,
  social_parts jsonb,
  PRIMARY KEY (game_id, persona_id)
);

-- Every tool-using session: the lobby one(s) and the ones while the game runs.
CREATE TABLE IF NOT EXISTS arena.sessions (
  id            serial PRIMARY KEY,
  arena_id      text NOT NULL,
  game_id       int NOT NULL,
  persona_id    text NOT NULL,
  no            int NOT NULL,                    -- 0 = lobby, 1.. = during the game
  attempt       int NOT NULL DEFAULT 0,          -- lobby fix sessions: 1, 2, ...
  phase         text NOT NULL,                   -- lobby | game
  model         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  clock_start   bigint,                          -- game time (ms) when it started / ended
  clock_end     bigint,
  ended_by      text,                            -- done | killed:<reason> | error
  cost_usd      double precision,
  cost_estimated boolean NOT NULL DEFAULT false, -- killed before the CLI reported its cost: estimated from usage
  turns         int,
  subtype       text,
  reply         text,
  transcript    text,
  prompt_chars  int,
  violation     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_game ON arena.sessions(game_id, persona_id);

-- Every request a session made through its workspace tools (submit, check, try, status).
CREATE TABLE IF NOT EXISTS arena.requests (
  id          serial PRIMARY KEY,
  session_id  int,
  game_id     int NOT NULL,
  persona_id  text NOT NULL,
  op          text NOT NULL,
  kind        text,
  code        text,                              -- submit/check/try: the code sent
  ok          boolean,
  refused     text,                              -- refused by the runner (fair play, game over, ...)
  result      jsonb,                             -- what the tool got back (minus the code)
  version     int,                               -- submit: the version created
  cost        int,                               -- submit: change budget spent
  clock_ms    bigint,                            -- game time of the request
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_game ON arena.requests(game_id, persona_id);

-- Fair-play audit findings.
CREATE TABLE IF NOT EXISTS arena.violations (
  id          serial PRIMARY KEY,
  arena_id    text NOT NULL,
  game_id     int,
  persona_id  text NOT NULL,
  session_id  int,
  severity    text NOT NULL,                     -- violation | warning | false-positive
  tool        text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Teen judges (social evaluation) and their per-team scores.
CREATE TABLE IF NOT EXISTS arena.judges (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  age    int NOT NULL,
  model  text NOT NULL,
  prompt text NOT NULL
);

CREATE TABLE IF NOT EXISTS arena.evaluations (
  game_id       int NOT NULL,
  judge_id      text NOT NULL,
  persona_id    text NOT NULL,
  understanding double precision,
  respect       double precision,
  novelty       double precision,
  team_up       double precision,
  summary       text,
  tags          jsonb,
  comment       text,
  PRIMARY KEY (game_id, judge_id, persona_id)
);

-- Idea ledger across all games and arenas.
CREATE TABLE IF NOT EXISTS arena.ideas (
  id            serial PRIMARY KEY,
  tag           text NOT NULL UNIQUE,
  description   text NOT NULL,
  first_game_id int,
  first_arena   text,
  first_team    text,
  first_persona text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arena.idea_sightings (
  idea_id     int NOT NULL REFERENCES arena.ideas(id),
  game_id     int NOT NULL,
  persona_id  text NOT NULL,
  judge_id    text NOT NULL,
  new_in_game boolean NOT NULL,
  PRIMARY KEY (idea_id, game_id, persona_id, judge_id)
);

CREATE TABLE IF NOT EXISTS arena.breeders (
  id     text PRIMARY KEY,
  name   text NOT NULL,
  model  text NOT NULL,
  prompt text NOT NULL
);

-- born / retired / survived, with reasons and breeder rationale.
CREATE TABLE IF NOT EXISTS arena.population_events (
  id          serial PRIMARY KEY,
  arena_id    text NOT NULL,
  generation  int NOT NULL,
  persona_id  text NOT NULL,
  event       text NOT NULL,
  reason      text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cost ledger: one row per CLI call (including failed attempts and limit-held calls).
CREATE TABLE IF NOT EXISTS arena.llm_calls (
  id            serial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  model         text NOT NULL,
  resolved      text,
  purpose       text NOT NULL,                   -- lobby | session | interview | judge | breeder | other
  arena_id      text,
  game_id       int,
  persona_id    text,
  cost_usd      double precision NOT NULL DEFAULT 0,
  estimated     boolean NOT NULL DEFAULT false,  -- cost estimated from token usage (session killed before it reported)
  input_tokens  int,
  output_tokens int,
  cache_read    int,
  cache_write   int,
  duration_ms   int,
  turns         int,
  ok            boolean NOT NULL,
  error         text
);
CREATE INDEX IF NOT EXISTS llm_calls_arena ON arena.llm_calls(arena_id);

-- Scaffolds: a team's own long-running program outside the engine (lib/scaffold.js), started from its workspace,
-- supervised by the runner until the game ends. One row per start (and per restart after a crash), with the audited source.
CREATE TABLE IF NOT EXISTS arena.scaffolds (
  id          serial PRIMARY KEY,
  arena_id    text NOT NULL,
  game_id     int NOT NULL,
  persona_id  text NOT NULL,
  session_id  int,                               -- the session that asked for it (null: a restart by the runner)
  action      text NOT NULL,                     -- start | restart | crash-restart | resume
  file        text NOT NULL,
  source      text,                              -- the audited code: the entry file and the workspace modules it imports
  audit       jsonb,                             -- findings of the static audit
  status      text NOT NULL,                     -- running | refused | finished | crashed | stopped
  pid         int,
  clock_start bigint,
  clock_end   bigint,
  exit_code   int,
  cpu_seconds double precision,
  throttled_ms bigint,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS scaffolds_game ON arena.scaffolds(game_id, persona_id);
-- Who made a request: a session (an agent's tool call), the team's scaffold, or the runner itself (lobby fallback).
ALTER TABLE arena.requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'session';
ALTER TABLE arena.requests ADD COLUMN IF NOT EXISTS scaffold_id int;
ALTER TABLE arena.violations ADD COLUMN IF NOT EXISTS scaffold_id int;
