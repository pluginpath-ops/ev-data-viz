-- 083: Guide figures are read, not copied (#374 step 2, layer 3)
--
-- Until #374 linking a Fuel Economy Guide row COPIED its figures onto the test
-- vehicle ("promotion"): label range, MPGe, unadjusted figures, the adjustment
-- factor, pack voltage and energy — each tagged in `overrides` as
-- { source: 'fe_guide', previous: <the value it displaced> }. One row of
-- columns cannot hold a test vehicle certified in three years, each with its
-- own Guide row, so the app now reads the Guide row of the certification in
-- question and lays its figures over the record at read time
-- (feGuidePromotion.guideOverlay, epaCertifications.testVehicleView).
--
-- This puts every copied value back to what it displaced and drops the tag,
-- so the stored columns hold the certificate's own values again. Nothing is
-- lost: the Guide's figures are still on the Guide row, linked through
-- epa_certification_test_vehicles (migration 082). A value a curator set by
-- hand carries 'manual', not 'fe_guide', and is not touched.
--
-- On the 2026-10-08 backup: 255 test vehicles, 3,811 tagged values.
--
-- ── Order ───────────────────────────────────────────────────────────────────
--
-- Safe in either order with the layer-3 code: that code lays the Guide over
-- whatever is stored, so before this runs it overlays the copied values with
-- the same values, and after it overlays the restored ones. The code that
-- shipped before layer 3 read the copies directly — apply this only once
-- layer 3 is deployed. Requires 082 (the links it reads moved there).
--
-- It also marks the columns layer 3 stopped reading. They are dropped in a
-- later migration, once nothing has read them for a while.
--
-- Safe to run twice: the second run finds no tags.

BEGIN;

DO $$
DECLARE
    col text;
    typ text;
BEGIN
    -- feGuidePromotion.GUIDE_FIELD_MAP's targets.
    FOREACH col IN ARRAY ARRAY[
        'label_range_published', 'label_city_range_mi', 'label_hwy_range_mi',
        'label_combined_mpge', 'label_city_mpge', 'label_hwy_mpge',
        'unadj_city_mpge', 'unadj_hwy_mpge', 'adj_city_mpge', 'adj_hwy_mpge',
        'label_adjustment_factor', 'label_calc_approach',
        'total_voltage', 'battery_specific_energy', 'nominal_pack_kwh'
    ] LOOP
        SELECT format_type(a.atttypid, a.atttypmod) INTO typ
          FROM pg_attribute a
         WHERE a.attrelid = 'public.epa_test_vehicles'::regclass
           AND a.attname = col AND NOT a.attisdropped;
        CONTINUE WHEN typ IS NULL;

        -- `previous` absent or null restores to null: the field was empty
        -- before the Guide filled it, and the tag's existence is what marked it.
        EXECUTE format(
            'UPDATE public.epa_test_vehicles
                SET %1$I = (overrides -> %2$L ->> ''previous'')::%3$s,
                    overrides = overrides - %2$L
              WHERE overrides -> %2$L ->> ''source'' = ''fe_guide''',
            col, col, typ);
    END LOOP;
END $$;

COMMENT ON COLUMN public.epa_test_vehicles.fe_guide_row_id IS
    'Retired by #374 layer 3: a Guide link belongs to a certification — epa_certification_test_vehicles.fe_guide_row_id. Kept until a later migration drops it.';
COMMENT ON COLUMN public.epa_test_vehicles.fe_guide_skipped_at IS
    'Retired by #374 layer 3: see epa_certification_test_vehicles.fe_guide_skipped_at.';
COMMENT ON COLUMN public.epa_test_vehicles.fe_guide_skip_note IS
    'Retired by #374 layer 3: see epa_certification_test_vehicles.fe_guide_skip_note.';
COMMENT ON COLUMN public.epa_test_vehicles.model_year IS
    'The year of the certification this record was last imported under. Readers use the certifications instead: "Since" is the earliest (#374).';
COMMENT ON COLUMN public.epa_test_vehicles.test_group IS
    'The Test Group this record was last imported under. Readers use epa_certifications (#374).';
COMMENT ON COLUMN public.epa_test_vehicles.carryover_test_group IS
    'Retired by #374 layer 3: the carryover origin is per certification — epa_certification_test_vehicles.carryover_test_group.';
COMMENT ON COLUMN public.epa_test_vehicles.carryover_model_year IS
    'Retired by #374 layer 3: see epa_certification_test_vehicles.carryover_model_year.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify (expect 0) ───────────────────────────────────────────────────────
--   SELECT count(*) FROM epa_test_vehicles, jsonb_each(overrides) e(k, v)
--    WHERE v ->> 'source' = 'fe_guide';
