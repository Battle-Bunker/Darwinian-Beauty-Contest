-- Responses up to maxResponseBytes (1 MB by default) of JSON. A response's size goes with its action; one
-- over 4 KB (INLINE_BYTES in server/engine.js) is kept out of the actions rows that pages, live feeds and
-- queries read: the action has r = null, its size, its SHA-256 and the first 4 KB of its JSON text, and the
-- whole text lives in `responses` (compressed by Postgres), served by GET .../responses/:seq.
-- (bee_memories.bytes is now a MEMORY's key-value size: Σ key bytes + value JSON bytes.)
ALTER TABLE actions ADD COLUMN r_bytes int;      -- UTF-8 bytes of the response's JSON text (null: no response)
ALTER TABLE actions ADD COLUMN r_hash text;      -- over 4 KB: SHA-256 (hex) of that text
ALTER TABLE actions ADD COLUMN r_preview text;   -- over 4 KB: its first 4 KB, cut at a whole character

CREATE TABLE responses (
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq      bigint NOT NULL,   -- the turn's feed/leave action
  bytes    int NOT NULL,
  sha256   text NOT NULL,
  body     text NOT NULL,     -- the response's JSON text
  PRIMARY KEY (game_id, seq)
);
-- lz4 where the server has it (faster than the default pglz, and compresses as well on JSON).
DO $$ BEGIN
  ALTER TABLE responses ALTER COLUMN body SET COMPRESSION lz4;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
