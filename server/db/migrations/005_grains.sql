-- Pollen grains: on a feed, ⌊scale × pollen^exponent⌋ characters of the minified code of the flower version
-- that answered, from a random start, wrapping (server/engine.js grainOf). The feeding bee's team sees it
-- during play (everyone, if the game's `grains` is "public"); everyone after the game.
ALTER TABLE actions ADD COLUMN grain text;
ALTER TABLE actions ADD COLUMN grain_version int;
ALTER TABLE actions ADD COLUMN grain_code_length int;   -- the code's length in characters (code points)
