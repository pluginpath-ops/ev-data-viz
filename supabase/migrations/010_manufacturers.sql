-- Migration 010: Manufacturers as first-class entities
--
-- Creates a `manufacturers` table and adds a manufacturer_id FK to vehicles.
-- The existing `make` text column is kept for backwards compatibility
-- (search, sort, display still use it) and is kept in sync with
-- manufacturer.name by the application layer.

CREATE TABLE manufacturers (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text NOT NULL UNIQUE,
    country    text,
    logo_url   text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE manufacturers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read manufacturers"
    ON manufacturers FOR SELECT USING (true);

CREATE POLICY "Contributors can insert manufacturers"
    ON manufacturers FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update manufacturers"
    ON manufacturers FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete manufacturers"
    ON manufacturers FOR DELETE
    USING (current_user_role() = 'admin');

-- Add FK column to vehicles (nullable so migration is non-destructive)
ALTER TABLE vehicles
    ADD COLUMN manufacturer_id bigint REFERENCES manufacturers(id) ON DELETE SET NULL;

-- Backfill: create one manufacturer row per distinct make string, then wire up the FK
INSERT INTO manufacturers (name)
    SELECT DISTINCT make
    FROM vehicles
    WHERE make IS NOT NULL AND make != ''
    ON CONFLICT DO NOTHING;

UPDATE vehicles v
    SET manufacturer_id = (
        SELECT id FROM manufacturers m WHERE m.name = v.make
    )
    WHERE make IS NOT NULL AND make != '';
