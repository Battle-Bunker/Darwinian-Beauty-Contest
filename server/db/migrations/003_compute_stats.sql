-- How much compute each flower used per round: {calls, meanMs, p90Ms, budgetMs}. Clovers get 3x an
-- orchid's compute so they can prove effort; this shows whether they use it. Private like code.
ALTER TABLE round_programs ADD COLUMN compute jsonb;
