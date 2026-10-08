-- Metagame v3 (prevalence.pools): the bee's nectar is a single linear balance, and a feed carries the balance
-- after it (server/lib/prevalence.js, RULES.md "Prevalence"). The flower side is unchanged. A game stored
-- without prevalence.pools keeps the v2 per-cell bee formula, so these are null there.
ALTER TABLE actions ADD COLUMN balance double precision;    -- on a feed (pools): the bee's nectar balance after it
ALTER TABLE prevalence ADD COLUMN bee_balance jsonb;        -- [balance_b]: each bee's nectar balance at the sample (pools)
