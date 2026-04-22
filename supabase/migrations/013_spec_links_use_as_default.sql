-- Migration 013: Add use_as_default to spec_links
--
-- Allows a spec link (inherited charging curve or range test) to be designated
-- as the vehicle's default run for ChargeCompare and auto-selection in ChargingView.
-- When true, the inherited run is treated identically to a real run with is_default=true.

ALTER TABLE spec_links ADD COLUMN use_as_default boolean NOT NULL DEFAULT false;
