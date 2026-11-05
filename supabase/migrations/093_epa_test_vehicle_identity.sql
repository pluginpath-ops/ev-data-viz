-- Migration 093: one record per EPA test vehicle, and the manufacturer's note
-- on each test.
--
-- 1. epa_tests.mfr_test_comments — "Manufacturer Test Comments", the free text
--    inside each test's block. The parser never read it. Across the 2021–2027
--    corpus 2,310 of 2,377 tests carry one, most stating energy (per-cycle DC
--    Wh/mi, usable battery energy) or the wheel and weight the test used. Of the
--    336 files with no DC energy in the structured fields, 172 state it here.
--
-- 2. Duplicates. The importer keys a test vehicle by its bare Vehicle ID unless
--    the ID repeats in that PDF, when it adds `-<config>`. A carryover filing
--    that lists one configuration therefore wrote `1SMV5028` for the vehicle the
--    original filing stored as `1SMV5028-0`: one test, two records, each
--    with its own links. The import now adopts the stored record when a test is
--    already stored (src/utils/epaTestVehicleIdentity.js). This migration gives
--    the records already split a way back together:
--
--      epa_test_vehicle_duplicates   pairs that share a test — by EPA test
--                                    number, or a renumbered test (same
--                                    procedure, date, CD range and AC energy) —
--                                    and Test Car List twins (`RMA00015` with
--                                    no tests, `RMA00015-0` with them), with
--                                    the record to keep and any conflicts
--      merge_epa_test_vehicles(keep, drop)
--                                    moves everything onto `keep`, fills its
--                                    blanks from `drop`, deletes `drop`
--
--    Run once, after review, as an admin in the SQL editor:
--
--      SELECT keep_id, drop_id, conflicts FROM epa_test_vehicle_duplicates;
--      SELECT merge_epa_test_vehicles(keep_id, drop_id)
--        FROM epa_test_vehicle_duplicates WHERE conflicts = '{}';
--
--    A pair with conflicts is the curator's: the two records disagree about a
--    Guide link or a value someone set by hand, and the function will not pick
--    one silently (pass force => true to keep `keep`'s and drop the other).
--
-- Plan: docs/epa-identity-and-guide-basis.md. Idempotent: safe to apply twice.

ALTER TABLE public.epa_tests ADD COLUMN IF NOT EXISTS mfr_test_comments text;
COMMENT ON COLUMN public.epa_tests.mfr_test_comments IS
    'Manufacturer Test Comments: the free text inside this test''s block of the CSI, '
    'verbatim. Not the test vehicle''s note (mfr_test_vehicle_comments), which sits above it.';

-- ── Same test? ─────────────────────────────────────────────────────────────────
-- A test number never belongs to two different cars (0 conflicts in 718 files),
-- but EPA renumbers a test when it is filed again — Polestar's MY2027 filing
-- moved every test from Volvo's code to Polestar's. The fingerprint finds those:
-- procedure, date, and the two figures a test cannot share by accident.
-- Both must be real: Zoox filed 999 for its range and nothing for its energy in
-- two years' certifications under two Vehicle IDs, and a fingerprint of
-- placeholders matched them.
CREATE OR REPLACE FUNCTION public.epa_test_fingerprint(t public.epa_tests)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN t.test_date IS NULL OR t.procedure_code IS NULL
          OR COALESCE(t.cd_range_combined_calc, 0) <= 0 OR COALESCE(t.ac_recharge_kwh, 0) <= 0
        THEN NULL
        ELSE concat_ws('|', t.procedure_code, t.test_date,
                       round(t.cd_range_combined_calc::numeric, 1),
                       round(t.ac_recharge_kwh::numeric, 2))
    END
$$;

-- ── What would be lost ────────────────────────────────────────────────────────
-- Held values are the ones a person chose: an `overrides` tag whose source is
-- not a machine ingest (pdf, csv, j1634) — the rule epaImportMerge.js isHeld
-- applies. Two records holding different values for one field, or linking one
-- certification to different Guide rows, cannot be merged without choosing.
CREATE OR REPLACE FUNCTION public.epa_test_vehicle_merge_conflicts(p_keep text, p_drop text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    k  jsonb;
    d  jsonb;
    f  text;
    out text[] := '{}';
BEGIN
    SELECT to_jsonb(t) INTO k FROM public.epa_test_vehicles t WHERE test_vehicle_id = p_keep;
    SELECT to_jsonb(t) INTO d FROM public.epa_test_vehicles t WHERE test_vehicle_id = p_drop;
    IF k IS NULL OR d IS NULL THEN
        RETURN ARRAY['missing record'];
    END IF;

    FOR f IN SELECT jsonb_object_keys(COALESCE(d -> 'overrides', '{}'::jsonb)) LOOP
        IF COALESCE(d #>> ARRAY['overrides', f, 'source'], 'pdf') NOT IN ('pdf', 'csv', 'j1634')
           AND d -> f IS NOT NULL AND d -> f <> 'null'::jsonb
           AND k -> f IS NOT NULL AND k -> f <> 'null'::jsonb
           AND k -> f <> d -> f THEN
            out := out || format('held %s: %s kept, %s dropped', f, k ->> f, d ->> f);
        END IF;
    END LOOP;

    out := out || ARRAY(
        SELECT format('certification %s: Guide row %s kept, %s dropped',
                      c.test_group, lk.fe_guide_row_id, ld.fe_guide_row_id)
          FROM public.epa_certification_test_vehicles lk
          JOIN public.epa_certification_test_vehicles ld
            ON ld.certification_id = lk.certification_id
          JOIN public.epa_certifications c ON c.id = lk.certification_id
         WHERE lk.test_vehicle_id = p_keep AND ld.test_vehicle_id = p_drop
           AND lk.fe_guide_row_id IS NOT NULL AND ld.fe_guide_row_id IS NOT NULL
           AND lk.fe_guide_row_id <> ld.fe_guide_row_id);
    RETURN out;
END;
$$;

-- ── The pairs ─────────────────────────────────────────────────────────────────
-- Which to keep: the record people have worked on (vehicle mappings, audit
-- history, Guide links), then the one with more tests, then the bare ID — the
-- shorter key, which is EPA's own Vehicle ID rather than one we suffixed.
CREATE OR REPLACE VIEW public.epa_test_vehicle_duplicates AS
WITH fingerprinted AS (
    SELECT t.test_vehicle_id, t.test_number, public.epa_test_fingerprint(t) AS fp
      FROM public.epa_tests t
),
-- Two equality joins, not one join on "same number OR same fingerprint": an OR
-- leaves Postgres a nested loop that fingerprints every pair of tests (~2.5M
-- calls, past the SQL editor's timeout on production). Each half hashes.
shared AS (
    SELECT DISTINCT LEAST(a.test_vehicle_id, b.test_vehicle_id)    AS a_id,
                    GREATEST(a.test_vehicle_id, b.test_vehicle_id) AS b_id,
                    CASE WHEN a.test_number = b.test_number THEN 'test number' ELSE 'renumbered test' END AS via
      FROM fingerprinted a
      JOIN fingerprinted b ON a.test_vehicle_id <> b.test_vehicle_id AND a.test_number = b.test_number
    UNION
    SELECT LEAST(a.test_vehicle_id, b.test_vehicle_id),
           GREATEST(a.test_vehicle_id, b.test_vehicle_id),
           CASE WHEN a.test_number = b.test_number THEN 'test number' ELSE 'renumbered test' END
      FROM fingerprinted a
      JOIN fingerprinted b ON a.test_vehicle_id <> b.test_vehicle_id AND a.fp = b.fp
),
-- The Test Car List writes a configuration under its bare Vehicle ID, with no
-- tests; a CSI file listing several configurations wrote the same car as
-- `<ID>-<config>`, with them. No test to share, so they pair on the key, the
-- configuration number, and a carline and test weight that agree (the rule
-- epaTestVehicleIdentity.js testCarListTwin applies on import).
twins AS (
    SELECT LEAST(b.test_vehicle_id, c.test_vehicle_id)    AS a_id,
           GREATEST(b.test_vehicle_id, c.test_vehicle_id) AS b_id,
           'Test Car List twin' AS via
      FROM public.epa_test_vehicles b
      JOIN public.epa_test_vehicles c
        ON c.test_vehicle_id = b.test_vehicle_id || '-' || COALESCE(NULLIF(b.vehicle_config_number, ''), '0')
       AND COALESCE(NULLIF(c.vehicle_config_number, ''), '0') = COALESCE(NULLIF(b.vehicle_config_number, ''), '0')
     WHERE NOT EXISTS (SELECT 1 FROM public.epa_tests t WHERE t.test_vehicle_id = b.test_vehicle_id)
       AND (b.epa_carline_name IS NULL OR c.epa_carline_name IS NULL
            OR left(upper(regexp_replace(b.epa_carline_name, '[^A-Za-z0-9]', '', 'g')), 8)
             = left(upper(regexp_replace(c.epa_carline_name, '[^A-Za-z0-9]', '', 'g')), 8))
       AND NOT EXISTS (
            SELECT 1 FROM public.epa_coefficient_sets sb, public.epa_coefficient_sets sc
             WHERE sb.test_vehicle_id = b.test_vehicle_id AND sb.is_primary
               AND sc.test_vehicle_id = c.test_vehicle_id AND sc.is_primary
               AND abs(sb.equiv_test_weight_lbs - sc.equiv_test_weight_lbs)
                   > 0.25 * least(sb.equiv_test_weight_lbs, sc.equiv_test_weight_lbs))
),
pairs AS (
    SELECT a_id, b_id, string_agg(DISTINCT via, ', ') AS via
      FROM (SELECT * FROM shared UNION ALL SELECT * FROM twins) s
     GROUP BY a_id, b_id
),
weight AS (
    SELECT tv.test_vehicle_id AS id,
           (SELECT count(*) FROM public.epa_vehicle_mappings m WHERE m.test_vehicle_id = tv.test_vehicle_id) * 100
         + (SELECT count(*) FROM public.epa_field_audit a WHERE a.test_vehicle_id = tv.test_vehicle_id) * 10
         + (SELECT count(*) FROM public.epa_certification_test_vehicles l
             WHERE l.test_vehicle_id = tv.test_vehicle_id AND l.fe_guide_row_id IS NOT NULL) * 10
         + (SELECT count(*) FROM public.epa_tests t WHERE t.test_vehicle_id = tv.test_vehicle_id) AS score
      FROM public.epa_test_vehicles tv
),
ranked AS (
    SELECT p.*,
           CASE WHEN (wa.score, -length(p.a_id)) >= (wb.score, -length(p.b_id)) THEN p.a_id ELSE p.b_id END AS keep_id
      FROM pairs p
      JOIN weight wa ON wa.id = p.a_id
      JOIN weight wb ON wb.id = p.b_id
)
SELECT keep_id,
       CASE WHEN keep_id = a_id THEN b_id ELSE a_id END AS drop_id,
       via,
       public.epa_test_vehicle_merge_conflicts(keep_id, CASE WHEN keep_id = a_id THEN b_id ELSE a_id END) AS conflicts
  FROM ranked;

COMMENT ON VIEW public.epa_test_vehicle_duplicates IS
    'EPA test vehicle records that share a test (test number, or a renumbered test), '
    'with the record to keep. Feed conflict-free rows to merge_epa_test_vehicles (migration 093).';

-- ── The merge ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_epa_test_vehicles(p_keep text, p_drop text, force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    conflicts text[];
    kj        jsonb;
    dj        jsonb;
    fill      jsonb;
    tags      jsonb;
    f         text;
    dt        public.epa_tests%ROWTYPE;
    kt_id     bigint;
    n_tests_moved   int := 0;
    n_tests_dropped int := 0;
BEGIN
    IF p_keep = p_drop THEN
        RAISE EXCEPTION 'merge_epa_test_vehicles: keep and drop are the same record (%)', p_keep;
    END IF;
    conflicts := public.epa_test_vehicle_merge_conflicts(p_keep, p_drop);
    IF conflicts = ARRAY['missing record'] THEN
        RAISE EXCEPTION 'merge_epa_test_vehicles: % or % does not exist', p_keep, p_drop;
    END IF;
    IF array_length(conflicts, 1) > 0 AND NOT force THEN
        RAISE EXCEPTION 'merge_epa_test_vehicles(%, %): %', p_keep, p_drop, array_to_string(conflicts, '; ');
    END IF;

    -- Tests. The same test on both sides stays as keep's copy; its phases go
    -- with the dropped copy, and audit rows that named the dropped copy (or its
    -- phases) are pointed at keep's. A test keep lacks moves across whole.
    FOR dt IN SELECT * FROM public.epa_tests WHERE test_vehicle_id = p_drop LOOP
        SELECT k.id INTO kt_id
          FROM public.epa_tests k
         WHERE k.test_vehicle_id = p_keep
           AND (k.test_number = dt.test_number
                OR public.epa_test_fingerprint(k) = public.epa_test_fingerprint(dt))
         ORDER BY (k.test_number = dt.test_number) DESC
         LIMIT 1;
        IF kt_id IS NULL THEN
            UPDATE public.epa_tests SET test_vehicle_id = p_keep WHERE id = dt.id;
            n_tests_moved := n_tests_moved + 1;
        ELSE
            -- Keep's copy may lack what the dropped one has (the note, DC energy
            -- the newer filing added): fill its blanks first.
            UPDATE public.epa_tests k SET
                mfr_test_comments         = COALESCE(k.mfr_test_comments, dt.mfr_test_comments),
                mfr_test_vehicle_comments = COALESCE(k.mfr_test_vehicle_comments, dt.mfr_test_vehicle_comments),
                total_dc_energy_kwh       = COALESCE(k.total_dc_energy_kwh, dt.total_dc_energy_kwh),
                total_distance_mi         = COALESCE(k.total_distance_mi, dt.total_distance_mi),
                cd_range_hwy_calc         = COALESCE(k.cd_range_hwy_calc, dt.cd_range_hwy_calc)
             WHERE k.id = kt_id;
            UPDATE public.epa_field_audit SET row_id = kt_id::text
             WHERE table_name = 'epa_tests' AND row_id = dt.id::text;
            UPDATE public.epa_field_audit a SET row_id = kp.id::text
              FROM public.epa_test_phases dp
              JOIN public.epa_test_phases kp ON kp.test_id = kt_id AND kp.phase_index = dp.phase_index
             WHERE dp.test_id = dt.id
               AND a.table_name = 'epa_test_phases' AND a.row_id = dp.id::text;
            DELETE FROM public.epa_tests WHERE id = dt.id;   -- phases cascade
            n_tests_dropped := n_tests_dropped + 1;
        END IF;
    END LOOP;

    -- Coefficient sets: one per category; keep's stands.
    UPDATE public.epa_field_audit a SET row_id = kc.id::text
      FROM public.epa_coefficient_sets dc
      JOIN public.epa_coefficient_sets kc ON kc.test_vehicle_id = p_keep AND kc.category = dc.category
     WHERE dc.test_vehicle_id = p_drop
       AND a.table_name = 'epa_coefficient_sets' AND a.row_id = dc.id::text;
    DELETE FROM public.epa_coefficient_sets dc
     WHERE dc.test_vehicle_id = p_drop
       AND EXISTS (SELECT 1 FROM public.epa_coefficient_sets kc
                    WHERE kc.test_vehicle_id = p_keep AND kc.category = dc.category);
    -- A moved set cannot also be primary if keep already has one.
    UPDATE public.epa_coefficient_sets SET is_primary = false
     WHERE test_vehicle_id = p_drop
       AND EXISTS (SELECT 1 FROM public.epa_coefficient_sets
                    WHERE test_vehicle_id = p_keep AND is_primary);
    UPDATE public.epa_coefficient_sets SET test_vehicle_id = p_keep WHERE test_vehicle_id = p_drop;

    -- Covered models still owned by the test vehicle (pre-082 rows).
    DELETE FROM public.epa_covered_models dm
     WHERE dm.test_vehicle_id = p_drop
       AND EXISTS (SELECT 1 FROM public.epa_covered_models km
                    WHERE km.test_vehicle_id = p_keep
                      AND km.carline_name = dm.carline_name
                      AND km.certification_region IS NOT DISTINCT FROM dm.certification_region);
    UPDATE public.epa_covered_models SET test_vehicle_id = p_keep WHERE test_vehicle_id = p_drop;

    -- Certification links: one per certification. Where both have one, keep's
    -- takes the dropped one's Guide link, skip and carryover where it has none.
    UPDATE public.epa_certification_test_vehicles k SET
        fe_guide_row_id      = COALESCE(k.fe_guide_row_id, d.fe_guide_row_id),
        fe_guide_skipped_at  = CASE WHEN k.fe_guide_row_id IS NULL AND d.fe_guide_row_id IS NULL
                                    THEN COALESCE(k.fe_guide_skipped_at, d.fe_guide_skipped_at) END,
        fe_guide_skip_note   = CASE WHEN k.fe_guide_row_id IS NULL AND d.fe_guide_row_id IS NULL
                                    THEN COALESCE(k.fe_guide_skip_note, d.fe_guide_skip_note) END,
        carryover_test_group = COALESCE(k.carryover_test_group, d.carryover_test_group),
        carryover_model_year = COALESCE(k.carryover_model_year, d.carryover_model_year)
      FROM public.epa_certification_test_vehicles d
     WHERE k.test_vehicle_id = p_keep AND d.test_vehicle_id = p_drop
       AND d.certification_id = k.certification_id;
    DELETE FROM public.epa_certification_test_vehicles d
     WHERE d.test_vehicle_id = p_drop
       AND EXISTS (SELECT 1 FROM public.epa_certification_test_vehicles k
                    WHERE k.test_vehicle_id = p_keep AND k.certification_id = d.certification_id);
    UPDATE public.epa_certification_test_vehicles SET test_vehicle_id = p_keep WHERE test_vehicle_id = p_drop;

    -- Vehicle mappings: one per vehicle. A vehicle linked to both keeps one
    -- link, primary if either was.
    UPDATE public.epa_vehicle_mappings k SET is_primary = true
      FROM public.epa_vehicle_mappings d
     WHERE k.test_vehicle_id = p_keep AND d.test_vehicle_id = p_drop
       AND d.vehicle_id = k.vehicle_id AND d.is_primary AND NOT k.is_primary;
    DELETE FROM public.epa_vehicle_mappings d
     WHERE d.test_vehicle_id = p_drop
       AND EXISTS (SELECT 1 FROM public.epa_vehicle_mappings k
                    WHERE k.test_vehicle_id = p_keep AND k.vehicle_id = d.vehicle_id);
    UPDATE public.epa_vehicle_mappings SET test_vehicle_id = p_keep WHERE test_vehicle_id = p_drop;

    -- The audit trail follows the record.
    UPDATE public.epa_field_audit SET test_vehicle_id = p_keep WHERE test_vehicle_id = p_drop;

    -- Keep's blanks from drop, with drop's tags for exactly those fields — the
    -- "older file fills blanks" rule (#412), applied record to record.
    SELECT to_jsonb(t) INTO kj FROM public.epa_test_vehicles t WHERE test_vehicle_id = p_keep;
    SELECT to_jsonb(t) INTO dj FROM public.epa_test_vehicles t WHERE test_vehicle_id = p_drop;
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO fill
      FROM jsonb_each(dj)
     WHERE value <> 'null'::jsonb
       AND (kj -> key IS NULL OR kj -> key = 'null'::jsonb)
       AND key NOT IN ('test_vehicle_id', 'overrides', 'created_at', 'ingested_at');
    FOR f IN SELECT jsonb_object_keys(fill) LOOP
        EXECUTE format(
            'UPDATE public.epa_test_vehicles t SET %I = (jsonb_populate_record(t, $1)).%I WHERE test_vehicle_id = $2',
            f, f) USING fill, p_keep;
    END LOOP;
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO tags
      FROM jsonb_each(COALESCE(dj -> 'overrides', '{}'::jsonb))
     WHERE fill ? key;
    UPDATE public.epa_test_vehicles
       SET overrides = tags || COALESCE(overrides, '{}'::jsonb)
     WHERE test_vehicle_id = p_keep;

    DELETE FROM public.epa_test_vehicles WHERE test_vehicle_id = p_drop;

    RETURN jsonb_build_object(
        'kept', p_keep, 'dropped', p_drop,
        'tests_moved', n_tests_moved, 'tests_merged', n_tests_dropped,
        'fields_filled', (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(fill) k),
        'forced_over', to_jsonb(conflicts));
END;
$$;

COMMENT ON FUNCTION public.merge_epa_test_vehicles(text, text, boolean) IS
    'Merge two EPA test vehicle records that are one car: tests, coefficients, links, mappings '
    'and audit move to p_keep, its blanks fill from p_drop, p_drop is deleted. Refuses on '
    'conflicts unless force (migration 093).';

GRANT SELECT ON public.epa_test_vehicle_duplicates TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_epa_test_vehicles(text, text, boolean) TO authenticated;
