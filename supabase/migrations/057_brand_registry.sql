-- ============================================================
-- Migration 057: one brand registry, two consumers (#149, #243)
--
-- Additive. Creates one table, adds one column, adds three functions. Drops
-- nothing and rewrites no existing row except through the merge function, which
-- only runs when an admin asks it to.
--
-- ── The problem ─────────────────────────────────────────────────────────────
--
-- Brand identity is currently held in two unrelated places and neither can be
-- maintained without SQL:
--
--   • `manufacturers` — 19 rows, reached by a FK from `vehicles`. Contains
--     `Volkswage`, a typo nobody can fix through the UI (#149).
--   • `epa_fe_guide.division` — EPA's raw filing text, 38 distinct values over
--     1,175 rows, with the same company appearing more than once: `Lucid` and
--     `Lucid USA Inc.`, `KIA` and `KIA MOTORS CORPORATION`. The public browser
--     shipped in #235 facets on this column, so filtering to Lucid silently
--     returns 52 of 61 configurations (#243).
--
-- Building a second admin panel for the second case would leave two lists of
-- brands to keep in step. So there is ONE registry — `manufacturers` — and
-- everything else maps into it by alias.
--
-- ── Why aliases rather than rewriting the source ────────────────────────────
--
-- `epa_fe_guide.division` is EPA's record of what was filed, and the staging
-- table exists to hold the source faithfully — 053 is explicit about that.
-- Normalising by UPDATE would destroy the only copy of what EPA actually said.
-- An alias table maps for display and grouping while the source stays intact,
-- and the same mechanism absorbs vehicle `make` typos on the way past.
--
-- ── Why parent is text, not a self-FK ───────────────────────────────────────
--
-- A corporate parent has no attributes of its own here: nothing links to
-- `General Motors`, and #236 only needs to GROUP BY it. A self-referencing FK
-- would mean creating parent-only manufacturer rows that are not brands, which
-- then have to be excluded from every brand list in the app.
--
-- The cost is that a parent is typed rather than chosen, which is how
-- `Volkswage` happened in the first place. That is mitigated where it matters:
-- the admin panel offers the distinct values already present as a datalist, and
-- the seed below takes them from EPA's own `Mfr Name` rather than from anyone's
-- typing.
-- ============================================================

BEGIN;

-- ── 1. Corporate parent on the registry ──────────────────────────────────────

ALTER TABLE manufacturers
    ADD COLUMN IF NOT EXISTS parent_name text;

COMMENT ON COLUMN manufacturers.parent_name IS
    'Corporate parent, for grouping (#236): Chevrolet, Cadillac and GMC all read General Motors. Denormalised text — see migration 057 header.';


-- ── 2. Aliases: every other spelling of a brand ──────────────────────────────

CREATE TABLE IF NOT EXISTS brand_aliases (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manufacturer_id bigint NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,

    -- As written by the source, preserved for display so a curator can see what
    -- they matched. `alias_key` is what lookups actually use.
    alias     text NOT NULL,
    -- Case- and whitespace-insensitive, because EPA shouts: `KIA` and `Kia` are
    -- one alias, and a registry that treats them as two has not solved anything.
    alias_key text GENERATED ALWAYS AS (lower(btrim(alias))) STORED,

    -- Where the spelling came from. Not decoration: it tells a curator whether
    -- an entry is EPA's wording or one of ours, which changes whether editing
    -- it is safe.
    source text NOT NULL DEFAULT 'manual'
        CHECK (source IN ('epa_division', 'vehicle_make', 'manual')),

    created_at timestamptz DEFAULT now(),

    -- One alias resolves to exactly one brand. Without this a division could be
    -- claimed by two manufacturers and the resolution would depend on row order.
    UNIQUE (alias_key)
);

COMMENT ON TABLE brand_aliases IS
    'Alternate spellings that resolve to a manufacturer — EPA division strings, legacy make text, typos. Display and grouping only; never written back over the source (#149, #243).';

CREATE INDEX IF NOT EXISTS idx_brand_aliases_manufacturer
    ON brand_aliases (manufacturer_id);

ALTER TABLE brand_aliases ENABLE ROW LEVEL SECURITY;

-- Public read: the FE Guide browser resolves brand names for anonymous
-- visitors, so an unreadable alias table would silently un-normalise the
-- facet for exactly the people the feature was built for.
-- Dropped first because Postgres has no CREATE POLICY IF NOT EXISTS, and
-- everything else here is guarded so the migration can be re-run. Without this
-- a second application aborts on the first policy. Same pattern as 026.
DROP POLICY IF EXISTS "Public read brand aliases"            ON brand_aliases;
DROP POLICY IF EXISTS "Contributors can insert brand aliases" ON brand_aliases;
DROP POLICY IF EXISTS "Contributors can update brand aliases" ON brand_aliases;
DROP POLICY IF EXISTS "Admins can delete brand aliases"       ON brand_aliases;

CREATE POLICY "Public read brand aliases"
    ON brand_aliases FOR SELECT USING (true);

CREATE POLICY "Contributors can insert brand aliases"
    ON brand_aliases FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update brand aliases"
    ON brand_aliases FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete brand aliases"
    ON brand_aliases FOR DELETE
    USING (current_user_role() = 'admin');


-- ── 3. Seed: each brand is an alias of itself ────────────────────────────────
--
-- So resolution is one uniform lookup rather than "check aliases, then fall
-- back to comparing against the name".

INSERT INTO brand_aliases (manufacturer_id, alias, source)
    SELECT m.id, m.name, 'manual'
    FROM manufacturers m
    ON CONFLICT (alias_key) DO NOTHING;


-- ── 4. Seed: EPA divisions that match a brand name exactly ───────────────────
--
-- Case-insensitively only. `BMW`, `Ford`, `Rivian` and `Porsche` need no
-- judgement, and making a curator confirm 20 identical strings buys nothing.
--
-- Deliberately NOT fuzzy. `Lucid USA Inc.` → Lucid and `Tesla Motors` → Tesla
-- are the same kind of guess as a test-group link, and #243 is explicit that an
-- unmapped division must surface as a decision rather than be inferred.

-- ORDER BY must lead with the DISTINCT ON expression or Postgres picks an
-- arbitrary row from each group, and which CASING of the division gets stored
-- would then depend on the plan. `alias_key` is lowercased so matching is
-- unaffected either way, but the alias a curator SEES should not vary between
-- one run of this migration and the next. Ties break on the division text.
INSERT INTO brand_aliases (manufacturer_id, alias, source)
    SELECT DISTINCT ON (lower(btrim(g.division)))
           m.id, g.division, 'epa_division'
    FROM epa_fe_guide g
    JOIN manufacturers m ON lower(btrim(m.name)) = lower(btrim(g.division))
    WHERE g.division IS NOT NULL AND btrim(g.division) <> ''
    ORDER BY lower(btrim(g.division)), g.division
    ON CONFLICT (alias_key) DO NOTHING;


-- ── 5. Merge, as one operation ───────────────────────────────────────────────
--
-- Merge rather than delete is the whole point. `vehicles.manufacturer_id` is
-- ON DELETE SET NULL, so deleting `Volkswage` would orphan its vehicles — and
-- worse, leave `vehicles.make` still reading "Volkswage", because that text
-- column is a separate copy the FK knows nothing about. A curator fixing a typo
-- would see the brand disappear and the wrong spelling remain on every card.
--
-- So this repoints the FK, rewrites the stale text, inherits the aliases, and
-- records the losing spelling as an alias of the winner — which is what stops
-- the next import from recreating it.
CREATE OR REPLACE FUNCTION public.merge_manufacturers(p_from bigint, p_into bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_from_name text;
    v_into_name text;
BEGIN
    -- ── Admin only, checked explicitly ───────────────────────────────────────
    --
    -- SECURITY INVOKER does not bypass RLS — that is what SECURITY DEFINER
    -- would do — so a non-admin caller was never able to delete a manufacturer
    -- here. But relying on RLS alone was still wrong, and in a way that matters:
    -- RLS filters UPDATE and DELETE **silently**, affecting zero rows without
    -- raising. A CONTRIBUTOR calling this would therefore repoint every vehicle
    -- (which their policy allows) and then fail to delete the source brand
    -- (which it does not) — with no error. That is a half-applied merge, which
    -- the header of this function calls worse than none.
    --
    -- So the role is asserted up front and the whole call aborts. Same pattern
    -- as set_user_role in migration 001. INVOKER is kept rather than following
    -- 001's SECURITY DEFINER: those functions need elevated rights to read
    -- auth.users, whereas everything here is a table an admin can already
    -- write, so RLS stays in place as a second line of defence.
    IF public.current_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Access denied: merging brands requires the admin role';
    END IF;

    IF p_from = p_into THEN
        RAISE EXCEPTION 'Cannot merge a brand into itself';
    END IF;

    -- ── Serialise against a concurrent merge ─────────────────────────────────
    --
    -- Both rows are locked before anything is read or written, in a fixed order
    -- (least id first) so two merges naming the same pair in opposite
    -- directions cannot deadlock. Without this, two admins merging into the
    -- same target could interleave between the duplicate-check and the update
    -- below and collide on the alias_key unique constraint.
    PERFORM 1 FROM manufacturers
     WHERE id IN (p_from, p_into)
     ORDER BY id
       FOR UPDATE;

    SELECT name INTO v_from_name FROM manufacturers WHERE id = p_from;
    SELECT name INTO v_into_name FROM manufacturers WHERE id = p_into;

    IF v_from_name IS NULL OR v_into_name IS NULL THEN
        RAISE EXCEPTION 'Both brands must exist (from=% into=%)', p_from, p_into;
    END IF;

    -- The FK, and the text column that shadows it.
    UPDATE vehicles
       SET manufacturer_id = p_into,
           make            = v_into_name
     WHERE manufacturer_id = p_from;

    -- Vehicles that never had the FK set but carry the losing spelling. Without
    -- this they keep a name the registry no longer knows.
    UPDATE vehicles
       SET manufacturer_id = p_into,
           make            = v_into_name
     WHERE manufacturer_id IS NULL
       AND lower(btrim(make)) = lower(btrim(v_from_name));

    -- ── Aliases: drop the true duplicates, then move the rest ────────────────
    --
    -- Order matters and the previous shape had it backwards. It updated with a
    -- NOT EXISTS guard and then blanket-deleted whatever was left, which meant
    -- any row that failed to move for a reason OTHER than being a duplicate
    -- would have been destroyed without a word.
    --
    -- Deleting the duplicates FIRST makes the discarded set explicit: a row is
    -- removed only when the target already carries that exact alias_key, so the
    -- spelling still resolves to the same brand afterwards and nothing is lost.
    -- The move that follows is then unconditional and cannot violate the unique
    -- constraint, because every remaining key is free.
    DELETE FROM brand_aliases a
     WHERE a.manufacturer_id = p_from
       AND EXISTS (
           SELECT 1 FROM brand_aliases b
            WHERE b.manufacturer_id = p_into
              AND b.alias_key = a.alias_key
       );

    UPDATE brand_aliases
       SET manufacturer_id = p_into
     WHERE manufacturer_id = p_from;

    -- The losing name becomes an alias of the winner, so a re-import of the old
    -- spelling resolves instead of creating the row again.
    INSERT INTO brand_aliases (manufacturer_id, alias, source)
         VALUES (p_into, v_from_name, 'manual')
    ON CONFLICT (alias_key) DO NOTHING;

    -- Nothing references p_from now. Its aliases have all moved, so the
    -- ON DELETE CASCADE below has nothing left to take with it.
    DELETE FROM manufacturers WHERE id = p_from;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_manufacturers(bigint, bigint) TO authenticated;


-- ── 6. Which EPA divisions still need a decision ─────────────────────────────
--
-- One row per distinct division with its configuration count and the brand it
-- resolves to, or NULL when nothing claims it.
--
-- An RPC rather than a client-side count for the reason migration 054 exists:
-- there are 1,175 guide rows and PostgREST truncates at 1,000 silently, so
-- counting divisions in the browser would under-report them with no error. The
-- unmapped list is exactly the place where a quietly short answer is worst — a
-- division that never appears is a decision nobody knows they have to make.
CREATE OR REPLACE FUNCTION public.brand_division_summary()
RETURNS TABLE (
    division        text,
    row_count       bigint,
    manufacturer_id bigint,
    brand_name      text,
    parent_name     text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        g.division,
        count(*) AS row_count,
        m.id,
        m.name,
        m.parent_name
    FROM epa_fe_guide g
    LEFT JOIN brand_aliases a ON a.alias_key = lower(btrim(g.division))
    LEFT JOIN manufacturers m ON m.id = a.manufacturer_id
    WHERE g.division IS NOT NULL AND btrim(g.division) <> ''
    GROUP BY g.division, m.id, m.name, m.parent_name
    -- Unmapped first: this list exists to show what still needs deciding.
    ORDER BY (m.id IS NOT NULL), count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.brand_division_summary() TO anon, authenticated;


-- ── 7. How many vehicles and aliases each brand holds ────────────────────────
--
-- Drives the "safe to delete?" question in the admin panel. A brand with
-- vehicles should be merged, never deleted.
--
-- Written as three grouped scans joined together, not as scalar subqueries per
-- manufacturer. The earlier shape ran a correlated subquery over epa_fe_guide
-- for every brand — 19 x 1,175 rows today, which is nothing, but it is O(n x m)
-- and the guide grows by a few hundred rows each model year while the brand
-- list grows too. Aggregating once per table is the same answer at a fixed cost.
--
-- LEFT JOINs, so a brand with no vehicles and no guide rows still returns a row
-- of zeros rather than disappearing — the admin panel needs "0", and an absent
-- row would read as "unknown" and block deletion of a brand that is genuinely
-- free to delete.
CREATE OR REPLACE FUNCTION public.brand_usage_summary()
RETURNS TABLE (
    manufacturer_id bigint,
    vehicle_count   bigint,
    alias_count     bigint,
    guide_row_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH veh AS (
        SELECT v.manufacturer_id AS mid, count(*) AS n
          FROM vehicles v
         WHERE v.manufacturer_id IS NOT NULL
         GROUP BY v.manufacturer_id
    ),
    ali AS (
        SELECT a.manufacturer_id AS mid, count(*) AS n
          FROM brand_aliases a
         GROUP BY a.manufacturer_id
    ),
    guide AS (
        SELECT a.manufacturer_id AS mid, count(*) AS n
          FROM epa_fe_guide g
          JOIN brand_aliases a ON a.alias_key = lower(btrim(g.division))
         GROUP BY a.manufacturer_id
    )
    SELECT m.id,
           COALESCE(veh.n,   0),
           COALESCE(ali.n,   0),
           COALESCE(guide.n, 0)
      FROM manufacturers m
      LEFT JOIN veh   ON veh.mid   = m.id
      LEFT JOIN ali   ON ali.mid   = m.id
      LEFT JOIN guide ON guide.mid = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.brand_usage_summary() TO anon, authenticated;


-- ── 8. Index the expression both functions join on ───────────────────────────
--
-- `lower(btrim(division))` is what resolves a filing to a brand, in
-- brand_division_summary and brand_usage_summary alike. Without an expression
-- index every one of those joins is a sequential scan of the guide; a plain
-- index on `division` cannot serve them, because the expression is not the
-- bare column.
CREATE INDEX IF NOT EXISTS idx_fe_guide_division_key
    ON epa_fe_guide (lower(btrim(division)));

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. Every brand is an alias of itself — expect 0:
--
--      SELECT count(*) FROM manufacturers m
--       WHERE NOT EXISTS (SELECT 1 FROM brand_aliases a
--                          WHERE a.alias_key = lower(btrim(m.name)));
--
-- 2. The exact-match seed took. Expect ~15 of the 38 divisions mapped, with
--    `Lucid USA Inc.`, `KIA MOTORS CORPORATION` and `Tesla Motors` still
--    unmapped — those are curator decisions:
--
--      SELECT count(*) FILTER (WHERE manufacturer_id IS NOT NULL) AS mapped,
--             count(*) FILTER (WHERE manufacturer_id IS NULL)     AS unmapped
--      FROM brand_division_summary();
--
-- 3. Nothing was rewritten — the guide still holds EPA's own text:
--
--      SELECT count(DISTINCT division) FROM epa_fe_guide;   -- expect 38
