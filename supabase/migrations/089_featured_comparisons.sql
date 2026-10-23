-- 089: featured comparisons — the curated page Home is built from (#448)
--
-- A featured comparison is a curator's answer to one question, told in several
-- charts at once: the vehicles it is about, and for each chart the settings
-- that make the point. A curator picks cheap cars and shows how they compare on
-- a ski trip, in range, in charging and in a table, under one title and one
-- link. Home draws every chart of the one it shows.
--
--   vehicle_ids  the shared, ordered vehicle set. Every chart of the comparison
--                is drawn for these. Not a foreign key: a Postgres array cannot
--                have one, so a vehicle deleted later leaves its id behind and
--                the reader skips ids it cannot find (featuredComparisons.js).
--   charts       an ordered jsonb array of { title, params }, where `params` is
--                a chart link (utils/chartUrlState.js) without v and popout:
--                the tab, mode, plotted tests (r), settings and correction of
--                that one chart. Stored as the query string rather than as
--                columns so a new chart setting needs no migration.
--   is_listed    whether Home may show it. The same word as a vehicle or a test
--                (docs/vocabulary.md): unlisted is reachable by curators.
--   listed_at    when it was last listed. Home shows the newest listed
--                comparison, so listing an older one features it again.
--
-- RLS follows chart_help (031) and the curators' policies of 087:
--   SELECT  listed, or the reader is a curator
--   INSERT / UPDATE  admin and contributor
--   DELETE  admin only
-- An UPDATE or DELETE that RLS filters matches 0 rows and PostgREST answers
-- 204, so DataService reads the row back and raises on 0 rows (the lesson of
-- 087).
--
-- Safe to run twice: the table is IF NOT EXISTS and every policy and trigger is
-- dropped IF EXISTS before it is created.

CREATE TABLE IF NOT EXISTS public.featured_comparisons (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        text        NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title       text        NOT NULL CHECK (btrim(title) <> ''),
    blurb       text,
    vehicle_ids bigint[]    NOT NULL DEFAULT '{}',
    charts      jsonb       NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(charts) = 'array'),
    is_listed   boolean     NOT NULL DEFAULT false,
    listed_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Home asks for the newest listed one.
CREATE INDEX IF NOT EXISTS featured_comparisons_listed_idx
    ON public.featured_comparisons (listed_at DESC) WHERE is_listed;

-- listed_at is set by the database, so it cannot be forgotten by a caller or
-- moved by one that is merely saving a typo.
CREATE OR REPLACE FUNCTION public.featured_comparisons_stamp_listed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_listed AND (TG_OP = 'INSERT' OR NOT OLD.is_listed) THEN
        NEW.listed_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS featured_comparisons_stamp_listed ON public.featured_comparisons;
CREATE TRIGGER featured_comparisons_stamp_listed
    BEFORE INSERT OR UPDATE ON public.featured_comparisons
    FOR EACH ROW EXECUTE FUNCTION public.featured_comparisons_stamp_listed();

ALTER TABLE public.featured_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read listed featured comparisons, curators read all" ON public.featured_comparisons;
CREATE POLICY "Read listed featured comparisons, curators read all"
    ON public.featured_comparisons FOR SELECT
    USING (is_listed OR public.current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators can insert featured comparisons" ON public.featured_comparisons;
CREATE POLICY "Curators can insert featured comparisons"
    ON public.featured_comparisons FOR INSERT
    WITH CHECK (public.current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators can update featured comparisons" ON public.featured_comparisons;
CREATE POLICY "Curators can update featured comparisons"
    ON public.featured_comparisons FOR UPDATE
    USING (public.current_user_role() IN ('admin', 'contributor'))
    WITH CHECK (public.current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Admins can delete featured comparisons" ON public.featured_comparisons;
CREATE POLICY "Admins can delete featured comparisons"
    ON public.featured_comparisons FOR DELETE
    USING (public.current_user_role() = 'admin');

GRANT SELECT ON public.featured_comparisons TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.featured_comparisons TO authenticated;
