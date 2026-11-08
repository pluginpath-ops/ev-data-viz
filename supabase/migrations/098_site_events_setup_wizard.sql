-- 098: site events for the setup wizard
--
-- Four more events on the list 090 started (utils/siteEvents.js holds the same
-- list; the wiring suite keeps the three in step):
--   setup_open     the wizard was opened        detail { from: home | empty | nav }
--   setup_apply    Apply was pressed            detail { goal, cars, skipped }
--   setup_close    closed without applying      detail { step }
--   season_toggle  the season note's toggle     detail { to: summer | winter }
-- Never the answers themselves: no miles, prices, places or picked vehicles.
--
-- Same table, same function, same guards (fixed list, 60 a minute per token,
-- small detail, never raises). Only the list changes.
--
-- (096 is held by the saved-selections branch, so this skips to 098.)
--
-- Safe to run twice.

ALTER TABLE public.site_events DROP CONSTRAINT IF EXISTS site_events_event_check;
ALTER TABLE public.site_events ADD CONSTRAINT site_events_event_check
    CHECK (event IN ('home_view', 'featured_open', 'featured_reset', 'chart_view',
                     'setup_open', 'setup_apply', 'setup_close', 'season_toggle'));

CREATE OR REPLACE FUNCTION public.log_site_event(
    p_event         text,
    p_browser_token uuid,
    p_slug          text  DEFAULT NULL,
    p_detail        jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_detail jsonb := COALESCE(p_detail, '{}'::jsonb);
BEGIN
    IF p_browser_token IS NULL
       OR p_event NOT IN ('home_view', 'featured_open', 'featured_reset', 'chart_view',
                          'setup_open', 'setup_apply', 'setup_close', 'season_toggle') THEN
        RETURN false;
    END IF;

    -- A flood from one token cannot bury the real numbers.
    IF (SELECT count(*) FROM public.site_events
         WHERE browser_token = p_browser_token
           AND created_at > now() - interval '1 minute') >= 60 THEN
        RETURN false;
    END IF;

    -- Keep what is stored small and the right shape rather than refusing.
    IF jsonb_typeof(v_detail) <> 'object' OR pg_column_size(v_detail) > 1024 THEN
        v_detail := '{}'::jsonb;
    END IF;

    INSERT INTO public.site_events (event, browser_token, slug, detail)
    VALUES (p_event, p_browser_token, left(p_slug, 80), v_detail);
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.log_site_event(text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_site_event(text, uuid, text, jsonb) TO anon, authenticated;
