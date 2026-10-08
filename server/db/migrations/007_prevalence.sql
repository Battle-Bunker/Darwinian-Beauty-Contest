-- Species prevalence (config.prevalence; server/lib/prevalence.js, RULES.md "Species prevalence"): each turn's
-- flower species is drawn with probability p_s = w_s / Σ w, w_s = c(t) + P_s. The garden samples every
-- species' p_s and P_s about once a second of game time, as a round begins: the latest on the game, every
-- sample in `prevalence`. Public. Games without prevalence have neither.
ALTER TABLE games ADD COLUMN prevalence jsonb;  -- the latest sample: {"round", "atMs", "c", "p": [...], "P": [...]}
CREATE TABLE prevalence (
  game_id  uuid    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round    bigint  NOT NULL,            -- the round whose draws it gave
  at_ms    bigint  NOT NULL,            -- game time that round began: (round - 1) × round_ms
  c        double precision NOT NULL,   -- c(t), the weight every species has whatever its success
  p        jsonb   NOT NULL,            -- [p_s], participants order: the chance a turn's flower is of species s
  success  jsonb   NOT NULL,            -- [P_s], participants order: its recent success, par 1 (capped)
  PRIMARY KEY (game_id, round)
);
