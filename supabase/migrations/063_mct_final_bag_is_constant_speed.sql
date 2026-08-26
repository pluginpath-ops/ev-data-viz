-- 063: retype the final bag of a multi-cycle test that was imported as HWFET
--
-- J1634's multi-cycle test drives its constant-speed section in TWO blocks with
-- the dynamic cycles between them, and the second block runs to depletion:
--
--     UDDS  HWY  UDDS  SS  UDDS  HWY  UDDS  [the rest of the SS run]
--
-- The importer typed bags by distance alone, which reads the fourth and misses
-- the eighth — the eighth is however far the car got before the pack ran out,
-- anywhere from 2.3 to 66 miles across the corpus. Usually that left it
-- untyped, which #264 fixes at read time: the rule is now positional and lives
-- in src/utils/phaseTypes.js, so no data change is needed for those.
--
-- Six records are not that case. Their last bag happened to stop between 9.6
-- and 10.9 miles — HWFET's length — and the distance rule filed it as HWY. A
-- stored type outranks any inference, correctly, so read-time cannot undo it;
-- only a write can.
--
-- These are wrong on the evidence, not on the theory. The bags consume 27% to
-- 43% more than the SAME TEST's real HWFET bags and sit within 1% to 10% of its
-- constant-speed bag. As HWY they are pulling constant-speed energy into
-- highway consumption and into the HWFET back-solve for eta; as SS they join
-- the run they are part of.
--
-- It is not a rounding-sized correction. Averaging that bag into the highway
-- phases costs these six vehicles 9% to 15% of their HWFET eta:
--
--   Tesla Model Y Performance      0.768 -> 0.839
--   Lucid Gravity Touring          0.760 -> 0.864
--   RAM ProMaster EV               0.756 -> 0.844
--   Nissan LEAF 75kWh (19in)       0.798 -> 0.898
--   Rivian EDV 700                 0.733 -> 0.841
--   Kia EV9 Standard Range RWD     0.735 -> 0.815
--
-- The last two sat BELOW ETA_BAND's 0.75 floor and have been carrying
-- 'eta-out-of-band' — the band was right, and this is what it was pointing at.
--
-- Scoped so it can only touch that shape: the LAST bag of a test that already
-- drove a constant-speed section earlier. Six rows on the corpus as of
-- 2026-08-26. It is idempotent — a second run matches nothing.

UPDATE epa_test_phases p
SET phase_type = 'SS'
WHERE p.phase_type = 'HWY'
  AND p.phase_index = (
      SELECT MAX(q.phase_index) FROM epa_test_phases q WHERE q.test_id = p.test_id
  )
  AND EXISTS (
      SELECT 1 FROM epa_test_phases q
      WHERE q.test_id = p.test_id
        AND q.phase_type = 'SS'
        AND q.phase_index < p.phase_index
  );
