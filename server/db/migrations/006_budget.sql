-- R, each flower call's hidden time budget (ms, uniform in [budgets.flower.minMs, budgets.flower.ms]): the
-- call's hard limit and the ceiling of its energy, E = (cap − size) × max(0, R − CPU ms). The flower's team
-- sees it during play; everyone after the game.
ALTER TABLE actions ADD COLUMN budget_ms double precision;
