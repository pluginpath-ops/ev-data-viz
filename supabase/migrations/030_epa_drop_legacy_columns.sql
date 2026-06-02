-- ============================================================
-- Migration 030: EPA curator refactor — cleanup (drop legacy columns)
--
-- Apply ONLY after PRs C, D, E (+ F) are merged. By then no code reads these
-- columns: coefficients live in epa_coefficient_sets, per-cycle/label-method/
-- η data is superseded by the read-time DC-based derivations, and the surviving
-- label fields (label_combined_mpge, label_hwy_mpge, label_range_published,
-- cd_range_*) are populated by the new importer / curator form.
--
-- getEpaTestGroupFull() uses SELECT *, which tolerates the removed columns;
-- no explicit select names any of them post-PR-E. Safe and reversible only via
-- the migration-020/025 definitions, so confirm before running in prod.
--
-- KEPT (still in use): label_combined_mpge, label_hwy_mpge, label_range_published,
--   cd_range_combined_calc, cd_range_hwy_calc, derived_5cycle_coefficient,
--   useable_kwh, total_voltage, battery_specific_energy, accessory_load_w_override,
--   charger_efficiency_override, evap_family, vehicle_config_number, display_name,
--   overrides, identity columns.
-- ============================================================

ALTER TABLE public.epa_test_groups
    -- Flat road-load coefficients + weight → moved to epa_coefficient_sets
    DROP COLUMN IF EXISTS target_a,
    DROP COLUMN IF EXISTS target_b,
    DROP COLUMN IF EXISTS target_c,
    DROP COLUMN IF EXISTS set_a,
    DROP COLUMN IF EXISTS set_b,
    DROP COLUMN IF EXISTS set_c,
    DROP COLUMN IF EXISTS equiv_test_weight_lbs,

    -- Per-cycle AC energy → superseded by DC-side phase data (epa_test_phases)
    DROP COLUMN IF EXISTS udds_unadj_kwh_100mi,
    DROP COLUMN IF EXISTS udds_adj_kwh_100mi,
    DROP COLUMN IF EXISTS hwfet_unadj_kwh_100mi,
    DROP COLUMN IF EXISTS hwfet_adj_kwh_100mi,
    DROP COLUMN IF EXISTS us06_unadj_kwh_100mi,
    DROP COLUMN IF EXISTS us06_adj_kwh_100mi,
    DROP COLUMN IF EXISTS sc03_unadj_kwh_100mi,
    DROP COLUMN IF EXISTS sc03_adj_kwh_100mi,
    DROP COLUMN IF EXISTS cold_ftp_unadj_kwh_100mi,
    DROP COLUMN IF EXISTS cold_ftp_adj_kwh_100mi,

    -- Label-method inference → replaced by the effective-adjustment-factor derivation
    DROP COLUMN IF EXISTS label_method,
    DROP COLUMN IF EXISTS label_method_inferred,

    -- η override → η is now purely derived from DC phase data
    DROP COLUMN IF EXISTS drivetrain_eta_override,

    -- Legacy range / label variants → replaced by cd_range_* / label_range_published
    DROP COLUMN IF EXISTS range_city_mi,
    DROP COLUMN IF EXISTS range_hwy_mi,
    DROP COLUMN IF EXISTS range_combined_mi,
    DROP COLUMN IF EXISTS label_city_mpge,
    DROP COLUMN IF EXISTS label_combined_mi,
    DROP COLUMN IF EXISTS label_city_mi,
    DROP COLUMN IF EXISTS label_hwy_mi;
