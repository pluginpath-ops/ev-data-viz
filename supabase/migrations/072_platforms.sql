-- ============================================================
-- Migration 072: platforms, and which ones a vehicle is built on (#318)
--
-- Additive: one table, two nullable columns on vehicles, a trigger, a seed.
-- Nothing dropped, nothing backfilled onto vehicles.
--
-- -- Why ---------------------------------------------------------------------
--
-- A vehicle record says nothing about what it is underneath. The Solterra and
-- the bZ4X are the same car; every E-GMP vehicle shares a charging curve. That
-- knowledge predicts twins, charging behaviour and outliers, and until now it
-- lived only in a curator's head.
--
-- -- Two kinds, one table ----------------------------------------------------
--
-- Structure and electrical architecture usually coincide and diverge exactly
-- where a curator must not lump cars together: the 2022-24 and 2025+ Rivian R1
-- share a skateboard and nothing electrical; the Lucid Air and Gravity share
-- the electrical system (marketed as 900 V) and not a body. So a vehicle has one of each:
--
--   mechanical   body, structure, suspension - dimensions, twins, inheritance
--   electrical   pack, drive units, power electronics - the charging curve
--
-- A platform is its own row rather than a name typed on each vehicle, so what
-- is true of the platform (its voltage class, how it charges on a 400 V
-- charger, its chemistries) is said once. Only electrical platforms carry
-- those properties; a CHECK keeps them off mechanical rows.
--
-- NACS-native is deliberately NOT a platform property: it changed within one
-- platform by model year (a 2024 and a 2025 Ioniq 5 share E-GMP), so it stays
-- the vehicle's `charging.charge_port` spec.
--
-- -- The seed is a DRAFT -----------------------------------------------------
--
-- Names and maker groups for the common platforms, with a property filled only
-- where it is well established and left null where it is not. Review it before
-- relying on it. Curators edit the list in Admin; nothing here is final.
--
-- Safe to run twice.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platforms (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             text NOT NULL CHECK (kind IN ('mechanical', 'electrical')),
    name             text NOT NULL CHECK (btrim(name) <> ''),
    maker_group      text,
    aliases          text[] NOT NULL DEFAULT '{}',
    -- Electrical only.
    -- Any positive class, not a fixed list: the classes are named in code
    -- (VOLTAGE_CLASSES in src/utils/platforms.js), so adding one is a code
    -- change, not a migration.
    voltage_class_v  smallint CHECK (voltage_class_v > 0),
    dc_400v_charging text CHECK (dc_400v_charging IN ('native', 'dc-booster', 'motor-boost', 'split-pack', 'none')),
    chemistries      text[] NOT NULL DEFAULT '{}',
    cell_format      text CHECK (cell_format IN ('cylindrical', 'prismatic', 'pouch', 'blade')),
    notes            text,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    CONSTRAINT platforms_electrical_properties CHECK (
        kind = 'electrical'
        OR (voltage_class_v IS NULL AND dc_400v_charging IS NULL AND chemistries = '{}' AND cell_format IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_kind_name ON platforms (kind, lower(name));

COMMENT ON TABLE platforms IS
    'What a vehicle is built on: a mechanical platform (structure) and an electrical one (pack, drives, charging). #318.';
COMMENT ON COLUMN platforms.voltage_class_v IS
    'Pack architecture class, e.g. 400 or 800 V; the list lives in code (VOLTAGE_CLASSES). Electrical platforms only.';
COMMENT ON COLUMN platforms.dc_400v_charging IS
    'How it takes DC from a 400 V charger: native (it is 400 V), dc-booster, motor-boost (drive inverter steps up), split-pack (halves charged in parallel), none.';

ALTER TABLE platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read platforms" ON platforms;
CREATE POLICY "Public read platforms"
    ON platforms FOR SELECT USING (true);

DROP POLICY IF EXISTS "Curators insert platforms" ON platforms;
CREATE POLICY "Curators insert platforms"
    ON platforms FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators update platforms" ON platforms;
CREATE POLICY "Curators update platforms"
    ON platforms FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators delete platforms" ON platforms;
CREATE POLICY "Curators delete platforms"
    ON platforms FOR DELETE
    USING (current_user_role() IN ('admin', 'contributor'));

-- SET NULL: deleting a platform unlinks its vehicles, never deletes them.
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS mechanical_platform_id bigint REFERENCES platforms(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS electrical_platform_id bigint REFERENCES platforms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_mechanical_platform ON vehicles(mechanical_platform_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_electrical_platform ON vehicles(electrical_platform_id);

-- Each link points at a platform of its own kind. A foreign key cannot say
-- that, and an electrical platform in the mechanical slot would silently group
-- the wrong cars together.
CREATE OR REPLACE FUNCTION check_vehicle_platform_kinds() RETURNS trigger AS $$
BEGIN
    IF NEW.mechanical_platform_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM platforms WHERE id = NEW.mechanical_platform_id AND kind = 'mechanical'
    ) THEN
        RAISE EXCEPTION 'mechanical_platform_id % is not a mechanical platform', NEW.mechanical_platform_id;
    END IF;
    IF NEW.electrical_platform_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM platforms WHERE id = NEW.electrical_platform_id AND kind = 'electrical'
    ) THEN
        RAISE EXCEPTION 'electrical_platform_id % is not an electrical platform', NEW.electrical_platform_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicles_platform_kinds ON vehicles;
CREATE TRIGGER vehicles_platform_kinds
    BEFORE INSERT OR UPDATE OF mechanical_platform_id, electrical_platform_id ON vehicles
    FOR EACH ROW EXECUTE FUNCTION check_vehicle_platform_kinds();

-- -- Draft seed ----------------------------------------------------------------

INSERT INTO platforms (kind, name, maker_group, aliases) VALUES
    ('mechanical', 'E-GMP',           'Hyundai Motor Group', ARRAY['Electric-Global Modular Platform']),
    ('mechanical', 'MEB',             'Volkswagen Group',    ARRAY['Modularer E-Antriebs-Baukasten']),
    ('mechanical', 'PPE',             'Volkswagen Group',    ARRAY['Premium Platform Electric']),
    ('mechanical', 'J1',              'Volkswagen Group',    ARRAY['J1 Performance']),
    ('mechanical', 'BEV3',            'General Motors',      ARRAY['Ultium BEV3', 'GM BEV3']),
    ('mechanical', 'BT1',             'General Motors',      ARRAY['Ultium BT1', 'GM BT1']),
    ('mechanical', 'Tesla Model 3/Y', 'Tesla',               ARRAY['Model 3/Y']),
    ('mechanical', 'Tesla Model S/X', 'Tesla',               ARRAY['Model S/X']),
    ('mechanical', 'Tesla Cybertruck','Tesla',               ARRAY['Cybertruck']),
    ('mechanical', 'GE1',             'Ford',                ARRAY['Ford GE1']),
    ('mechanical', 'P702',            'Ford',                ARRAY['F-150 Lightning']),
    ('mechanical', 'Rivian R1',       'Rivian',              ARRAY['R1']),
    ('mechanical', 'Rivian R2',       'Rivian',              ARRAY['R2']),
    ('mechanical', 'Lucid Air',       'Lucid',               ARRAY[]::text[]),
    ('mechanical', 'Lucid Gravity',   'Lucid',               ARRAY[]::text[]),
    ('mechanical', 'e-TNGA',          'Toyota',              ARRAY[]::text[]),
    ('mechanical', 'SEA',             'Geely',               ARRAY['Sustainable Experience Architecture']),
    ('mechanical', 'SPA2',            'Volvo Cars',          ARRAY[]::text[]),
    ('mechanical', 'EVA2',            'Mercedes-Benz',       ARRAY[]::text[]),
    ('mechanical', 'MMA',             'Mercedes-Benz',       ARRAY['Mercedes Modular Architecture']),
    ('mechanical', 'Neue Klasse',     'BMW',                 ARRAY[]::text[]),
    ('mechanical', 'CMF-EV',          'Renault-Nissan-Mitsubishi', ARRAY[]::text[])
ON CONFLICT (kind, (lower(name))) DO NOTHING;

INSERT INTO platforms (kind, name, maker_group, aliases, voltage_class_v, dc_400v_charging, chemistries) VALUES
    ('electrical', 'E-GMP 800 V',        'Hyundai Motor Group', ARRAY['E-GMP'],           800, 'motor-boost', ARRAY['NMC']),
    ('electrical', 'MEB 400 V',          'Volkswagen Group',    ARRAY['MEB'],             400, 'native',      ARRAY['NMC']),
    ('electrical', 'PPE 800 V',          'Volkswagen Group',    ARRAY['PPE'],             800, 'split-pack',  ARRAY['NMC']),
    ('electrical', 'J1 800 V',           'Volkswagen Group',    ARRAY['J1'],              800, 'dc-booster',  ARRAY['NMC']),
    ('electrical', 'Ultium 400 V',       'General Motors',      ARRAY['Ultium'],          400, 'native',      ARRAY['NMCA']),
    ('electrical', 'Ultium 800 V',       'General Motors',      ARRAY[]::text[],          800, 'split-pack',  ARRAY['NMCA']),
    ('electrical', 'Tesla 400 V',        'Tesla',               ARRAY[]::text[],          400, 'native',      ARRAY['NCA', 'NMC', 'LFP']),
    ('electrical', 'Cybertruck 800 V',   'Tesla',               ARRAY[]::text[],          800, NULL,          ARRAY[]::text[]),
    ('electrical', 'Ford GE1 400 V',     'Ford',                ARRAY['GE1'],             400, 'native',      ARRAY['NMC', 'LFP']),
    ('electrical', 'F-150 Lightning 400 V','Ford',              ARRAY[]::text[],          400, 'native',      ARRAY['NMC']),
    ('electrical', 'Rivian Gen 1',       'Rivian',              ARRAY[]::text[],          400, 'native',      ARRAY[]::text[]),
    ('electrical', 'Rivian Gen 2',       'Rivian',              ARRAY[]::text[],          400, 'native',      ARRAY[]::text[]),
    -- Marketed as 900 V; an 800 V-class architecture.
    ('electrical', 'Lucid LEAP',         'Lucid',               ARRAY['Lucid 900 V'],     800, NULL,          ARRAY[]::text[]),
    ('electrical', 'e-TNGA 400 V',       'Toyota',              ARRAY['e-TNGA'],          400, 'native',      ARRAY[]::text[]),
    ('electrical', 'SEA 400 V',          'Geely',               ARRAY[]::text[],          400, 'native',      ARRAY[]::text[]),
    ('electrical', 'SPA2 400 V',         'Volvo Cars',          ARRAY[]::text[],          400, 'native',      ARRAY[]::text[]),
    ('electrical', 'EVA2 400 V',         'Mercedes-Benz',       ARRAY['EVA2'],            400, 'native',      ARRAY[]::text[]),
    ('electrical', 'MMA 800 V',          'Mercedes-Benz',       ARRAY[]::text[],          800, NULL,          ARRAY[]::text[]),
    ('electrical', 'BMW Gen5 eDrive',    'BMW',                 ARRAY['Gen5'],            400, 'native',      ARRAY[]::text[]),
    ('electrical', 'BMW Gen6 eDrive',    'BMW',                 ARRAY['Gen6'],            800, NULL,          ARRAY[]::text[]),
    ('electrical', 'CMF-EV 400 V',       'Renault-Nissan-Mitsubishi', ARRAY['CMF-EV'],    400, 'native',      ARRAY[]::text[])
ON CONFLICT (kind, (lower(name))) DO NOTHING;

COMMIT;

-- The API caches the schema; without this a write naming a platform column is
-- refused until the cache refreshes (see migration 067).
NOTIFY pgrst, 'reload schema';

-- -- Verification ------------------------------------------------------------
--
-- The seed landed (expect 22 mechanical, 21 electrical on a fresh database):
--   SELECT kind, count(*) FROM platforms GROUP BY kind;
--
-- The trigger refuses a wrong-kind link (expect an error):
--   UPDATE vehicles SET mechanical_platform_id =
--     (SELECT id FROM platforms WHERE kind = 'electrical' LIMIT 1)
--   WHERE id = (SELECT id FROM vehicles LIMIT 1);
