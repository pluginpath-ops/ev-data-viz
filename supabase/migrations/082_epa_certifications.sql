-- 082: EPA Certifications, one row per Test Group (#374 step 2, layer 2)
--
-- Additive. Nothing reads these tables yet; layer 3 switches the readers.
--
-- ── The model ───────────────────────────────────────────────────────────────
--
-- An EPA Certification is one filing for ONE model year, named by EPA's Test
-- Group (`RHYXV00.0301`; the first letter is the year). An EPA test vehicle
-- (migration 081) is the car in the lab, keyed by its Vehicle ID. The two are
-- many-to-many: 183 of the 459 corpus files name two or more Vehicle IDs, and
-- 157 Vehicle IDs appear in more than one year's Test Group, because a
-- carryover certification reuses the earlier year's test vehicle.
--
--   epa_certifications               one row per Test Group
--   epa_certification_test_vehicles  one row per test vehicle in a certification:
--                                    its carryover origin, and its Guide link
--   epa_covered_models               + certification_id: the models a
--                                    certificate covers belong to the certificate
--
-- The Guide link belongs on the link row, not on the certification: the Guide
-- lists one row per configuration, and when one Test Group covers two test
-- vehicles each matches different Guide rows.
--
-- ── Dates, as the certificate states them ───────────────────────────────────
--
-- Every CSI carries a Certificate Issue Date and a CSI Submission/Revision
-- timestamp (459 of 459 files), and a Certificate Revision Date when EPA
-- revised the certificate (16 of 459; "--" otherwise). In the UI a revised
-- certificate reads "Recertified" — the same Test Group filed again, changed or
-- not. The submission timestamp orders two filings of one Test Group exactly.
--
-- ── The backfill ────────────────────────────────────────────────────────────
--
-- Production holds one source file per test vehicle, so this seeds what the
-- database already knows; re-importing the CSI files adds the other years.
-- Measured on the 2026-10-08 backup: 475 certifications, 943 link rows, and
-- every one of the 324 Guide links kept.
--
--   1. A certification for the Test Group in each test vehicle's source_file
--      (a CSI PDF, not the .csv Test Car List)                    basis 'csi'
--   2. One for its stored Test Group where that differs from the file's
--      (64 records hold a mixed identity — #374)       'csi', or 'csv' if no PDF
--   3. One for a hand-made record whose Vehicle ID IS a Test Group  'manual'
--   4. Each Guide link moves to the link row whose certification has the Guide
--      row's own year and Test Group; else that year's row; else a certification
--      is made from the Guide row itself (85 links)                 'guide'
--   5. Skips (3) and covered models follow the source file's certification.
--
-- The year always comes from the Test Group's first letter, never from
-- model_year: 104 records' model_year disagrees with their own Test Group,
-- and all 1,175 Guide rows agree with the letter.
--
-- The test vehicle's own columns (fe_guide_row_id, the skip, test_group,
-- source_file, carryover_*) are left in place and still written: layer 3
-- switches the readers, and a later migration retires them.
--
-- Safe to run twice.

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.epa_certifications (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_group                 text    NOT NULL UNIQUE,
    model_year                 integer NOT NULL,
    certificate_issue_date     date,
    certificate_revision_date  date,
    csi_submitted_at           timestamp,
    source_file                text,
    superseded_source_file     text,
    basis                      text    NOT NULL DEFAULT 'csi'
                               CHECK (basis IN ('csi', 'csv', 'guide', 'manual')),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.epa_certifications IS
    'One EPA Certification: a filing for ONE model year, named by EPA''s Test Group (first letter = the year). Many-to-many with EPA test vehicles through epa_certification_test_vehicles (#374).';
COMMENT ON COLUMN public.epa_certifications.basis IS
    'How the row came to exist: csi (a CSI PDF), csv (the Test Car List), guide (made from a Fuel Economy Guide link, no file yet), manual (by hand). A later CSI import upgrades it to csi.';
COMMENT ON COLUMN public.epa_certifications.certificate_revision_date IS
    'The CSI''s Certificate Revision Date; null when never revised. Shown as "Recertified".';
COMMENT ON COLUMN public.epa_certifications.csi_submitted_at IS
    'The CSI Submission/Revision timestamp — orders two filings of one Test Group.';
COMMENT ON COLUMN public.epa_certifications.superseded_source_file IS
    'The earlier filing of this Test Group that a later one replaced, when both were imported.';

CREATE TABLE IF NOT EXISTS public.epa_certification_test_vehicles (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    certification_id      bigint NOT NULL REFERENCES public.epa_certifications(id) ON DELETE CASCADE,
    test_vehicle_id       text   NOT NULL REFERENCES public.epa_test_vehicles(test_vehicle_id) ON DELETE CASCADE,
    carryover_test_group  text,
    carryover_model_year  integer,
    fe_guide_row_id       bigint REFERENCES public.epa_fe_guide(id) ON DELETE SET NULL,
    fe_guide_skipped_at   timestamptz,
    fe_guide_skip_note    text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certification_id, test_vehicle_id)
);

COMMENT ON TABLE public.epa_certification_test_vehicles IS
    'An EPA test vehicle in one certification: the carryover origin it names there, and its Fuel Economy Guide link for that year (#374).';

CREATE INDEX IF NOT EXISTS idx_epa_certifications_year       ON public.epa_certifications (model_year);
CREATE INDEX IF NOT EXISTS idx_epa_cert_test_vehicles_vehicle ON public.epa_certification_test_vehicles (test_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_epa_cert_test_vehicles_fe_row  ON public.epa_certification_test_vehicles (fe_guide_row_id)
    WHERE fe_guide_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_epa_cert_test_vehicles_awaiting ON public.epa_certification_test_vehicles (id)
    WHERE fe_guide_row_id IS NULL AND fe_guide_skipped_at IS NULL;

-- Linking clears a skip, as it does on the test vehicle (058).
DROP TRIGGER IF EXISTS trg_clear_fe_skip_on_link ON public.epa_certification_test_vehicles;
CREATE TRIGGER trg_clear_fe_skip_on_link
    BEFORE UPDATE ON public.epa_certification_test_vehicles
    FOR EACH ROW EXECUTE FUNCTION public.clear_fe_skip_on_link();

-- ── Access: the epa_test_vehicles policies, verbatim ────────────────────────

ALTER TABLE public.epa_certifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epa_certification_test_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read epa_certifications"     ON public.epa_certifications;
DROP POLICY IF EXISTS "Curators insert epa_certifications" ON public.epa_certifications;
DROP POLICY IF EXISTS "Curators update epa_certifications" ON public.epa_certifications;
DROP POLICY IF EXISTS "Admins delete epa_certifications"   ON public.epa_certifications;
CREATE POLICY "Public read epa_certifications"     ON public.epa_certifications FOR SELECT USING (true);
CREATE POLICY "Curators insert epa_certifications" ON public.epa_certifications FOR INSERT
    WITH CHECK (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Curators update epa_certifications" ON public.epa_certifications FOR UPDATE
    USING (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Admins delete epa_certifications"   ON public.epa_certifications FOR DELETE
    USING (current_user_role() = 'admin');

DROP POLICY IF EXISTS "Public read epa_certification_test_vehicles"     ON public.epa_certification_test_vehicles;
DROP POLICY IF EXISTS "Curators insert epa_certification_test_vehicles" ON public.epa_certification_test_vehicles;
DROP POLICY IF EXISTS "Curators update epa_certification_test_vehicles" ON public.epa_certification_test_vehicles;
DROP POLICY IF EXISTS "Admins delete epa_certification_test_vehicles"   ON public.epa_certification_test_vehicles;
CREATE POLICY "Public read epa_certification_test_vehicles"     ON public.epa_certification_test_vehicles FOR SELECT USING (true);
CREATE POLICY "Curators insert epa_certification_test_vehicles" ON public.epa_certification_test_vehicles FOR INSERT
    WITH CHECK (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Curators update epa_certification_test_vehicles" ON public.epa_certification_test_vehicles FOR UPDATE
    USING (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Admins delete epa_certification_test_vehicles"   ON public.epa_certification_test_vehicles FOR DELETE
    USING (current_user_role() = 'admin');

-- Supabase's default privileges grant these; a database restored without them
-- (scripts/localdb.sh) needs the grant spelled out. Harmless where it exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.epa_certifications, public.epa_certification_test_vehicles
    TO anon, authenticated;

-- ── Covered models belong to the certificate ────────────────────────────────
--
-- A row is either the legacy per-test-vehicle copy (read until layer 3) or the
-- certificate's own, never both. The old unique constraint treated NULL as a
-- value (NULLS NOT DISTINCT), which would make every certificate-level row
-- collide with every other one, so it becomes one partial index per kind.

ALTER TABLE public.epa_covered_models
    ADD COLUMN IF NOT EXISTS certification_id bigint
        REFERENCES public.epa_certifications(id) ON DELETE CASCADE;
ALTER TABLE public.epa_covered_models ALTER COLUMN test_vehicle_id DROP NOT NULL;
ALTER TABLE public.epa_covered_models DROP CONSTRAINT IF EXISTS epa_covered_models_one_owner;
ALTER TABLE public.epa_covered_models ADD CONSTRAINT epa_covered_models_one_owner
    CHECK (num_nonnulls(test_vehicle_id, certification_id) = 1);
ALTER TABLE public.epa_covered_models DROP CONSTRAINT IF EXISTS epa_covered_models_unique_config;
CREATE UNIQUE INDEX IF NOT EXISTS epa_covered_models_unique_per_test_vehicle
    ON public.epa_covered_models (test_vehicle_id, carline_name, certification_region) NULLS NOT DISTINCT
    WHERE test_vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS epa_covered_models_unique_per_certification
    ON public.epa_covered_models (certification_id, carline_name, certification_region) NULLS NOT DISTINCT
    WHERE certification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_covered_models_certification
    ON public.epa_covered_models (certification_id) WHERE certification_id IS NOT NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────

-- The year a Test Group is for: its first letter, EPA's model-year code, which
-- skips I, O, Q, U and Z (A = 2010 … Y = 2030). Carryover Test Groups reach back
-- to 2018 (J) and 2019 (K) in the live data. The same table as
-- MODEL_YEAR_CODES in src/utils/epaCertifications.js.
CREATE OR REPLACE FUNCTION pg_temp.test_group_year(tg text) RETURNS integer
    LANGUAGE sql IMMUTABLE AS $$
    SELECT 2010 + nullif(position(upper(left(tg, 1)) IN 'ABCDEFGHJKLMNPRSTVWXY'), 0) - 1 $$;

-- A Test Group inside a file name: five letters, then 00.0xxx, or 0000xxx
-- (Nissan files `SNSXV0000TL2`). The same pattern as TEST_GROUP_PATTERN in
-- src/utils/epaCertifications.js.
CREATE OR REPLACE FUNCTION pg_temp.test_group_in(s text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT substring(s FROM '([A-Z]{5}(?:[0-9]{2}\.[0-9]|[0-9]{4})[0-9A-Z]{3})') $$;

CREATE TEMP TABLE certification_source ON COMMIT DROP AS
SELECT t.test_vehicle_id,
       CASE WHEN t.source_file ~* '\.csv$' THEN NULL ELSE pg_temp.test_group_in(t.source_file) END AS file_tg,
       t.source_file,
       t.test_group,
       t.carryover_test_group,
       t.carryover_model_year,
       t.fe_guide_row_id,
       t.fe_guide_skipped_at,
       t.fe_guide_skip_note
  FROM public.epa_test_vehicles t;

-- 1. From the file. Two records naming two filings of one Test Group keep the
--    later one (by EPA document id, the number the file name starts with).
INSERT INTO public.epa_certifications (test_group, model_year, source_file, basis)
SELECT DISTINCT ON (s.file_tg) s.file_tg, pg_temp.test_group_year(s.file_tg), s.source_file, 'csi'
  FROM certification_source s
 WHERE s.file_tg IS NOT NULL AND pg_temp.test_group_year(s.file_tg) IS NOT NULL
 ORDER BY s.file_tg, coalesce(substring(s.source_file FROM '^([0-9]+)_')::bigint, 0) DESC, s.source_file DESC
ON CONFLICT (test_group) DO NOTHING;

-- 2. From the stored Test Group, where it is not the file's.
INSERT INTO public.epa_certifications (test_group, model_year, basis)
SELECT DISTINCT ON (s.test_group) s.test_group, pg_temp.test_group_year(s.test_group),
       CASE WHEN s.file_tg IS NULL THEN 'csv' ELSE 'csi' END
  FROM certification_source s
 WHERE s.test_group IS NOT NULL AND s.test_group IS DISTINCT FROM s.file_tg
   AND pg_temp.test_group_year(s.test_group) IS NOT NULL
 ORDER BY s.test_group, (s.file_tg IS NULL)
ON CONFLICT (test_group) DO NOTHING;

-- 3. A hand-made record whose Vehicle ID is itself a Test Group.
INSERT INTO public.epa_certifications (test_group, model_year, basis)
SELECT s.test_vehicle_id, pg_temp.test_group_year(s.test_vehicle_id), 'manual'
  FROM certification_source s
 WHERE s.file_tg IS NULL AND s.test_group IS NULL
   AND pg_temp.test_group_in(s.test_vehicle_id) = s.test_vehicle_id
   AND pg_temp.test_group_year(s.test_vehicle_id) IS NOT NULL
ON CONFLICT (test_group) DO NOTHING;

-- Link rows for 1–3. The carryover origin the record states belongs to the
-- certification it states (its stored Test Group), else to the file's.
INSERT INTO public.epa_certification_test_vehicles
       (certification_id, test_vehicle_id, carryover_test_group, carryover_model_year)
SELECT c.id, s.test_vehicle_id,
       CASE WHEN c.test_group = coalesce(s.test_group, s.file_tg) THEN s.carryover_test_group END,
       CASE WHEN c.test_group = coalesce(s.test_group, s.file_tg) THEN s.carryover_model_year END
  FROM certification_source s
  JOIN public.epa_certifications c
    ON c.test_group IN (s.file_tg, s.test_group)
    OR (s.file_tg IS NULL AND s.test_group IS NULL AND c.test_group = s.test_vehicle_id)
ON CONFLICT (certification_id, test_vehicle_id) DO NOTHING;

-- 4. Guide links, by the Guide row's own year and Test Group.
--    a. the link row whose certification IS the Guide row's (year, Test Group)
UPDATE public.epa_certification_test_vehicles l
   SET fe_guide_row_id = s.fe_guide_row_id
  FROM certification_source s
  JOIN public.epa_fe_guide f ON f.id = s.fe_guide_row_id
  JOIN public.epa_certifications c ON c.test_group = f.smog_test_group AND c.model_year = f.model_year
 WHERE l.test_vehicle_id = s.test_vehicle_id AND l.certification_id = c.id
   AND l.fe_guide_row_id IS NULL;

--    b. else the link row of that year (the Guide carries a sibling Test Group)
UPDATE public.epa_certification_test_vehicles l
   SET fe_guide_row_id = pick.fe_guide_row_id
  FROM (
      SELECT DISTINCT ON (s.test_vehicle_id) s.test_vehicle_id, s.fe_guide_row_id, l2.id AS link_id
        FROM certification_source s
        JOIN public.epa_fe_guide f ON f.id = s.fe_guide_row_id
        JOIN public.epa_certification_test_vehicles l2 ON l2.test_vehicle_id = s.test_vehicle_id
        JOIN public.epa_certifications c ON c.id = l2.certification_id AND c.model_year = f.model_year
       WHERE NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles d
                          WHERE d.test_vehicle_id = s.test_vehicle_id AND d.fe_guide_row_id = s.fe_guide_row_id)
       ORDER BY s.test_vehicle_id, (c.test_group = s.test_group) DESC, c.id
  ) pick
 WHERE l.id = pick.link_id AND l.fe_guide_row_id IS NULL;

--    c. else a certification made from the Guide row: its year, its Test Group
INSERT INTO public.epa_certifications (test_group, model_year, basis)
SELECT DISTINCT f.smog_test_group, f.model_year, 'guide'
  FROM certification_source s
  JOIN public.epa_fe_guide f ON f.id = s.fe_guide_row_id
 WHERE f.smog_test_group IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles d
                    WHERE d.test_vehicle_id = s.test_vehicle_id AND d.fe_guide_row_id = s.fe_guide_row_id)
ON CONFLICT (test_group) DO NOTHING;

INSERT INTO public.epa_certification_test_vehicles (certification_id, test_vehicle_id, fe_guide_row_id)
SELECT c.id, s.test_vehicle_id, s.fe_guide_row_id
  FROM certification_source s
  JOIN public.epa_fe_guide f ON f.id = s.fe_guide_row_id
  JOIN public.epa_certifications c ON c.test_group = f.smog_test_group
 WHERE NOT EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles d
                    WHERE d.test_vehicle_id = s.test_vehicle_id AND d.fe_guide_row_id = s.fe_guide_row_id)
ON CONFLICT (certification_id, test_vehicle_id)
    DO UPDATE SET fe_guide_row_id = EXCLUDED.fe_guide_row_id
    WHERE epa_certification_test_vehicles.fe_guide_row_id IS NULL;

-- 5. Skips: a skip said "this record has no Guide row", so it holds for each of
--    the record's unlinked years.
UPDATE public.epa_certification_test_vehicles l
   SET fe_guide_skipped_at = s.fe_guide_skipped_at, fe_guide_skip_note = s.fe_guide_skip_note
  FROM certification_source s
 WHERE l.test_vehicle_id = s.test_vehicle_id
   AND s.fe_guide_skipped_at IS NOT NULL
   AND l.fe_guide_row_id IS NULL AND l.fe_guide_skipped_at IS NULL;

--    Covered models: the certificate's own copy, from a test vehicle imported
--    from the SAME filing the certification keeps — two filings of one Test
--    Group list different models (the Jaguar's second added two), and a union
--    of both lists would be neither certificate's.
INSERT INTO public.epa_covered_models
       (certification_id, carline_number, carline_name, division, certification_region,
        drive_system, transmission_type, gears)
SELECT DISTINCT ON (c.id, m.carline_name, m.certification_region)
       c.id, m.carline_number, m.carline_name, m.division, m.certification_region,
       m.drive_system, m.transmission_type, m.gears
  FROM public.epa_covered_models m
  JOIN certification_source s ON s.test_vehicle_id = m.test_vehicle_id
  JOIN public.epa_certifications c ON c.test_group = s.file_tg AND c.source_file = s.source_file
 WHERE m.test_vehicle_id IS NOT NULL
 ORDER BY c.id, m.carline_name, m.certification_region, m.id
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- On the 2026-10-08 backup: 475 certifications, 943 link rows.
--   SELECT basis, count(*) FROM epa_certifications GROUP BY 1;
--   SELECT count(*) FROM epa_certification_test_vehicles;
-- Every test vehicle has a certification (expect 0):
--   SELECT count(*) FROM epa_test_vehicles t WHERE NOT EXISTS
--     (SELECT 1 FROM epa_certification_test_vehicles l WHERE l.test_vehicle_id = t.test_vehicle_id);
-- Every Guide link kept (expect 0):
--   SELECT count(*) FROM epa_test_vehicles t WHERE t.fe_guide_row_id IS NOT NULL AND NOT EXISTS
--     (SELECT 1 FROM epa_certification_test_vehicles l
--       WHERE l.test_vehicle_id = t.test_vehicle_id AND l.fe_guide_row_id = t.fe_guide_row_id);
-- No certification year disagrees with its Test Group's letter (expect 0):
--   SELECT count(*) FROM epa_certifications WHERE model_year IS DISTINCT FROM
--     2010 + position(upper(left(test_group, 1)) IN 'ABCDEFGHJKLMNPRSTVWXY') - 1;
