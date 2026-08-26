-- Migration 062: publish the model constants site-wide (#261)
--
-- Background:
--   `src/constants/overrides.js` stored every tunable in localStorage on ONE
--   browser. That was right while the knobs were a developer sandbox for
--   tuning the EPA model. It stopped being right when the constants started
--   deciding what other people see:
--
--     • ETA_BAND, CHARGER_EFF_BAND and PACK_KWH_BAND decide whether a derived
--       figure is flagged on every EPA card and whether a record reads as
--       suspect in the reconciliation sweep (#229);
--     • DEFAULT_ETA, ASSUMED_CHARGER_EFF and the accessory load are INPUTS to
--       the physics, so two curators could read different range figures for the
--       same vehicle;
--     • the EPA section is public (#234), and a visitor always got the
--       compiled-in defaults regardless of what any curator had decided.
--
--   #260 sharpened it: a curator can now set a band from the corpus
--   distribution shown beside it, and that decision evaporated for everyone
--   but them.
--
-- Storage:
--   One site_settings row, key 'model_constants', holding a JSON object of
--   { KNOB_KEY: value }. An absent key means the compiled default, so an empty
--   or missing row is the shipped model — nothing needs seeding.
--
--   ONE row rather than a row per constant, because the constants are a single
--   coherent basis: a page that read half a published set would state its
--   figures against a basis nobody chose. Values are scalars or [min, max]
--   pairs, which jsonb carries without a type column.
--
-- Precedence, resolved in the client: local browser override → this published
-- value → compiled default. The local sandbox survives on purpose; trying a
-- change without imposing it is exactly what these knobs were built for.
--
-- Who may write:
--   Admin only. site_settings' existing `update_site_setting` RPC gates on
--   is_owner, which is the older ownership flag rather than the RBAC role
--   these panels are gated by; these functions use current_user_role() so that
--   "can reach the Admin tab" and "can change what the site computes" are the
--   same permission.
--
-- Keys are NOT validated against a whitelist here. The knob list lives in
-- JavaScript (src/constants/knobs.js) and a copy in SQL would drift silently;
-- an unknown key is inert anyway, since the resolver only ever asks for keys
-- it knows. What matters is that only an admin can write one, which is
-- enforced.
--
-- Audit:
--   Every change lands in epa_field_audit — the same trail as a curator field
--   edit, under table_name 'site_constants'. A change to AERO_FRACTION moves
--   every corrected figure on the site; it should be no harder to find out who
--   moved it than it is for a single test's phase energy.

-- Set (constant_value NOT NULL) or revert (NULL) one published constant.
-- Returns the full published map after the change.
CREATE OR REPLACE FUNCTION public.set_model_constant(
    constant_key   text,
    constant_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    current_map jsonb;
    next_map    jsonb;
    prior       jsonb;
BEGIN
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied: must be an admin to publish model constants';
    END IF;

    IF constant_key IS NULL OR constant_key = '' THEN
        RAISE EXCEPTION 'A constant key is required';
    END IF;

    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO current_map
    FROM public.site_settings WHERE key = 'model_constants';
    current_map := COALESCE(current_map, '{}'::jsonb);

    prior := current_map -> constant_key;

    IF constant_value IS NULL OR constant_value = 'null'::jsonb THEN
        next_map := current_map - constant_key;
    ELSE
        next_map := current_map || jsonb_build_object(constant_key, constant_value);
    END IF;

    -- Nothing changed: no write, no audit row. Re-publishing an unchanged
    -- value is a normal thing for a panel to do and should not fill the trail.
    IF next_map = current_map THEN
        RETURN next_map;
    END IF;

    INSERT INTO public.site_settings (key, value)
    VALUES ('model_constants', next_map::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    INSERT INTO public.epa_field_audit
        (table_name, row_id, field, prior_value, new_value, source_citation, edited_by)
    VALUES
        ('site_constants', 'model_constants', constant_key,
         CASE WHEN prior IS NULL THEN NULL ELSE prior::text END,
         CASE WHEN constant_value IS NULL THEN NULL ELSE constant_value::text END,
         'Admin → Model Constants', auth.uid());

    RETURN next_map;
END;
$$;

-- Revert every published constant to its compiled default, in one step.
CREATE OR REPLACE FUNCTION public.clear_model_constants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    current_map jsonb;
    k           text;
BEGIN
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied: must be an admin to publish model constants';
    END IF;

    SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO current_map
    FROM public.site_settings WHERE key = 'model_constants';
    current_map := COALESCE(current_map, '{}'::jsonb);

    IF current_map = '{}'::jsonb THEN
        RETURN current_map;
    END IF;

    -- One audit row per constant reverted, not one for the sweep. Reading the
    -- trail back a field at a time is the point of it.
    FOR k IN SELECT jsonb_object_keys(current_map) LOOP
        INSERT INTO public.epa_field_audit
            (table_name, row_id, field, prior_value, new_value, source_citation, edited_by)
        VALUES
            ('site_constants', 'model_constants', k,
             (current_map -> k)::text, NULL,
             'Admin → Model Constants (reset all)', auth.uid());
    END LOOP;

    INSERT INTO public.site_settings (key, value)
    VALUES ('model_constants', '{}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    RETURN '{}'::jsonb;
END;
$$;

COMMENT ON FUNCTION public.set_model_constant(text, jsonb) IS
    'Publish or revert one EPA model constant site-wide (#261). Admin only. '
    'Writes site_settings.model_constants and an epa_field_audit row under '
    'table_name ''site_constants''. Returns the full published map.';

COMMENT ON FUNCTION public.clear_model_constants() IS
    'Revert every published EPA model constant to its compiled default (#261). '
    'Admin only. Audits one epa_field_audit row per constant reverted.';

GRANT EXECUTE ON FUNCTION public.set_model_constant(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_model_constants() TO authenticated;
