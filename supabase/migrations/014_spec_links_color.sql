-- Migration 014: Per-link plot color for inherited runs
--
-- Inherited runs don't have their own runs row, so color overrides
-- are stored on the spec_link and applied in buildInheritedRuns.
-- NULL means fall back to the source run's color (or the default gray).

ALTER TABLE spec_links ADD COLUMN color text;
