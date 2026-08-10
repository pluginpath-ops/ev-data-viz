-- ─────────────────────────────────────────────────────────────────────────────
-- 048: what runs.speed_mph actually MEANS for a given run.
--
-- The column has been doing two different jobs. For most tests it is a
-- setpoint — the car was held at 70 mph. For a loop driven in traffic it is an
-- average over speeds ranging from under 30 to 70.
--
-- Correcting for speed is only valid for the first kind. Aero energy goes as
-- the mean of v², and an average speed supplies the square of the mean; for any
-- varying speed ⟨v²⟩ > ⟨v⟩², so the model reads a mixed-cycle run as a gentle
-- steady cruise and over-penalises it on the way to the reference speed. One
-- real example corrected 277 mi to 191 mi, which is not a plausible figure for
-- that car.
--
-- Altitude and temperature stay valid either way: air density does not care
-- what the speed trace looked like.
--
--   NULL      unknown; treated as steady, which nearly every test is
--   'steady'  held at a setpoint
--   'mixed'   average over a varying-speed cycle — speed correction is skipped
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE runs ADD COLUMN IF NOT EXISTS speed_basis text;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_speed_basis_check;
ALTER TABLE runs ADD CONSTRAINT runs_speed_basis_check
    CHECK (speed_basis IS NULL OR speed_basis IN ('steady', 'mixed'));

COMMENT ON COLUMN runs.speed_basis IS
    'How to read speed_mph: ''steady'' = held setpoint, ''mixed'' = average over a varying-speed cycle (speed correction is skipped), NULL = unknown, treated as steady.';
