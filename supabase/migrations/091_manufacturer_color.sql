-- 091: a brand's default series color (#311)
--
-- A vehicle's color resolves: its own, its source's, then the BRAND'S, then the
-- palette. This is the brand's. Set in Admin > Brands; read at resolve time
-- (vehicleInheritance.js), never copied onto a vehicle, so changing it moves
-- every vehicle still relying on it and setting a vehicle's own color stops it
-- following.
--
-- NULLABLE: null means the brand has no default and the palette chooses, as it
-- does for a vehicle. No policy change -- the existing contributor UPDATE
-- policy on manufacturers covers the new column.
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN manufacturers.color IS
  'Default series color for the brand''s vehicles that have no color of their own. Null means the palette chooses. See #311.';

-- Starting colors, by name, only where none is set so a rerun never overwrites
-- a curator's choice. Where the logo has a hue it is the logo's, brightened to
-- read on the dark chart ground; where it does not (Mercedes, Audi, Volvo,
-- Toyota, Lexus, Subaru, Mazda, Mini, Rolls-Royce: silver, black or white) the
-- color is a JUDGMENT CALL, picked so the big fleets sit in different hues.
-- Tune in Admin > Brands; nothing here is load-bearing.
UPDATE manufacturers m SET color = c.color
FROM (VALUES
    ('Tesla',         '#e31937'),
    ('Rivian',        '#7fae6a'),
    ('BMW',           '#3b9bff'),
    ('Mercedes',      '#3fd4e8'),
    ('Ford',          '#2f5fd0'),
    ('Chevrolet',     '#d9a520'),
    ('Audi',          '#868c96'),
    ('Volvo',         '#7fa6c9'),
    ('Polestar',      '#e8630a'),
    ('Kia',           '#ff7a59'),
    ('Hyundai',       '#00a3e0'),
    ('Nissan',        '#6a7cf0'),
    ('Volkswagen',    '#c3cad2'),
    ('GMC',           '#b3282d'),
    ('Cadillac',      '#b784d6'),
    ('Lucid',         '#d8b48a'),
    ('Toyota',        '#eb0a1e'),
    ('Subaru',        '#2a6fdb'),
    ('Honda',         '#e4572e'),
    ('Acura',         '#a3123c'),
    ('Lexus',         '#c9b79c'),
    ('Porsche',       '#ff6fb5'),
    ('GENESIS',       '#b08d57'),
    ('Zeekr',         '#35c07a'),
    ('Vinfast',       '#3ddc84'),
    ('Bugatti Rimac', '#2fa7c9'),
    ('Dodge',         '#a23ccf'),
    ('Jeep',          '#4c8f3f'),
    ('Jaguar',        '#2f9e8f'),
    ('Maserati',      '#1d4ed8'),
    ('FIAT',          '#d94a4a'),
    ('Mazda',         '#b4233c'),
    ('Mini',          '#2e9a64'),
    ('Rolls-Royce',   '#7e57c2'),
    ('Fisker',        '#3dbb8a'),
    ('Lordstown',     '#6b8afd')
) AS c(name, color)
WHERE m.name = c.name AND m.color IS NULL;
