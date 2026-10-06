-- Migration 075: deleting a vehicle that others inherit from passes its own
-- values down instead of orphaning them.
--
-- A variant shows its source's specs, color, photo and tags until it sets its
-- own. `spec_source_vehicle_id` was ON DELETE SET NULL, so deleting a source in
-- the MIDDLE of a chain cut every variant below it off from the source AND
-- everything above it: a variant correcting an old figure showed the old one
-- again, or nothing.
--
-- delete_vehicle_passing_down() copies the source's own values onto each of
-- its variants wherever the variant has none of its own, re-points the variant
-- at the source's source, and only then deletes. Both layers a variant reads
-- are unchanged, so what it shows is identical before and after. src/utils/
-- vehicleDeletion.js is the client mirror, and the reference this is held to.
--
-- The foreign key becomes NO ACTION (it fails loudly) so a delete that skips the
-- function, from the SQL editor or a script, cannot silently orphan a chain.
-- NO ACTION and not RESTRICT: it is checked when the statement ends, so one
-- DELETE of a whole chain, or the cascade from a deleted account, still works.
--
-- Not passed down, and cannot be: the deleted vehicle's tests. They are its own
-- runs, and a variant reads them through spec_links, which go with the run.
--
-- Idempotent: safe to apply twice.

-- ── Spec blobs ────────────────────────────────────────────────────────────────
-- `over` laid on `under`, a category at a time: a field `over` has set wins, one
-- it leaves null or '' shows `under`'s (false and 0 are values). Custom fields
-- merge by key, over winning. The rule mergeInheritedSpecs applies on read.
CREATE OR REPLACE FUNCTION public.merge_spec_blobs(under jsonb, over jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    result jsonb := '{}'::jsonb;
    cat    text;
    lower_ jsonb;
    upper_ jsonb;
    fields jsonb;
    fld    text;
    val    jsonb;
BEGIN
    FOR cat IN
        SELECT jsonb_object_keys(COALESCE(under, '{}'::jsonb) || COALESCE(over, '{}'::jsonb))
    LOOP
        lower_ := COALESCE(under -> cat, '{}'::jsonb);
        upper_ := COALESCE(over  -> cat, '{}'::jsonb);
        IF jsonb_typeof(lower_) <> 'object' THEN lower_ := '{}'::jsonb; END IF;
        IF jsonb_typeof(upper_) <> 'object' THEN upper_ := '{}'::jsonb; END IF;

        fields := lower_ - '_custom';
        FOR fld, val IN SELECT key, value FROM jsonb_each(upper_ - '_custom') LOOP
            IF val <> 'null'::jsonb AND val <> '""'::jsonb THEN
                fields := fields || jsonb_build_object(fld, val);
            END IF;
        END LOOP;

        fields := fields || jsonb_build_object(
            '_custom',
            COALESCE(NULLIF(lower_ -> '_custom', 'null'::jsonb), '{}'::jsonb)
            || COALESCE(NULLIF(upper_ -> '_custom', 'null'::jsonb), '{}'::jsonb)
        );
        result := result || jsonb_build_object(cat, fields);
    END LOOP;
    RETURN result;
END;
$$;

-- ── The delete ────────────────────────────────────────────────────────────────
-- Returns how many variants were passed values. SECURITY INVOKER: the caller's
-- own row-level policies decide whether it may update the variants and delete
-- the vehicle, exactly as the plain DELETE did.
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

    -- Tags are one set, overridden whole: a variant with any of its own keeps
    -- only those, and one with none takes the source's.
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
        -- image_url, image_thumb_url and image_focal_y are one unit: the focal
        -- point frames one particular picture.
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
        spec_source_vehicle_id = gone.spec_source_vehicle_id
    WHERE c.spec_source_vehicle_id = gone.id;
    GET DIAGNOSTICS passed = ROW_COUNT;

    DELETE FROM public.vehicles WHERE id = gone.id;
    RETURN passed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_vehicle_passing_down(bigint) TO authenticated;

-- ── The foreign key ───────────────────────────────────────────────────────────
ALTER TABLE public.vehicles
    DROP CONSTRAINT IF EXISTS vehicles_spec_source_vehicle_id_fkey;
ALTER TABLE public.vehicles
    ADD CONSTRAINT vehicles_spec_source_vehicle_id_fkey
        FOREIGN KEY (spec_source_vehicle_id) REFERENCES public.vehicles(id);
