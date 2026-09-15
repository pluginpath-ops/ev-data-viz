-- ============================================================
-- Migration 068: one list of sources for performance results (#327)
--
-- Additive: one table, one column on each of two tables, a backfill. Nothing
-- dropped. `source_name` stays, kept equal to the linked source's name.
--
-- -- Why ---------------------------------------------------------------------
--
-- `source_name` is free text on performance_summaries and performance_sessions,
-- and it has already split: summaries say "Car and Driver" 10 times and "C&D"
-- once; sessions say "OoS" 4 times and "Out of Spec" once. Every import retyped
-- the name, so every import was another chance to split it - and a filter by
-- source (#160) cannot work on names that do not agree.
--
-- -- Why "sources", not "publications" ---------------------------------------
--
-- Out of Spec is a YouTube channel and EVBench records its own sessions;
-- neither is a publication. The columns were already `source_name` and
-- `source_url` (migration 041), so the list takes the name they use.
--
-- -- What a source carries ---------------------------------------------------
--
--   name                    the canonical spelling, unique ignoring case
--   aliases                 other spellings seen in pastes and old rows
--   domains                 website domains, so a pasted link names its source
--   default_rollout_basis   'rollout' | 'none' | NULL - how this source prints
--                           0-60 when a block has no footnote saying. A row's own
--                           footnote still wins, and the curator still confirms.
--
-- -- The backfill ------------------------------------------------------------
--
-- 1. Seed the two sources the data already shows split, with those spellings
--    as aliases. Car and Driver's blocks say "omit 1-ft rollout", so its default
--    is 'rollout'. Out of Spec's convention is not stated, so it has none.
-- 2. Link every row whose source_name matches a name or alias, and rewrite that
--    source_name to the canonical name - which merges the splits for every
--    reader that still reads the text column.
-- 3. Any name still unmatched becomes a source of its own, and is linked.
--
-- Safe to run twice.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sources (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                   text NOT NULL CHECK (btrim(name) <> ''),
    aliases                text[] NOT NULL DEFAULT '{}',
    domains                text[] NOT NULL DEFAULT '{}',
    default_rollout_basis  text CHECK (default_rollout_basis IN ('rollout', 'none')),
    notes                  text,
    created_at             timestamptz DEFAULT now(),
    updated_at             timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_name ON sources (lower(name));

COMMENT ON TABLE sources IS
    'Who published or recorded a performance result: a magazine, a channel, EVBench itself (#327).';
COMMENT ON COLUMN sources.default_rollout_basis IS
    'How this source prints 0-60 when a block has no footnote: rollout (drag-strip, 1 ft omitted) or none (standing start). A footnote wins.';

ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read sources" ON sources;
CREATE POLICY "Public read sources"
    ON sources FOR SELECT USING (true);

DROP POLICY IF EXISTS "Curators insert sources" ON sources;
CREATE POLICY "Curators insert sources"
    ON sources FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators update sources" ON sources;
CREATE POLICY "Curators update sources"
    ON sources FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators delete sources" ON sources;
CREATE POLICY "Curators delete sources"
    ON sources FOR DELETE
    USING (current_user_role() IN ('admin', 'contributor'));

-- SET NULL, not CASCADE: deleting a source must never delete the results it
-- published. The row keeps its source_name text.
ALTER TABLE performance_summaries
    ADD COLUMN IF NOT EXISTS source_id bigint REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE performance_sessions
    ADD COLUMN IF NOT EXISTS source_id bigint REFERENCES sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_performance_summaries_source ON performance_summaries(source_id);
CREATE INDEX IF NOT EXISTS idx_performance_sessions_source  ON performance_sessions(source_id);

-- 1. The two sources already split.
INSERT INTO sources (name, aliases, domains, default_rollout_basis) VALUES
    ('Car and Driver', ARRAY['C&D', 'CD', 'Car & Driver'], ARRAY['caranddriver.com'], 'rollout'),
    ('Out of Spec',    ARRAY['OoS', 'Out of Spec Studios'], ARRAY[]::text[],        NULL)
ON CONFLICT ((lower(name))) DO NOTHING;

-- 2 and 3: link by name or alias, turn what is left into sources, link again.
--
-- Linking is deterministic. A canonical name outranks an alias (names are
-- unique, so at most one source matches by name). If no name matches and two
-- sources list the same alias, the row is left unlinked for a curator rather
-- than given to whichever source the planner happens to read first. A re-run
-- after curators have edited aliases is exactly when that could occur.
CREATE OR REPLACE FUNCTION pg_temp.link_sources(target regclass) RETURNS void AS $$
BEGIN
    EXECUTE format($sql$
        WITH candidates AS (
            SELECT r.id AS row_id, s.id AS source_id, s.name,
                   CASE WHEN lower(btrim(r.source_name)) = lower(s.name) THEN 0 ELSE 1 END AS rank
              FROM %1$s r
              JOIN sources s
                ON lower(btrim(r.source_name)) = lower(s.name)
                OR lower(btrim(r.source_name)) IN (SELECT lower(a) FROM unnest(s.aliases) a)
             WHERE r.source_id IS NULL
               AND nullif(btrim(r.source_name), '') IS NOT NULL
        ),
        best AS (
            SELECT row_id, min(rank) AS rank FROM candidates GROUP BY row_id
        ),
        chosen AS (
            SELECT c.row_id, min(c.source_id) AS source_id, min(c.name) AS name
              FROM candidates c
              JOIN best b ON b.row_id = c.row_id AND b.rank = c.rank
             GROUP BY c.row_id
            HAVING count(*) = 1
        )
        UPDATE %1$s r
           SET source_id = chosen.source_id, source_name = chosen.name
          FROM chosen
         WHERE r.id = chosen.row_id
    $sql$, target);
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.link_sources('performance_summaries');
SELECT pg_temp.link_sources('performance_sessions');

-- A name still unlinked becomes a source of its own, spelled the way it is
-- used most (not whichever casing sorts first) - unless it is an alias some
-- source already lists, which is the ambiguous case above and a curator's call.
INSERT INTO sources (name)
SELECT DISTINCT ON (lower(n)) n
  FROM (
      SELECT n, count(*) AS uses
        FROM (
            SELECT btrim(source_name) AS n FROM performance_summaries
             WHERE source_id IS NULL AND nullif(btrim(source_name), '') IS NOT NULL
            UNION ALL
            SELECT btrim(source_name) FROM performance_sessions
             WHERE source_id IS NULL AND nullif(btrim(source_name), '') IS NOT NULL
        ) unmatched
       GROUP BY n
  ) counted
 WHERE NOT EXISTS (
     SELECT 1 FROM sources s, unnest(s.aliases) a WHERE lower(a) = lower(counted.n)
 )
 ORDER BY lower(n), uses DESC, n
ON CONFLICT ((lower(name))) DO NOTHING;

SELECT pg_temp.link_sources('performance_summaries');
SELECT pg_temp.link_sources('performance_sessions');

COMMIT;

-- The API caches the schema; without this a write naming source_id is refused
-- until the cache refreshes (see migration 067).
NOTIFY pgrst, 'reload schema';

-- -- Verification ------------------------------------------------------------
--
-- Every named row is linked (expect 0):
--   SELECT count(*) FROM performance_summaries WHERE source_id IS NULL AND nullif(btrim(source_name), '') IS NOT NULL;
--   SELECT count(*) FROM performance_sessions  WHERE source_id IS NULL AND nullif(btrim(source_name), '') IS NOT NULL;
--
-- One spelling per source (expect one row per source):
--   SELECT s.name, array_agg(DISTINCT r.source_name) FROM sources s
--     JOIN performance_summaries r ON r.source_id = s.id GROUP BY s.name;
