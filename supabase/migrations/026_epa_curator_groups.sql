-- ============================================================
-- Migration 026: EPA curator refactor — Part 1 (epa_test_groups)
--
-- Reshapes epa_test_groups for the curator model described in
-- LocalDev/curator-fields-spec.md. ADDITIVE ONLY — no columns are
-- dropped here so the existing getVehicles() select stays valid
-- through the refactor. Dead columns (per-cycle *_kwh_100mi,
-- label_method*, drivetrain_eta_override, old range_*/label_* variants,
-- target/set coeffs once moved) are removed in a later cleanup
-- migration after the UI stops referencing them.
--
-- FRESH START: existing EPA rows are truncated. The old per-cycle data
-- is AC-adjusted (label basis) and cannot seed the new DC-based η
-- derivation, so re-curation under the new model starts clean.
--
-- Curator role: writes open to admin + contributor (was admin-only).
-- ============================================================

-- ── Fresh start: clear EPA data (mappings cascade off test_groups) ──────────────
TRUNCATE TABLE epa_test_groups CASCADE;

-- ── New config-level columns (Spec Sections 1, 6, 7) ────────────────────────────

ALTER TABLE epa_test_groups
    -- Section 1: Identity & Configuration
    ADD COLUMN IF NOT EXISTS evap_family            text,    -- Certified Evaporative Family (blank ⇒ BEV)
    ADD COLUMN IF NOT EXISTS vehicle_config_number  text,    -- Vehicle ID / Configuration Number
    -- Section 6: Range & Label Values
    ADD COLUMN IF NOT EXISTS cd_range_combined_calc numeric(8,2),  -- CD Range Combined (calc, unadjusted)
    ADD COLUMN IF NOT EXISTS cd_range_hwy_calc      numeric(8,2),  -- CD Range Highway (calc, unadjusted)
    ADD COLUMN IF NOT EXISTS label_range_published  numeric(8,2),  -- window-sticker range (adjusted)
    ADD COLUMN IF NOT EXISTS derived_5cycle_coefficient numeric(8,4), -- blank ⇒ default 0.7 used
    -- Section 7: Battery & Powertrain Assumptions
    ADD COLUMN IF NOT EXISTS total_voltage              numeric(8,2),  -- Total Voltage of Battery Packs
    ADD COLUMN IF NOT EXISTS battery_specific_energy    numeric(8,2),  -- Wh/kg fallback for capacity
    ADD COLUMN IF NOT EXISTS accessory_load_w_override  numeric(8,2),  -- default 300 W in derivation
    ADD COLUMN IF NOT EXISTS charger_efficiency_override numeric(4,3)
        CHECK (charger_efficiency_override IS NULL
               OR (charger_efficiency_override > 0 AND charger_efficiency_override <= 1)),
    -- Cross-cutting: which fields are curator-overridden vs CSV-imported.
    -- Shape: { "<field>": { "source": "csv|manual", "at": "<iso>", "by": "<uuid>" } }
    ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN epa_test_groups.make IS
    'Certificate Manufacturer Name (EPA). Column name kept as make for app compatibility.';
COMMENT ON COLUMN epa_test_groups.epa_carline_name IS
    'Represented Test Vehicle Model (EPA) — preserved verbatim.';
COMMENT ON COLUMN epa_test_groups.overrides IS
    'Per-field provenance: which columns were curator-edited vs CSV-imported. Drives the override flag in the curator form.';

-- ── Relax identity NOT NULLs for partial/pre-spreadsheet curator entry ──────────
ALTER TABLE epa_test_groups ALTER COLUMN model_year       DROP NOT NULL;
ALTER TABLE epa_test_groups ALTER COLUMN make             DROP NOT NULL;
ALTER TABLE epa_test_groups ALTER COLUMN epa_carline_name DROP NOT NULL;

-- ── RLS: open writes to admin + contributor (curator role) ──────────────────────
DROP POLICY IF EXISTS "Admins insert epa_test_groups" ON epa_test_groups;
DROP POLICY IF EXISTS "Admins update epa_test_groups" ON epa_test_groups;
DROP POLICY IF EXISTS "Admins delete epa_test_groups" ON epa_test_groups;

CREATE POLICY "Curators insert epa_test_groups"
    ON epa_test_groups FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update epa_test_groups"
    ON epa_test_groups FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

-- Deletes remain admin-only to protect shared reference data.
CREATE POLICY "Admins delete epa_test_groups"
    ON epa_test_groups FOR DELETE
    USING (current_user_role() = 'admin');
