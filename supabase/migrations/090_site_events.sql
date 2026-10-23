-- 090: site events — what readers open, so a curator can see what is used (#448)
--
-- The Home tab is curated by hand for now. This is the data to curate from: how
-- often Home is opened, which featured comparison's charts are clicked into,
-- whether the reset is used, and which chart tabs are opened at all. A signal
-- the curator can weigh, not a dashboard; reading it is a later layer.
--
-- Modeled on access_logs (023): rows are written only through a SECURITY
-- DEFINER function, so an anonymous visitor can record an event without any
-- access to the table, and only an admin can read them.
--
-- What is recorded, and what is not (owner's call, 2026-10-23):
--   - the event, from a fixed list;
--   - the browser token, the anonymous id the vote buttons already use
--     (localStorage evbench_browser_token), so distinct visitors can be counted
--     without anyone being known;
--   - a slug (the featured comparison involved) and a small `detail` object
--     (the chart's number and mode).
--   NOT recorded: user id, email, IP address or user agent. The client also
--   skips curators' own clicks, so the numbers are readers'.
--
-- The function is open to everyone by design, so it guards itself: it accepts
-- only the listed events, truncates what it stores, and drops an event past 60
-- a minute from one token. It never raises: logging must not surface to the
-- reader, and a refused event answers false.
--
-- Events are kept; no pruning yet (owner's call). Add a retention job when the
-- table is big enough to matter.
--
-- Questions this answers, for whoever reads it:
--   -- opens per featured comparison, and distinct readers
--   SELECT slug, count(*) opens, count(DISTINCT browser_token) readers
--     FROM site_events WHERE event = 'featured_open' GROUP BY slug ORDER BY opens DESC;
--   -- which charts of one comparison are clicked
--   SELECT detail->>'chart' AS chart, detail->>'mode' AS mode, count(*)
--     FROM site_events WHERE event = 'featured_open' AND slug = '…' GROUP BY 1, 2;
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.site_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    event         text        NOT NULL
                  CHECK (event IN ('home_view', 'featured_open', 'featured_reset', 'chart_view')),
    browser_token uuid        NOT NULL,
    slug          text,
    detail        jsonb       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(detail) = 'object' AND pg_column_size(detail) <= 1024)
);

CREATE INDEX IF NOT EXISTS site_events_event_time_idx ON public.site_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS site_events_slug_time_idx  ON public.site_events (slug, created_at DESC) WHERE slug IS NOT NULL;
-- The rate limit looks up one token's last minute.
CREATE INDEX IF NOT EXISTS site_events_token_time_idx ON public.site_events (browser_token, created_at DESC);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

-- No policy for INSERT, UPDATE or DELETE: nothing writes except the function.
DROP POLICY IF EXISTS "site_events: admin read" ON public.site_events;
CREATE POLICY "site_events: admin read"
    ON public.site_events FOR SELECT
    USING (public.current_user_role() = 'admin');

-- Belt and braces on top of RLS: Supabase grants new tables to its API roles.
REVOKE ALL ON public.site_events FROM anon, authenticated;
GRANT SELECT ON public.site_events TO authenticated;

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
       OR p_event NOT IN ('home_view', 'featured_open', 'featured_reset', 'chart_view') THEN
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
