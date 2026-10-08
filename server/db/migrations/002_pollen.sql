-- "surplus" is renamed "pollen": what a flower keeps of a turn's energy when the bee feeds (a flower
-- allocates its energy between compute, nectar and pollen). Databases created with the old name are
-- renamed in place; new ones already have it (001_init.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'games' AND column_name = 'surplus') THEN
    ALTER TABLE games RENAME COLUMN surplus TO pollen;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'actions' AND column_name = 'surplus') THEN
    ALTER TABLE actions RENAME COLUMN surplus TO pollen;
  END IF;
END $$;
