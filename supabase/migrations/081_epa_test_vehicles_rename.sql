-- 081: the record we called an "EPA test group" is an EPA test vehicle (#374)
--
-- A rename, all the way down. No change in behavior.
--
-- `epa_test_groups` is keyed by EPA's Vehicle ID: the physical car in the lab.
-- EPA's own Test Group (`RHYXV00.0301`) is something else — the certification,
-- one filing for one model year, whose first letter is that year. The two are
-- many-to-many: one Test Group covers several test vehicles, and one test
-- vehicle appears in several years' Test Groups (#374). Calling our record a
-- "test group" is what made a carryover certification look like an overwrite,
-- and why `exactTestGroupMatches` compared the Guide's Test Group with a
-- Vehicle ID.
--
--   epa_test_groups                    → epa_test_vehicles
--   *.test_group_id                    → *.test_vehicle_id
--   epa_vehicle_mappings.epa_test_group_id → test_vehicle_id
--   epa_test_vehicles.epa_test_family_id   → test_group   (it always held EPA's
--                                            Test Group; "test family" is a
--                                            different EPA identifier)
--   epa_test_vehicles.carryover_test_group_id → carryover_test_group
--
-- plus every constraint, index and policy named after them, and three places
-- where the old names are stored as DATA: `epa_field_audit.table_name`, the
-- `overrides` keys the importer tags per column, and one chart help bubble.
--
-- Left alone on purpose: `epa_fe_guide.smog_test_group` (it IS a Test Group, and
-- mirrors the Guide's own column), `epa_covered_models.certification_region`
-- (EPA's term), and the old migrations, which are history.
--
-- ── Deploying ───────────────────────────────────────────────────────────────
--
-- The code that reads these names ships with this migration. Merge, wait for
-- the deploy, then apply. In between, getVehicles retries without its EPA embed
-- on a missing relation, so the site loads without EPA figures rather than not
-- at all. Apply promptly; every other EPA view errors until it is.
--
-- Safe to run twice: every rename checks the catalog first. Renaming a table
-- keeps its rows, grants, RLS, triggers and foreign keys; only names change.

BEGIN;

-- ── helpers (session-only) ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pg_temp.rename_column(t text, old_name text, new_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = old_name)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = new_name)
    THEN
        EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', t, old_name, new_name);
    END IF;
END $$;

-- Constraints, including a PRIMARY KEY or UNIQUE whose index shares the name
-- (renaming the constraint renames that index too). Postgres 18 also names
-- NOT NULL constraints, production's version does not — so a name that is
-- absent is skipped, never an error.
CREATE OR REPLACE FUNCTION pg_temp.rename_constraint(t text, old_name text, new_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = format('public.%I', t)::regclass AND conname = old_name)
    THEN
        EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', t, old_name, new_name);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rename_policy(t text, old_name text, new_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t AND policyname = old_name)
    THEN
        EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', old_name, t, new_name);
    END IF;
END $$;

-- ── the table ───────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.epa_test_groups RENAME TO epa_test_vehicles;

SELECT pg_temp.rename_column('epa_test_vehicles', 'test_group_id',           'test_vehicle_id');
SELECT pg_temp.rename_column('epa_test_vehicles', 'epa_test_family_id',      'test_group');
SELECT pg_temp.rename_column('epa_test_vehicles', 'carryover_test_group_id', 'carryover_test_group');

-- ── the foreign keys pointing at it ─────────────────────────────────────────

SELECT pg_temp.rename_column('epa_coefficient_sets', 'test_group_id',     'test_vehicle_id');
SELECT pg_temp.rename_column('epa_tests',            'test_group_id',     'test_vehicle_id');
SELECT pg_temp.rename_column('epa_covered_models',   'test_group_id',     'test_vehicle_id');
SELECT pg_temp.rename_column('epa_field_audit',      'test_group_id',     'test_vehicle_id');
SELECT pg_temp.rename_column('epa_vehicle_mappings', 'epa_test_group_id', 'test_vehicle_id');

-- ── constraints ─────────────────────────────────────────────────────────────

SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_pkey',                          'epa_test_vehicles_pkey');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_fe_guide_row_id_fkey',          'epa_test_vehicles_fe_guide_row_id_fkey');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_label_method_check',            'epa_test_vehicles_label_method_check');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_charger_efficiency_override_check', 'epa_test_vehicles_charger_efficiency_override_check');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_drivetrain_eta_override_check',    'epa_test_vehicles_drivetrain_eta_override_check');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_test_group_id_not_null',        'epa_test_vehicles_test_vehicle_id_not_null');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_label_method_inferred_not_null', 'epa_test_vehicles_label_method_inferred_not_null');
SELECT pg_temp.rename_constraint('epa_test_vehicles', 'epa_test_groups_overrides_not_null',            'epa_test_vehicles_overrides_not_null');

SELECT pg_temp.rename_constraint('epa_coefficient_sets', 'epa_coefficient_sets_test_group_id_category_key', 'epa_coefficient_sets_test_vehicle_id_category_key');
SELECT pg_temp.rename_constraint('epa_coefficient_sets', 'epa_coefficient_sets_test_group_id_fkey',         'epa_coefficient_sets_test_vehicle_id_fkey');
SELECT pg_temp.rename_constraint('epa_coefficient_sets', 'epa_coefficient_sets_test_group_id_not_null',     'epa_coefficient_sets_test_vehicle_id_not_null');
SELECT pg_temp.rename_constraint('epa_tests',            'epa_tests_test_group_id_fkey',                    'epa_tests_test_vehicle_id_fkey');
SELECT pg_temp.rename_constraint('epa_tests',            'epa_tests_test_group_id_not_null',                'epa_tests_test_vehicle_id_not_null');
SELECT pg_temp.rename_constraint('epa_covered_models',   'epa_covered_models_test_group_id_fkey',           'epa_covered_models_test_vehicle_id_fkey');
SELECT pg_temp.rename_constraint('epa_covered_models',   'epa_covered_models_test_group_id_not_null',       'epa_covered_models_test_vehicle_id_not_null');
SELECT pg_temp.rename_constraint('epa_vehicle_mappings', 'epa_vehicle_mappings_epa_test_group_id_fkey',     'epa_vehicle_mappings_test_vehicle_id_fkey');
SELECT pg_temp.rename_constraint('epa_vehicle_mappings', 'epa_vehicle_mappings_epa_test_group_id_not_null', 'epa_vehicle_mappings_test_vehicle_id_not_null');
SELECT pg_temp.rename_constraint('epa_vehicle_mappings', 'epa_vehicle_mappings_vehicle_id_epa_test_group_id_key', 'epa_vehicle_mappings_vehicle_id_test_vehicle_id_key');

-- ── indexes ─────────────────────────────────────────────────────────────────

ALTER INDEX IF EXISTS public.idx_epa_groups_awaiting_fe_link RENAME TO idx_epa_test_vehicles_awaiting_fe_link;
ALTER INDEX IF EXISTS public.idx_epa_groups_fe_guide_row     RENAME TO idx_epa_test_vehicles_fe_guide_row;
ALTER INDEX IF EXISTS public.idx_epa_coeff_sets_group        RENAME TO idx_epa_coeff_sets_test_vehicle;
ALTER INDEX IF EXISTS public.idx_covered_models_group        RENAME TO idx_covered_models_test_vehicle;
ALTER INDEX IF EXISTS public.idx_epa_tests_group             RENAME TO idx_epa_tests_test_vehicle;
ALTER INDEX IF EXISTS public.idx_epa_audit_group             RENAME TO idx_epa_audit_test_vehicle;

-- ── policies ────────────────────────────────────────────────────────────────

SELECT pg_temp.rename_policy('epa_test_vehicles', 'Public read epa_test_groups',     'Public read epa_test_vehicles');
SELECT pg_temp.rename_policy('epa_test_vehicles', 'Curators insert epa_test_groups', 'Curators insert epa_test_vehicles');
SELECT pg_temp.rename_policy('epa_test_vehicles', 'Curators update epa_test_groups', 'Curators update epa_test_vehicles');
SELECT pg_temp.rename_policy('epa_test_vehicles', 'Admins delete epa_test_groups',   'Admins delete epa_test_vehicles');

-- ── the old names stored as data ────────────────────────────────────────────

-- The audit trail names the table each row belongs to (66 rows).
UPDATE public.epa_field_audit SET table_name = 'epa_test_vehicles'
 WHERE table_name = 'epa_test_groups';

-- The importer tags each column it wrote in `overrides`, keyed by column name
-- (696 records). A tag under an old key would read as untagged — and an
-- untagged field is one a later import may overwrite.
UPDATE public.epa_test_vehicles
   SET overrides = (overrides - 'test_group_id' - 'epa_test_family_id' - 'carryover_test_group_id')
                   || jsonb_strip_nulls(jsonb_build_object(
                          'test_vehicle_id',      overrides -> 'test_group_id',
                          'test_group',           overrides -> 'epa_test_family_id',
                          'carryover_test_group', overrides -> 'carryover_test_group_id'))
 WHERE overrides ?| ARRAY['test_group_id', 'epa_test_family_id', 'carryover_test_group_id'];

-- The Modeled Efficiency help bubble (chart_help, curator-editable text).
UPDATE public.chart_help
   SET data_source = replace(data_source, 'linked EPA test group', 'linked EPA test vehicle')
 WHERE chart_key = 'epacurves' AND data_source LIKE '%linked EPA test group%';

COMMENT ON TABLE public.epa_test_vehicles IS
    'One EPA test vehicle: the physical car in the lab, keyed by EPA''s Vehicle ID, with its coefficients, tests and phases. Not EPA''s Test Group, which is the certification (#374).';
COMMENT ON COLUMN public.epa_test_vehicles.test_group IS
    'EPA''s Test Group (the certification) this record was last imported under. Retired by #374 step 2, which gives each certification its own row.';

-- PostgREST caches the schema; tell it the names moved.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify (expect 0 rows from each) ────────────────────────────────────────
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND column_name IN ('test_group_id', 'epa_test_group_id', 'epa_test_family_id', 'carryover_test_group_id');
--   SELECT conname FROM pg_constraint WHERE conname LIKE '%test_group%';
--   SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%epa_groups%';
--   SELECT policyname FROM pg_policies WHERE policyname LIKE '%epa_test_groups%';
--   SELECT count(*) FROM epa_field_audit WHERE table_name = 'epa_test_groups';
--   SELECT count(*) FROM epa_test_vehicles
--    WHERE overrides ?| ARRAY['test_group_id', 'epa_test_family_id', 'carryover_test_group_id'];
