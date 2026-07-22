-- Let admins/contributors hide a run's test data from regular viewers without
-- deleting it (e.g. disputed data pending review, incomplete uploads).

ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
