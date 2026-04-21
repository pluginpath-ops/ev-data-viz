CREATE TABLE vehicle_performance (
    vehicle_id         bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    zero_to_60_mph_sec numeric,
    quarter_mile_sec   numeric,
    quarter_mile_mph   numeric,
    weight_lbs         numeric,
    updated_at         timestamptz DEFAULT now()
);

ALTER TABLE vehicle_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read vehicle_performance"
    ON vehicle_performance FOR SELECT USING (true);

CREATE POLICY "Contributors can insert vehicle_performance"
    ON vehicle_performance FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update vehicle_performance"
    ON vehicle_performance FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete vehicle_performance"
    ON vehicle_performance FOR DELETE
    USING (current_user_role() = 'admin');

-- Migrate existing data from JSONB
INSERT INTO vehicle_performance (vehicle_id, zero_to_60_mph_sec, weight_lbs)
SELECT
    id,
    (specs->'performance'->>'zero_to_60_mph_sec')::numeric,
    (specs->'dimensions'->>'weight_lbs')::numeric
FROM vehicles
WHERE specs IS NOT NULL
  AND (
    specs->'performance'->>'zero_to_60_mph_sec' IS NOT NULL OR
    specs->'dimensions'->>'weight_lbs' IS NOT NULL
  )
ON CONFLICT DO NOTHING;

-- Clear migrated fields from JSONB
UPDATE vehicles SET specs = specs #- '{performance,zero_to_60_mph_sec}'
    WHERE specs->'performance' ? 'zero_to_60_mph_sec';
UPDATE vehicles SET specs = specs #- '{performance,top_speed_mph}'
    WHERE specs->'performance' ? 'top_speed_mph';
UPDATE vehicles SET specs = specs #- '{performance,quarter_mile}'
    WHERE specs->'performance' ? 'quarter_mile';
UPDATE vehicles SET specs = specs #- '{dimensions,weight_lbs}'
    WHERE specs->'dimensions' ? 'weight_lbs';
