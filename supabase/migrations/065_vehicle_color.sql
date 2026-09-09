-- 065: a vehicle owns its colour (#308)
--
-- Colour was a property of a RUN. That does not scale and never described what
-- anyone was actually looking for: with hundreds of vehicles carrying two to ten
-- tests each, curating a colour per test is a job nobody keeps up with, and the
-- thing a reader wants to recognise on a chart is the CAR, not one of its tests.
--
-- So the vehicle carries one colour, set by a curator -- typically the press-car
-- colour, which is chosen to stand out and which matches the vehicle's own
-- photo. Charts take it as the base and shade each of that vehicle's tests off
-- it, which is already how `seedPlot` draws a family; what was missing was
-- somewhere to keep the base.
--
-- NULLABLE, and null is not a missing value: it means "the palette chooses",
-- which is the right answer for a car nobody has curated and for a white, black
-- or silver one that has no colour worth borrowing. A default here would be a
-- lie -- every uncurated vehicle would claim the same colour as a decision.
--
-- runs.color is deliberately NOT dropped. Perhaps ten to twenty runs carry a
-- deliberately set colour, and dropping the column in the same change that stops
-- reading it leaves no way back if the vehicle-base look is wrong. The code stops
-- reading it and any surviving read is made loud instead; the column goes in a
-- later migration once nothing has lit up. spec_links.color is a second colour
-- column that rides on runs.color through DataService, and it is that later
-- migration's problem too.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN vehicles.color IS
  'Curated series colour, typically the press-car colour. Null means the palette chooses. Base for shading this vehicle''s tests -- see #308.';
