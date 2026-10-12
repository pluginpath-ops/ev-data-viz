-- 084: drop the test vehicle's copies of what belongs to a certification (#374)
--
-- A Guide link, its skip and the carryover pair are per certification, and
-- since migration 082 they live on epa_certification_test_vehicles. Layer 3
-- stopped reading the test vehicle's own copies and 083 marked them retired;
-- this drops them:
--
--   fe_guide_row_id, fe_guide_skipped_at, fe_guide_skip_note,
--   carryover_test_group, carryover_model_year
--
-- `model_year` and `test_group` stay: they are "the certification this record
-- was last imported under", which the importer still uses to keep an older
-- file from replacing a newer one's identity (epaImportMerge.IDENTITY_FIELDS).
--
-- Nothing is lost. On the 2026-10-10 21:37 backup with 083 applied, every
-- non-null value here is also on one of the test vehicle's link rows: 324
-- Guide links, 3 skips, 676 carryover pairs; 0 found only here. The notices
-- below repeat that count when this runs, before anything is dropped.
--
-- ── Order ───────────────────────────────────────────────────────────────────
--
-- Apply AFTER the code that stops reading and writing these columns is
-- deployed. That code no longer selects fe_guide_row_id in the vehicles query
-- and no longer sends the carryover pair with a PDF import. Code from before it
-- would lose its EPA figures on the Vehicles page (its fallback drops the EPA
-- embed) and fail a PDF import until it is deployed.
--
-- The trigger that clears a skip on linking (058) is dropped from this table
-- first: it names fe_guide_row_id, so leaving it would fail every UPDATE of a
-- test vehicle. The same function stays on the link rows (082).

DO $$
DECLARE
    guide_only int;
    skip_only  int;
    carry_only int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'epa_test_vehicles'
                     AND column_name = 'fe_guide_row_id') THEN
        RAISE NOTICE '084: already applied';
        RETURN;
    END IF;

    SELECT count(*) INTO guide_only FROM public.epa_test_vehicles t
     WHERE t.fe_guide_row_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles l
                       WHERE l.test_vehicle_id = t.test_vehicle_id
                         AND l.fe_guide_row_id = t.fe_guide_row_id);
    SELECT count(*) INTO skip_only FROM public.epa_test_vehicles t
     WHERE t.fe_guide_skipped_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles l
                       WHERE l.test_vehicle_id = t.test_vehicle_id
                         AND l.fe_guide_skipped_at IS NOT NULL);
    SELECT count(*) INTO carry_only FROM public.epa_test_vehicles t
     WHERE t.carryover_test_group IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles l
                       WHERE l.test_vehicle_id = t.test_vehicle_id
                         AND l.carryover_test_group IS NOT DISTINCT FROM t.carryover_test_group
                         AND l.carryover_model_year IS NOT DISTINCT FROM t.carryover_model_year);

    -- A link a curator removed after layer 3 shipped is still here, stale, and
    -- counts as "only here". That is expected; anything else is worth a look.
    RAISE NOTICE '084: values held only on the test vehicle — Guide links %, skips %, carryover pairs %',
        guide_only, skip_only, carry_only;
END $$;

DROP TRIGGER IF EXISTS trg_clear_fe_skip_on_link ON public.epa_test_vehicles;

DROP INDEX IF EXISTS public.idx_epa_test_vehicles_awaiting_fe_link;
DROP INDEX IF EXISTS public.idx_epa_test_vehicles_fe_guide_row;

ALTER TABLE public.epa_test_vehicles
    DROP COLUMN IF EXISTS fe_guide_row_id,
    DROP COLUMN IF EXISTS fe_guide_skipped_at,
    DROP COLUMN IF EXISTS fe_guide_skip_note,
    DROP COLUMN IF EXISTS carryover_test_group,
    DROP COLUMN IF EXISTS carryover_model_year;

NOTIFY pgrst, 'reload schema';
