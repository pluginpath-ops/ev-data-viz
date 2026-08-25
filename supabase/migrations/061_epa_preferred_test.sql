-- Migration 061: record WHICH test a group's figures come from
--
-- Background:
--   A group can hold more than one multi-cycle test, and every derived figure
--   depends on which one is used. `preferredMctTest` defaults to the most
--   recent and says so in its own comment: "a defensible default and NOT a
--   resolution".
--
--   A linked Fuel Economy Guide row resolves it. EPA published one pair of
--   unadjusted figures, those came from a test, and we hold the tests — so the
--   published highway figure identifies the run. On Mercedes' MY2027 CLA 350
--   the default picks the wrong one:
--
--       TMBX10091675 (2025-07-22)   highway 168.66 MPGe   published 168.7
--       TMBX10092210 (2025-08-19)   highway 173.18 MPGe    (+2.66%)
--
--   The newer test is the one we were deriving from.
--
-- TEST NUMBER, not test id. epa_tests rows are clean-replaced on re-import —
-- deleted and re-inserted — so a foreign key to epa_tests.id would be nulled by
-- every re-import of the same PDF. The EPA test number comes from the
-- certificate and is stable across them.
--
-- Nullable, and null is the normal state: it means nothing has selected a test,
-- so the most-recent default applies exactly as before. Set when a guide row is
-- linked and cleared when it is unlinked, because the evidence for the choice
-- goes away with the row it came from.
--
-- A curator may also set it by hand. It is an ordinary group column and the
-- overrides map tags it like any other, so a hand-set value survives a re-link
-- being declined and is visible as curator-sourced rather than derived.

ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS preferred_test_number text;

COMMENT ON COLUMN epa_test_groups.preferred_test_number IS
    'EPA test number of the multi-cycle test every derived figure for this '
    'group should come from. NULL means no selection has been made and the '
    'most-recent default applies. Set from the linked Fuel Economy Guide row — '
    'the published highway figure identifies the run — and cleared on unlink. '
    'A test NUMBER rather than an id because epa_tests rows are clean-replaced '
    'on re-import. See migration 061 and utils/epaTestSelection.js.';
