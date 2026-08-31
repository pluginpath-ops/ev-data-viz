-- 064: null the placeholder figures two manufacturers filed as measurements
--
-- Zoox's TZOX1 reports 999.0 for integrated DC energy, distance driven AND
-- recharge energy. Karsan's NLNC2EML6L1008051 reports 1.0 for all three. One
-- sentinel repeated across every numeric field on a test is not a measurement;
-- it is "not reported" wearing a number's clothes, and it read straight through
-- into the certification statistics as a 999 kWh battery pack -- the largest in
-- the corpus, setting the axis for every other row.
--
-- Nulled, not deleted, and the GROUP is not touched at all. Both records are
-- real certifications and both carry sound road-load coefficients -- Zoox
-- A=261.08 C=0.0700, Karsan A=97.86 C=0.0717 -- which is everything a
-- speed-consumption curve needs. Deleting the group to be rid of a bad energy
-- figure would throw away good data to fix a bad number. The test rows stay too:
-- the test happened, and a test that reports nothing is a fact worth keeping.
--
-- After this the statistics count them under "do not report it", which is what
-- is true of them.
--
-- Scoped by the pattern rather than by id, so it cannot reach a record where the
-- three fields merely happen to be populated: all three equal, on the same test.
-- Two tests per group, four rows, as of the 2026-08-26 corpus. Idempotent --
-- once nulled they no longer match.
--
-- The importer stops creating these (see placeholderTest in parseEpaCsiPdf), and
-- the statistics null anything like it at plot time regardless (see
-- nullImpossible in epaCertStats). This is the curation the other two back up.

-- The bag rows carry it too. A single-cycle test with dummy per-phase data has
-- its one phase SYNTHESISED from the test totals (see parseTests), so the
-- sentinel was copied into the phase as distance and energy alike. Left behind,
-- it would wait for someone to give that phase a type and then reach the eta
-- back-solve as a 1,000 Wh/mi highway cycle.
--
-- Identified in one CTE and applied to both tables, because the test update
-- destroys the pattern the phase update would have matched on. Phases first
-- would work as well; naming the set once says what is happening.
WITH placeholder AS (
    SELECT id FROM epa_tests
    WHERE total_dc_energy_kwh IS NOT NULL
      AND total_dc_energy_kwh = total_distance_mi
      AND total_dc_energy_kwh = ac_recharge_kwh
), nulled_phases AS (
    UPDATE epa_test_phases
    SET distance_mi = NULL, dc_energy_kwh = NULL
    WHERE test_id IN (SELECT id FROM placeholder)
    RETURNING 1
)
UPDATE epa_tests
SET total_dc_energy_kwh = NULL,
    total_distance_mi   = NULL,
    ac_recharge_kwh     = NULL
WHERE id IN (SELECT id FROM placeholder);
