-- A game ends at a hidden time (RULES.md "The game"): at its start the server draws its end uniformly from
-- [minutes, endFactor × minutes] of game time (rounded up to a whole round) and keeps it here. Nothing a team
-- can read shows it until the game is over. Null for games from before it: they end at minutes.
ALTER TABLE games ADD COLUMN end_ms bigint;
