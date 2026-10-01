-- Arena: LLM-driven populations playing Darwinian Beauty Contest through the HTTP API.
-- Lives in its own schema `arena` in the same database as the game. Idempotent: applied on every run.
-- Game data itself (rooms, games, rounds, visits) stays in the game's own tables; we keep ids/urls.

CREATE SCHEMA IF NOT EXISTS arena;

-- One arena = a room + a sequence of games (generations) with an evolving population.
CREATE TABLE IF NOT EXISTS arena.arenas (
  id            text PRIMARY KEY,               -- e.g. 'baseline'
  preset        text NOT NULL,
  settings      jsonb NOT NULL,                 -- { config: game config, teams, generations, ... }
  owner_name    text NOT NULL,                  -- dev-login name of the room owner
  room_short_id text,
  room_url      text,
  status        text NOT NULL DEFAULT 'running',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Team agents (centaur stand-ins). The persona prompt is wrapped with the standard arena frame.
CREATE TABLE IF NOT EXISTS arena.personas (
  id              text PRIMARY KEY,             -- '<arena>/<slug>'
  arena_id        text NOT NULL REFERENCES arena.arenas(id),
  slug            text NOT NULL,
  name            text NOT NULL,
  team_name       text NOT NULL,
  model           text NOT NULL,                -- fable | opus | sonnet | haiku
  archetype       text NOT NULL,
  is_kid          boolean NOT NULL,
  persona_prompt  text NOT NULL,
  breeder_id      text,                         -- null for the hand-written founders
  generation_born int NOT NULL DEFAULT 1,
  replaced        text,                         -- persona id whose slot this one took
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  retired_after   int,                          -- generation after which it was retired
  retire_reason   text,
  notebook        text NOT NULL DEFAULT '',     -- persistent notes, carried across rounds and games
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One game per generation.
CREATE TABLE IF NOT EXISTS arena.games (
  id            serial PRIMARY KEY,
  arena_id      text NOT NULL REFERENCES arena.arenas(id),
  generation    int NOT NULL,
  game_short_id text,
  game_url      text,
  config        jsonb,
  stage         text NOT NULL DEFAULT 'created', -- created|playing|played|interviewed|judged|done
  metrics       jsonb,                           -- game-level metrics (incl. collapse flags)
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
  fitness      double precision,
  fitness_rank int,
  allure       double precision,
  forage       double precision,
  explanation  text,                            -- the interview ("teach us your code")
  social       double precision,                -- mean judge score, 0..10 (never mixed into fitness)
  social_rank  int,
  social_parts jsonb,                           -- {understanding, respect, novelty, team_up, newIdeas}
  agent_errors int NOT NULL DEFAULT 0,          -- programs that never passed validation
  PRIMARY KEY (game_id, persona_id)
);

-- Every team-agent call: prompt size, reply, what was checked/submitted.
CREATE TABLE IF NOT EXISTS arena.agent_turns (
  id          serial PRIMARY KEY,
  game_id     int NOT NULL,
  persona_id  text NOT NULL,
  round_no    int NOT NULL,
  attempt     int NOT NULL,
  prompt_chars int,
  reply       text,
  parsed      jsonb,
  checks      jsonb,
  submitted   jsonb,
  notes       text,
  error       text,
  cost_usd    double precision,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_turns_game ON arena.agent_turns(game_id, persona_id, round_no);

CREATE TABLE IF NOT EXISTS arena.round_metrics (
  game_id   int NOT NULL,
  round_no  int NOT NULL,
  metrics   jsonb NOT NULL,
  PRIMARY KEY (game_id, round_no)
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
  summary       text,                            -- the judge's own-words summary of the code
  tags          jsonb,                           -- [{tag, known, desc}]
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
  new_in_game boolean NOT NULL,                  -- idea was not in the ledger before this game
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

CREATE TABLE IF NOT EXISTS arena.collapse_events (
  id          serial PRIMARY KEY,
  arena_id    text NOT NULL,
  game_id     int,
  generation  int,
  round_no    int,
  mode        text NOT NULL,
  severity    double precision NOT NULL,         -- 0..1
  evidence    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cost ledger: one row per CLI call (including failed attempts).
CREATE TABLE IF NOT EXISTS arena.llm_calls (
  id            serial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  model         text NOT NULL,
  resolved      text,                            -- actual model id reported by the CLI
  purpose       text NOT NULL,                   -- team | team-retry | interview | judge | breeder | other
  arena_id      text,
  game_id       int,
  persona_id    text,
  cost_usd      double precision NOT NULL DEFAULT 0,
  input_tokens  int,
  output_tokens int,
  cache_read    int,
  cache_write   int,
  duration_ms   int,
  ok            boolean NOT NULL,
  error         text
);
CREATE INDEX IF NOT EXISTS llm_calls_arena ON arena.llm_calls(arena_id);

-- Added after the no-starter-code change (idempotent).
ALTER TABLE arena.entries ADD COLUMN IF NOT EXISTS sat_out boolean NOT NULL DEFAULT false;  -- no valid programs for round 1
-- primed: round-1 prompts showed the old shared starter code; post-primed: no starters, but the arena's
-- history (recaps, notebooks) began primed; unprimed: arena never saw starter code.
ALTER TABLE arena.games ADD COLUMN IF NOT EXISTS condition text;
-- Games hit by an outage (e.g. the account session limit): excluded from metrics, leaderboards and selection.
ALTER TABLE arena.games ADD COLUMN IF NOT EXISTS contaminated text;
