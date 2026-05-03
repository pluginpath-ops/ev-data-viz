-- Migration 020: EPA Road-Load Curves
--
-- Adds two tables:
--   epa_test_groups     — one row per EPA test group (reference data, admin-write-only)
--   epa_vehicle_mappings — links app vehicles to EPA test groups (contributor-writable)
--
-- EPA records are inserted directly via the database; the app only reads and visualises them.

-- ── epa_test_groups ──────────────────────────────────────────────────────────

CREATE TABLE epa_test_groups (
    -- Identity
    test_group_id         text        PRIMARY KEY,  -- EPA's verbatim text ID
    model_year            integer     NOT NULL,
    make                  text        NOT NULL,
    epa_carline_name      text        NOT NULL,     -- EPA name, preserved verbatim
    transmission          text,
    drive                 text,                     -- FWD / RWD / AWD / 4WD
    fuel_type             text,                     -- BEV, PHEV, HEV, gas, …

    -- Road load (physics layer)
    -- Coefficients in EPA standard units: A [lbf], B [lbf/mph], C [lbf/mph²]
    equiv_test_weight_lbs numeric(10,2),
    target_a              numeric(10,4),            -- EPA-accepted (certified) value
    target_b              numeric(10,6),
    target_c              numeric(10,8),
    set_a                 numeric(10,4),            -- value actually programmed on dyno
    set_b                 numeric(10,6),
    set_c                 numeric(10,8),

    -- Per-cycle results  (NULL = cycle was not run — this is meaningful, not missing data)
    -- Unadjusted = raw dyno measurement; adjusted = post-correction-factor (label basis)
    udds_unadj_kwh_100mi      numeric(8,4),
    udds_adj_kwh_100mi        numeric(8,4),
    hwfet_unadj_kwh_100mi     numeric(8,4),
    hwfet_adj_kwh_100mi       numeric(8,4),
    us06_unadj_kwh_100mi      numeric(8,4),
    us06_adj_kwh_100mi        numeric(8,4),
    sc03_unadj_kwh_100mi      numeric(8,4),
    sc03_adj_kwh_100mi        numeric(8,4),
    cold_ftp_unadj_kwh_100mi  numeric(8,4),
    cold_ftp_adj_kwh_100mi    numeric(8,4),

    -- EV-specific label / range fields
    range_city_mi         numeric(8,2),
    range_hwy_mi          numeric(8,2),
    range_combined_mi     numeric(8,2),
    useable_kwh           numeric(8,3),            -- often absent from EPA data; nullable

    -- Label derivation
    label_method          text
                              CHECK (label_method IN
                                  ('2-cycle','5-cycle','vehicle-specific','mpg-based')),
    label_city_mpge       numeric(8,2),
    label_hwy_mpge        numeric(8,2),
    label_combined_mpge   numeric(8,2),
    label_city_mi         numeric(8,2),
    label_hwy_mi          numeric(8,2),
    label_combined_mi     numeric(8,2),

    -- Provenance
    source_file           text,
    ingested_at           timestamptz,
    created_at            timestamptz DEFAULT now()
);

ALTER TABLE epa_test_groups ENABLE ROW LEVEL SECURITY;

-- Reference data — anyone can read
CREATE POLICY "Public read epa_test_groups"
    ON epa_test_groups FOR SELECT USING (true);

-- Data originates from EPA bulk files processed outside the app; only admins write
CREATE POLICY "Admins insert epa_test_groups"
    ON epa_test_groups FOR INSERT
    WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "Admins update epa_test_groups"
    ON epa_test_groups FOR UPDATE
    USING (current_user_role() = 'admin');

CREATE POLICY "Admins delete epa_test_groups"
    ON epa_test_groups FOR DELETE
    USING (current_user_role() = 'admin');


-- ── epa_vehicle_mappings ──────────────────────────────────────────────────────

CREATE TABLE epa_vehicle_mappings (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id          bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    epa_test_group_id   text   NOT NULL REFERENCES epa_test_groups(test_group_id) ON DELETE CASCADE,
    -- confidence: how certain we are that this vehicle matches this EPA test group
    confidence          text   NOT NULL DEFAULT 'inferred'
                            CHECK (confidence IN ('verified','likely','inferred')),
    notes               text,
    created_by          uuid REFERENCES auth.users(id),
    created_at          timestamptz DEFAULT now(),
    UNIQUE (vehicle_id, epa_test_group_id)
);

ALTER TABLE epa_vehicle_mappings ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_epa_mappings_vehicle ON epa_vehicle_mappings(vehicle_id);

CREATE POLICY "Public read epa_vehicle_mappings"
    ON epa_vehicle_mappings FOR SELECT USING (true);

-- Contributors link vehicles to test groups via the in-app UI
CREATE POLICY "Contributors insert epa_vehicle_mappings"
    ON epa_vehicle_mappings FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Contributors update epa_vehicle_mappings"
    ON epa_vehicle_mappings FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Admins delete epa_vehicle_mappings"
    ON epa_vehicle_mappings FOR DELETE
    USING (current_user_role() = 'admin');
