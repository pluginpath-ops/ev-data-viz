-- 086: charging tests come down a lineage; a battery revision stops them
--
-- Until now a variant's tests reached it only through spec_links rows written
-- once, by ＋ Variant (variantLinkPlan). A charging test added to an origin
-- after its variants existed never reached them, re-pointing a variant left its
-- links behind, and a variant made by bulk import (which sets only the pointer)
-- inherited no tests at all.
--
-- From here on a variant inherits its source's CHARGING tests the way it
-- inherits specs: at read time, through spec_source_vehicle_id, up the whole
-- chain (src/utils/lineageCharging.js). Range tests keep the link model: range
-- turns on wheels, trim and weight, which do change down a lineage.
--
-- Two columns say where that stops and how it scales:
--
--   battery_revision   true when this vehicle's pack differs from its source's
--                      in chemistry or construction — the 2024 Mach-E's new
--                      cells, a Standard Range Silverado under an RST. It takes
--                      no charging tests from its source or above; its own
--                      variants inherit from it as usual. Set on the edge, not
--                      the lineage: a cut, not a branch.
--
--   capacity_factor    this vehicle's pack against its source's, for a pack that
--                      is effectively the same but a different size (the reason
--                      the factor exists, migration 055). 1 unless a curator
--                      sets it: any other figure is a claim about the battery.
--                      Multiplies down the chain, so a variant of a ×1.1 variant
--                      reads the origin's tests at ×1.1 without saying so again.
--
-- A spec_links row naming a test the lineage already provides is now an
-- OVERRIDE of that one test (its factors, color, DEF, notes), not the reason it
-- shows. A null factor on it means "the lineage's", which is why the 1s are
-- cleared below. A link to a test outside the lineage is what it always was.
--
-- ── The audit ────────────────────────────────────────────────────────────────
-- Run once, when the columns arrive. Two kinds of variant are marked as a
-- battery revision so that nothing appears on them that was not there before
-- and might be wrong:
--
--   pack differs   its effective usable capacity (own, else nearest in its
--                  chain; else the battery column the same way) differs from
--                  its source's. On the 2026-10-19 backup: 50 vehicles,
--                  10 of them with charging tests above them today.
--   partly linked  it links some of its lineage's charging tests and not
--                  others, so a curator may have removed the rest. 1 vehicle.
--
-- A variant with NO links is not marked: almost all are bulk imports, which
-- never had links to remove, and inheriting is the point. On that backup 65
-- variants inherit charging tests after the audit, 57 of them for the first time.
-- The final SELECT lists what was marked, for a curator to review; one whose
-- pack is effectively the same can trade the revision for a capacity factor.
--
-- Also passed down now (delete_vehicle_passing_down, from 075): a deleted
-- source's battery revision, and its capacity factor multiplied into each
-- variant's, so what the variant reads is unchanged — the 075 header's "tests
-- cannot be passed down" still holds for the deleted vehicle's own tests.
--
-- Idempotent: the audit runs only on the application that adds the columns.

CREATE TEMP TABLE IF NOT EXISTS _086_report
    (id bigint, name text, year text, source text, source_year text, reason text);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'vehicles'
                 AND column_name = 'battery_revision') THEN
        RAISE NOTICE '086 already applied: columns exist, audit skipped';
        RETURN;
    END IF;

    ALTER TABLE public.vehicles
        ADD COLUMN battery_revision boolean NOT NULL DEFAULT false,
        ADD COLUMN capacity_factor  numeric NOT NULL DEFAULT 1
            CONSTRAINT vehicles_capacity_factor_positive CHECK (capacity_factor > 0);

    CREATE TEMP TABLE _086_marked (vehicle_id bigint PRIMARY KEY, reason text) ON COMMIT DROP;

    -- Pack differs: effective usable kWh where both sides have one, else the
    -- battery column, each resolved up the chain (cycle-guarded).
    WITH RECURSIVE up(id, anc, depth, path) AS (
        SELECT id, id, 0, ARRAY[id] FROM public.vehicles
        UNION ALL
        SELECT u.id, v.spec_source_vehicle_id, u.depth + 1, u.path || v.spec_source_vehicle_id
        FROM up u JOIN public.vehicles v ON v.id = u.anc
        WHERE v.spec_source_vehicle_id IS NOT NULL
          AND NOT v.spec_source_vehicle_id = ANY (u.path)
    ),
    eff AS (
        SELECT v.id,
            (SELECT NULLIF(a.specs -> 'charging' ->> 'battery_usable_kwh', '')::numeric
             FROM up u JOIN public.vehicles a ON a.id = u.anc
             WHERE u.id = v.id AND NULLIF(a.specs -> 'charging' ->> 'battery_usable_kwh', '') IS NOT NULL
             ORDER BY u.depth LIMIT 1) AS usable,
            (SELECT a.battery
             FROM up u JOIN public.vehicles a ON a.id = u.anc
             WHERE u.id = v.id AND a.battery IS NOT NULL
             ORDER BY u.depth LIMIT 1) AS batt
        FROM public.vehicles v
    )
    INSERT INTO _086_marked
    SELECT v.id, format('pack differs: %s kWh against %s kWh',
                        COALESCE(ev.usable, ev.batt), COALESCE(es.usable, es.batt))
    FROM public.vehicles v
    JOIN eff ev ON ev.id = v.id
    JOIN eff es ON es.id = v.spec_source_vehicle_id
    WHERE CASE
        WHEN ev.usable IS NOT NULL AND es.usable IS NOT NULL THEN ev.usable <> es.usable
        WHEN ev.batt   IS NOT NULL AND es.batt   IS NOT NULL THEN ev.batt   <> es.batt
        ELSE false
    END;

    -- Partly linked: some of the lineage's charging tests linked, others not.
    WITH RECURSIVE chain(vehicle_id, ancestor_id, path) AS (
        SELECT id, spec_source_vehicle_id, ARRAY[id]
        FROM public.vehicles WHERE spec_source_vehicle_id IS NOT NULL
        UNION ALL
        SELECT c.vehicle_id, v.spec_source_vehicle_id, c.path || c.ancestor_id
        FROM chain c JOIN public.vehicles v ON v.id = c.ancestor_id
        WHERE v.spec_source_vehicle_id IS NOT NULL
          AND NOT v.spec_source_vehicle_id = ANY (c.path || c.ancestor_id)
    ),
    lineage AS (
        SELECT c.vehicle_id, r.id AS run_id
        FROM chain c JOIN public.runs r ON r.vehicle_id = c.ancestor_id
        WHERE r.kind = 'charging' AND r.composite IS NULL
    ),
    linked AS (
        SELECT l.target_vehicle_id AS vehicle_id, l.source_run_id AS run_id
        FROM public.spec_links l
        JOIN lineage x ON x.vehicle_id = l.target_vehicle_id AND x.run_id = l.source_run_id
    )
    INSERT INTO _086_marked
    SELECT x.vehicle_id, format('partly linked: %s of %s lineage charging tests',
                                count(k.run_id), count(*))
    FROM lineage x
    LEFT JOIN linked k ON k.vehicle_id = x.vehicle_id AND k.run_id = x.run_id
    GROUP BY x.vehicle_id
    HAVING count(k.run_id) > 0 AND count(k.run_id) < count(*)
    ON CONFLICT (vehicle_id) DO UPDATE SET reason = _086_marked.reason || '; ' || EXCLUDED.reason;

    UPDATE public.vehicles v SET battery_revision = true
    FROM _086_marked m WHERE m.vehicle_id = v.id;

    -- A link's factor of exactly 1 on a test the lineage now provides would pin
    -- that test at ×1 against a capacity factor set later. Null reads as 1 and
    -- defers to the lineage, so this changes nothing on screen.
    WITH RECURSIVE chain(vehicle_id, ancestor_id, path) AS (
        SELECT id, spec_source_vehicle_id, ARRAY[id]
        FROM public.vehicles
        WHERE spec_source_vehicle_id IS NOT NULL AND NOT battery_revision
        UNION ALL
        SELECT c.vehicle_id, v.spec_source_vehicle_id, c.path || c.ancestor_id
        FROM chain c JOIN public.vehicles v ON v.id = c.ancestor_id
        WHERE v.spec_source_vehicle_id IS NOT NULL AND NOT v.battery_revision
          AND NOT v.spec_source_vehicle_id = ANY (c.path || c.ancestor_id)
    )
    UPDATE public.spec_links l SET capacity_factor = NULL
    FROM public.runs r, chain c
    WHERE r.id = l.source_run_id AND r.kind = 'charging' AND r.composite IS NULL
      AND c.vehicle_id = l.target_vehicle_id AND c.ancestor_id = r.vehicle_id
      AND l.capacity_factor = 1;

    INSERT INTO _086_report
    SELECT v.id, v.name, v.year, s.name AS source, s.year AS source_year, m.reason
    FROM _086_marked m
    JOIN public.vehicles v ON v.id = m.vehicle_id
    JOIN public.vehicles s ON s.id = v.spec_source_vehicle_id;
END $$;

COMMENT ON COLUMN public.vehicles.battery_revision IS
    'Pack differs from the source''s in chemistry or construction: takes no charging tests from its source or above (086). Its own variants inherit from it.';
COMMENT ON COLUMN public.vehicles.capacity_factor IS
    'This pack against the source''s, for one effectively the same but a different size. Scales inherited charging tests; multiplies down the chain (086).';

-- ── Pass down the two new fields ─────────────────────────────────────────────
-- 075's function, with battery_revision and capacity_factor passed to each
-- variant. A variant of a revision is itself a revision once re-pointed above
-- it (it carries the revised pack, passed down with the specs); otherwise the
-- two factors multiply, so it reads the tests above at the same scale as before.
CREATE OR REPLACE FUNCTION public.delete_vehicle_passing_down(p_vehicle_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    gone   public.vehicles%ROWTYPE;
    passed integer;
BEGIN
    SELECT * INTO gone FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    INSERT INTO public.vehicle_tags (vehicle_id, tag_id)
    SELECT c.id, vt.tag_id
    FROM public.vehicles c
    JOIN public.vehicle_tags vt ON vt.vehicle_id = gone.id
    WHERE c.spec_source_vehicle_id = gone.id
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_tags own WHERE own.vehicle_id = c.id);

    UPDATE public.vehicles c
    SET specs = CASE
            WHEN gone.specs IS NULL OR gone.specs = '{}'::jsonb THEN c.specs
            ELSE public.merge_spec_blobs(gone.specs, c.specs)
        END,
        color = COALESCE(NULLIF(c.color, ''), gone.color),
        image_url       = CASE WHEN c.image_url IS NULL AND c.image_thumb_url IS NULL
                                AND (gone.image_url IS NOT NULL OR gone.image_thumb_url IS NOT NULL)
                               THEN gone.image_url ELSE c.image_url END,
        image_thumb_url = CASE WHEN c.image_url IS NULL AND c.image_thumb_url IS NULL
                                AND (gone.image_url IS NOT NULL OR gone.image_thumb_url IS NOT NULL)
                               THEN gone.image_thumb_url ELSE c.image_thumb_url END,
        image_focal_y   = CASE WHEN c.image_url IS NULL AND c.image_thumb_url IS NULL
                                AND (gone.image_url IS NOT NULL OR gone.image_thumb_url IS NOT NULL)
                               THEN gone.image_focal_y ELSE c.image_focal_y END,
        mechanical_platform_id = COALESCE(c.mechanical_platform_id, gone.mechanical_platform_id),
        electrical_platform_id = COALESCE(c.electrical_platform_id, gone.electrical_platform_id),
        battery_revision = c.battery_revision OR gone.battery_revision,
        capacity_factor  = CASE WHEN c.battery_revision OR gone.battery_revision THEN c.capacity_factor
                                ELSE c.capacity_factor * gone.capacity_factor END,
        spec_source_vehicle_id = gone.spec_source_vehicle_id
    WHERE c.spec_source_vehicle_id = gone.id;
    GET DIAGNOSTICS passed = ROW_COUNT;

    DELETE FROM public.vehicles WHERE id = gone.id;
    RETURN passed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_vehicle_passing_down(bigint) TO authenticated;

-- What the audit marked (empty on a second application).
SELECT * FROM _086_report ORDER BY name;
