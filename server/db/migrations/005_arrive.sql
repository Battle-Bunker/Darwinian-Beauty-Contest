-- A bee's arrival at a flower is an action of its own: the moment it is assigned its next flower (public,
-- with whose patch and which flower), before it asks anything there.
ALTER TABLE actions DROP CONSTRAINT actions_action_check;
ALTER TABLE actions ADD CONSTRAINT actions_action_check CHECK (action IN ('arrive', 'ask', 'feed', 'leave', 'error'));
