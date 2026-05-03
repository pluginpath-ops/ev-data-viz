-- Add a user-facing display name to EPA test groups.
--
-- EPA carline names (epa_carline_name) are verbatim from the test sheet and
-- are intentionally preserved unchanged for traceability. display_name is an
-- optional override used in chart legends and UI wherever the raw EPA name
-- would be clunky or duplicative (e.g. "20-inch wheels" vs
-- "RIVIAN R1S PERFORMANCE DUAL-MOTOR MAX PACK R1S247XR20").
--
-- NULL means "use epa_carline_name as-is".
ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS display_name text;
