-- ============================================================
-- Migration 053: the EPA Fuel Economy Guide as a staged label source (#206)
--
-- Additive only. Creates one table and adds columns; drops nothing, rewrites
-- nothing. Safe to apply before the code that reads it.
--
-- ── Why a separate table rather than filling epa_test_groups directly ────────
--
-- The guide is the PUBLISHED side of the EPA picture — what reached the window
-- sticker — where a certification record says what a lab measured. Keeping them
-- apart is what keeps `computed >= labeled` a comparison of two independent
-- sources rather than a number against itself.
--
-- It also cannot be a direct fill, because there is no key that joins them:
--
--   • `#1 Smog Rating Test Group` matches 1 of our 87 linked groups. Our CSI
--     importer stores the manufacturer's Vehicle ID (`R2-159XR20AT`), the guide
--     carries the EPA smog test group (`TRIVT00.0232`). Same car, two systems.
--   • The guide's test group is not unique per configuration anyway: both 2027
--     R2 rows share `VRIVT00.0232` while reading 307 and 330 miles.
--
-- So linking is a curator action, and this table holds the candidates. Most of
-- them will never be linked — the MY26 guide has 323 EV configurations against
-- our 87 linked groups — and that is the point: a vehicle added next month
-- finds its label already here instead of needing a re-import.
--
-- Promotion (phase 3) copies the agreed fields onto epa_test_groups, which is
-- what every read path already goes through. Nothing learns a new source.
-- ============================================================

BEGIN;

-- ── 1. The staged rows ───────────────────────────────────────────────────────

CREATE TABLE epa_fe_guide (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Natural key. NOT the test group: see the header.
    --
    -- Includes model_type_index, and must. Carline alone is not unique: Audi
    -- lists "Q6 e-tron quattro" three times in MY27 at 325, 301 and 301 miles —
    -- wheel and tyre variants it does not name, where BMW writes them out as
    -- "iX3 50 xDrive (20'' Summer Tires)". Keying without the index silently
    -- kept the last row of each group, losing 9 configurations across the two
    -- guide years with nothing to show it had happened.
    model_year      integer NOT NULL,
    division        text    NOT NULL,
    carline         text    NOT NULL,
    -- EPA's own index for a model type. Present on every row of both guides
    -- (323/323 and 135/135), which is what makes it safe in the key: a NULL
    -- here would defeat the constraint, since Postgres treats NULLs as distinct.
    model_type_index text   NOT NULL,

    -- Carried for the minority of cases where it does match something, and so
    -- a future join has the raw material. Never treated as unique.
    smog_test_group text,
    -- Label figures — the window sticker
    label_comb_range_mi numeric(8,2),
    label_city_range_mi numeric(8,2),
    label_hwy_range_mi  numeric(8,2),
    label_comb_mpge     numeric(8,2),
    label_city_mpge     numeric(8,2),
    label_hwy_mpge      numeric(8,2),

    -- Unadjusted, as EPA publishes it. This is the quantity our own derivation
    -- computes from a cert record, so the pair is a standing check on the
    -- cold-start weighting and the DC-to-AC conversion: for the R2 20" AT we
    -- compute 154.214 / 126.243 against the guide's 154.200 / 126.200.
    unadj_city_mpge numeric(8,3),
    unadj_hwy_mpge  numeric(8,3),
    unadj_comb_mpge numeric(8,3),

    -- Adjusted and unrounded, which is what the factor is derived FROM.
    adj_city_mpge numeric(8,3),
    adj_hwy_mpge  numeric(8,3),
    adj_comb_mpge numeric(8,3),

    -- The adjustment EPA actually applied to this configuration. Not 0.7 — the
    -- 2027 R2 is 0.7051 at 20" and 0.7294 at 21".
    label_adjustment_factor numeric(6,4),

    -- Declared vs derived, and they disagree. `calc_approach` is EPA's own
    -- statement ("Electric Vehicle 5-cycle label"), but 57% of the rows saying
    -- 5-cycle carry a ratio of exactly 0.700000, which is the fixed factor.
    -- `adjustment_signature` is read from the numbers and is what should be
    -- trusted; the declared value is kept because it is the source's own claim
    -- and the 'per-cycle' group is still unexplained.
    calc_approach        text,
    adjustment_signature text CHECK (adjustment_signature IS NULL
                             OR adjustment_signature IN ('fixed','per-vehicle','per-cycle')),

    -- Battery. voltage x amp-hours is the pack's GROSS capacity, which is then
    -- capped or partly unused to reach the usable figure — a different quantity
    -- that stays with the curator and never lands in useable_kwh.
    total_voltage_v            numeric(8,2),
    batt_capacity_ah           numeric(8,2),
    nominal_pack_kwh           numeric(8,3),
    batt_specific_energy_wh_kg numeric(8,2),

    motor_power_kw    numeric(8,2),   -- summed across motors
    motor_count       integer,
    charge_time_240v_h numeric(6,2),
    drive_desc        text,
    carline_class     text,

    -- The whole source row, so a question we have not thought of yet does not
    -- need a re-import to answer.
    raw jsonb,

    source_file text,
    imported_at timestamptz DEFAULT now(),
    created_at  timestamptz DEFAULT now(),

    UNIQUE (model_year, division, carline, model_type_index)
);

COMMENT ON TABLE epa_fe_guide IS
    'Staged rows from EPA''s annual Fuel Economy Guide — the published label figures. Linked to epa_test_groups by a curator; see #206.';

CREATE INDEX idx_fe_guide_year_division ON epa_fe_guide (model_year, division);
CREATE INDEX idx_fe_guide_smog_group    ON epa_fe_guide (smog_test_group)
    WHERE smog_test_group IS NOT NULL;

ALTER TABLE epa_fe_guide ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read fe guide"
    ON epa_fe_guide FOR SELECT USING (true);

CREATE POLICY "Contributors can insert fe guide"
    ON epa_fe_guide FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update fe guide"
    ON epa_fe_guide FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete fe guide"
    ON epa_fe_guide FOR DELETE
    USING (current_user_role() = 'admin');


-- ── 2. Promotion targets on epa_test_groups ──────────────────────────────────
--
-- label_range_published, label_combined_mpge, label_hwy_mpge, total_voltage and
-- battery_specific_energy already exist and are filled in place. These are the
-- figures with nowhere to go today.

ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS label_city_range_mi     numeric(8,2),
    ADD COLUMN IF NOT EXISTS label_hwy_range_mi      numeric(8,2),
    ADD COLUMN IF NOT EXISTS label_city_mpge         numeric(8,2),
    ADD COLUMN IF NOT EXISTS unadj_city_mpge         numeric(8,3),
    ADD COLUMN IF NOT EXISTS unadj_hwy_mpge          numeric(8,3),
    ADD COLUMN IF NOT EXISTS adj_city_mpge           numeric(8,3),
    ADD COLUMN IF NOT EXISTS adj_hwy_mpge            numeric(8,3),
    ADD COLUMN IF NOT EXISTS label_adjustment_factor numeric(6,4),
    ADD COLUMN IF NOT EXISTS label_calc_approach     text,
    -- GROSS pack energy. Deliberately NOT useable_kwh: that is what the pack
    -- actually delivers after the buffer, a curator judgement. Measured usable
    -- ran 0.939-0.955 of gross on the four packs checked.
    ADD COLUMN IF NOT EXISTS nominal_pack_kwh        numeric(8,3),
    ADD COLUMN IF NOT EXISTS fe_guide_row_id         bigint
        REFERENCES epa_fe_guide(id) ON DELETE SET NULL;

COMMENT ON COLUMN epa_test_groups.nominal_pack_kwh IS
    'Gross pack energy from the FE Guide (voltage x amp-hours). Not usable capacity — see useable_kwh.';
COMMENT ON COLUMN epa_test_groups.fe_guide_row_id IS
    'The staged guide row these label figures were promoted from (#206). Null when the label came from a CSI PDF or by hand.';

CREATE INDEX IF NOT EXISTS idx_epa_groups_fe_guide_row
    ON epa_test_groups (fe_guide_row_id) WHERE fe_guide_row_id IS NOT NULL;

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. The table exists and is empty:
--
--      SELECT count(*) FROM epa_fe_guide;                     -- expect 0
--
-- 2. Every new column landed — expect 12:
--
--      SELECT count(*) FROM information_schema.columns
--      WHERE table_name = 'epa_test_groups'
--        AND column_name IN ('label_city_range_mi','label_hwy_range_mi','label_city_mpge',
--                            'unadj_city_mpge','unadj_hwy_mpge','adj_city_mpge','adj_hwy_mpge',
--                            'label_adjustment_factor','label_calc_approach','nominal_pack_kwh',
--                            'fe_guide_row_id');
--
-- 3. Nothing existing was disturbed — these should be unchanged from before:
--
--      SELECT count(*) AS groups,
--             count(*) FILTER (WHERE label_range_published IS NOT NULL) AS with_label
--      FROM epa_test_groups;
