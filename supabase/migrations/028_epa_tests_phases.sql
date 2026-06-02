-- ============================================================
-- Migration 028: EPA curator refactor — Part 3 (tests + phases)
--
-- Spec Sections 3–5. A configuration can have multiple tests (one per
-- procedure run); each test has a variable number of phases.
--
--   Procedure precedence for derivations: 77 (MCT) preferred,
--   84 (Charge Depleting Highway) fallback, 81 (CD UDDS) stored but
--   excluded from efficiency derivation.
--
-- Phase DC energy / AC recharge / test numbers are NOT in the quarterly
-- Test Car List CSV — they come from J1634 sheets / CSI PDFs and are
-- entered by the curator. Hence everything here is nullable.
-- ============================================================

-- ── epa_tests (Section 3 record + Section 5 energy totals) ──────────────────────
CREATE TABLE epa_tests (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_group_id   text NOT NULL
                        REFERENCES epa_test_groups(test_group_id) ON DELETE CASCADE,

    -- Section 3: Per-Test Record
    test_number     text,          -- EPA test identifier (e.g. VRIV10093452)
    procedure_code  integer,       -- 77 MCT | 84 CD-Hwy | 81 CD-UDDS | 2 FTP-75
    originator      text CHECK (originator IS NULL OR originator IN ('MFR','EPA')),
    lab_id          text,          -- physical lab (FEV Michigan, EPA Ann Arbor, …)
    test_date       date,
    source          text CHECK (source IS NULL
                        OR source IN ('csv','j1634','csi_pdf','manual')),

    -- Section 5: Test-Level Energy Totals
    total_dc_energy_kwh   numeric(10,4),  -- total battery-side energy to depletion (incl. SS)
    ac_recharge_kwh       numeric(10,4),  -- AC-side refill energy (nullable; for charger eff)
    bags_phases_conducted integer,        -- expected phase count for verification
    total_distance_mi     numeric(10,3),
    recharge_voltage      numeric(8,2),

    overrides       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_epa_tests_group ON epa_tests(test_group_id);

-- ── epa_test_phases (Section 4 — child list per test) ───────────────────────────
CREATE TABLE epa_test_phases (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_id         bigint NOT NULL REFERENCES epa_tests(id) ON DELETE CASCADE,

    phase_index     integer NOT NULL,   -- position in the test sequence
    -- Identity comes from procedure order, NOT inferred from values.
    -- SS = steady-state depletion at a lab-chosen speed: stored for energy
    -- totals but NOT a valid efficiency anchor (speed not standardized).
    phase_type      text CHECK (phase_type IS NULL OR phase_type IN
                        ('UDDS','HWY','SS','Cold-UDDS','US06','SC03')),
    dc_energy_kwh   numeric(10,4),       -- Integrated DC KW-HRS (battery-side)
    distance_mi     numeric(10,3),       -- Actual Distance Driven (miles)
    -- dc_consumption (Wh/mi) is DERIVED at read time, never stored.

    overrides       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now(),

    UNIQUE (test_id, phase_index)
);

CREATE INDEX idx_epa_phases_test ON epa_test_phases(test_id);

-- ── RLS (both tables): public read, admin+contributor write ─────────────────────
ALTER TABLE epa_tests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE epa_test_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read epa_tests"       ON epa_tests       FOR SELECT USING (true);
CREATE POLICY "Public read epa_test_phases" ON epa_test_phases FOR SELECT USING (true);

CREATE POLICY "Curators insert epa_tests" ON epa_tests FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));
CREATE POLICY "Curators update epa_tests" ON epa_tests FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));
CREATE POLICY "Curators delete epa_tests" ON epa_tests FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators insert epa_test_phases" ON epa_test_phases FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));
CREATE POLICY "Curators update epa_test_phases" ON epa_test_phases FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));
CREATE POLICY "Curators delete epa_test_phases" ON epa_test_phases FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
