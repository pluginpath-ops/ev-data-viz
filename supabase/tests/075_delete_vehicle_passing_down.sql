-- Checks for migration 075. Run on a restored local DB, never on production:
--   scripts/localdb.sh migrate 075
--   psql ... -f supabase/tests/075_delete_vehicle_passing_down.sql
-- Everything happens in one transaction that is rolled back, and a failed check
-- raises, so a clean run prints only the NOTICEs.
BEGIN;

DO $$
DECLARE
    uid uuid := '00000000-0000-4000-a000-000000000001';
    ta bigint; tb bigint; tc bigint;
    a bigint; b bigint; c bigint; d bigint; e bigint;
    r record;
    passed integer;
BEGIN
    INSERT INTO tags (name) VALUES ('t-a') RETURNING id INTO ta;
    INSERT INTO tags (name) VALUES ('t-b') RETURNING id INTO tb;
    INSERT INTO tags (name) VALUES ('t-c') RETURNING id INTO tc;

    -- a -> b -> c, and b -> d. e stands alone.
    INSERT INTO vehicles (user_id, name, color, specs)
    VALUES (uid, 'A', '#111111',
            '{"powertrain":{"motors":2,"drive_type":"AWD"},"charging":{"max_dc_kw":250}}')
    RETURNING id INTO a;
    INSERT INTO vehicle_tags VALUES (a, ta);

    INSERT INTO vehicles (user_id, name, spec_source_vehicle_id, color, image_url, image_thumb_url, image_focal_y, specs)
    VALUES (uid, 'B', a, '#222222', 'b.jpg', 'bt.jpg', 40,
            '{"powertrain":{"motors":1,"horsepower_hp":300},"charging":{"max_dc_kw":300,"v2l":false},"pricing":{"_custom":{"x":1}}}')
    RETURNING id INTO b;
    INSERT INTO vehicle_tags VALUES (b, tb);

    INSERT INTO vehicles (user_id, name, spec_source_vehicle_id, specs)
    VALUES (uid, 'C', b, '{"powertrain":{"motors":null,"torque_lbft":400},"charging":{"v2l":true}}')
    RETURNING id INTO c;

    INSERT INTO vehicles (user_id, name, spec_source_vehicle_id, color, image_url, image_thumb_url, specs)
    VALUES (uid, 'D', b, '#444444', 'd.jpg', 'dt.jpg', '{"powertrain":{"horsepower_hp":350}}')
    RETURNING id INTO d;
    INSERT INTO vehicle_tags VALUES (d, tc);

    INSERT INTO vehicles (user_id, name) VALUES (uid, 'E') RETURNING id INTO e;

    -- A plain DELETE of a source must now fail, not orphan its variants.
    BEGIN
        DELETE FROM vehicles WHERE id = b;
        RAISE EXCEPTION 'a plain DELETE of a source should have failed';
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'ok: plain DELETE of a source is refused';
    END;

    passed := delete_vehicle_passing_down(b);
    IF passed <> 2 THEN RAISE EXCEPTION 'expected 2 variants passed values, got %', passed; END IF;
    IF EXISTS (SELECT 1 FROM vehicles WHERE id = b) THEN RAISE EXCEPTION 'B was not deleted'; END IF;

    -- C had nothing of its own for these: it now carries B's, and points at A.
    SELECT * INTO r FROM vehicles WHERE id = c;
    IF r.spec_source_vehicle_id <> a THEN RAISE EXCEPTION 'C should now inherit from A'; END IF;
    IF r.specs #>> '{powertrain,motors}' <> '1' THEN RAISE EXCEPTION 'C motors should come from B (own was null): %', r.specs; END IF;
    IF r.specs #>> '{powertrain,horsepower_hp}' <> '300' THEN RAISE EXCEPTION 'C hp should come from B'; END IF;
    IF r.specs #>> '{powertrain,torque_lbft}' <> '400' THEN RAISE EXCEPTION 'C keeps its own torque'; END IF;
    IF r.specs #>> '{charging,max_dc_kw}' <> '300' THEN RAISE EXCEPTION 'C dc should come from B, not A'; END IF;
    IF r.specs #>> '{charging,v2l}' <> 'true' THEN RAISE EXCEPTION 'C keeps its own v2l=true over B''s false'; END IF;
    IF r.specs #>> '{pricing,_custom,x}' <> '1' THEN RAISE EXCEPTION 'C custom field from B lost'; END IF;
    IF r.color <> '#222222' THEN RAISE EXCEPTION 'C color should come from B'; END IF;
    IF r.image_url <> 'b.jpg' OR r.image_thumb_url <> 'bt.jpg' OR r.image_focal_y <> 40 THEN
        RAISE EXCEPTION 'C photo, thumbnail and focal point should come from B together'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicle_tags WHERE vehicle_id = c AND tag_id = tb) THEN
        RAISE EXCEPTION 'C should take B''s tags'; END IF;
    IF (SELECT count(*) FROM vehicle_tags WHERE vehicle_id = c) <> 1 THEN RAISE EXCEPTION 'C tags should be exactly B''s'; END IF;
    RAISE NOTICE 'ok: C carries what B said, and points at A';

    -- D had its own color, photo, tags and hp: all stay.
    SELECT * INTO r FROM vehicles WHERE id = d;
    IF r.spec_source_vehicle_id <> a THEN RAISE EXCEPTION 'D should now inherit from A'; END IF;
    IF r.color <> '#444444' OR r.image_url <> 'd.jpg' THEN RAISE EXCEPTION 'D own color/photo overwritten'; END IF;
    IF r.image_focal_y IS NOT NULL THEN RAISE EXCEPTION 'D focal point must not come from B''s picture'; END IF;
    IF r.specs #>> '{powertrain,horsepower_hp}' <> '350' THEN RAISE EXCEPTION 'D own hp overwritten'; END IF;
    IF r.specs #>> '{powertrain,motors}' <> '1' THEN RAISE EXCEPTION 'D should take motors from B'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicle_tags WHERE vehicle_id = d AND tag_id = tc)
       OR EXISTS (SELECT 1 FROM vehicle_tags WHERE vehicle_id = d AND tag_id = tb) THEN
        RAISE EXCEPTION 'D keeps only its own tags'; END IF;
    RAISE NOTICE 'ok: D keeps what it set itself';

    -- Deleting the root: its variants become roots, carrying A's values.
    passed := delete_vehicle_passing_down(a);
    SELECT * INTO r FROM vehicles WHERE id = c;
    IF r.spec_source_vehicle_id IS NOT NULL THEN RAISE EXCEPTION 'C should be a root'; END IF;
    IF r.specs #>> '{powertrain,drive_type}' <> 'AWD' THEN RAISE EXCEPTION 'C should carry A''s drive type'; END IF;
    RAISE NOTICE 'ok: deleting a root passes its values down too';

    -- No variants, and no such vehicle, are not errors.
    IF delete_vehicle_passing_down(e) <> 0 THEN RAISE EXCEPTION 'E had no variants'; END IF;
    IF delete_vehicle_passing_down(-1) <> 0 THEN RAISE EXCEPTION 'a missing id should do nothing'; END IF;
    RAISE NOTICE 'ok: no variants, and no such vehicle';
END;
$$;

-- merge_spec_blobs on its own: false and 0 are values, '' and null are blanks.
DO $$
DECLARE m jsonb;
BEGIN
    m := merge_spec_blobs('{"c":{"a":5,"b":true,"s":"x"}}', '{"c":{"a":0,"b":false,"s":""}}');
    IF m #>> '{c,a}' <> '0' OR m #>> '{c,b}' <> 'false' THEN RAISE EXCEPTION '0 and false must win: %', m; END IF;
    IF m #>> '{c,s}' <> 'x' THEN RAISE EXCEPTION 'an empty string must not mask: %', m; END IF;
    IF merge_spec_blobs(NULL, NULL) <> '{}'::jsonb THEN RAISE EXCEPTION 'null + null'; END IF;
    RAISE NOTICE 'ok: merge_spec_blobs';
END;
$$;

ROLLBACK;
