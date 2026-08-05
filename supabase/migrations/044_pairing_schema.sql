-- ============================================================
-- Migration 044: Charging/range pairing — Part 1 (additive, reversible)
--
-- Groundwork for issue #150: letting any charging test pair with any range
-- test at graph time. This migration adds structure only — no data is moved,
-- no column is dropped, and nothing user-visible changes.
--
-- Three additions:
--   1. runs.kind            — a discriminator replacing the has_charging /
--                             has_range boolean pair (which admits four states,
--                             two of them meaningless).
--   2. test_sessions        — a testing outing; the home for environmental
--                             metadata shared by the runs measured during it.
--   3. runs.paired_range_run_id — the curator-set default range partner for a
--                             charging test.
--
-- The row split (one dual-role run becoming a charging row plus a range row)
-- and the CHECK constraints enforcing off-role columns are NULL are
-- deliberately NOT here — they are destructive and land in #155.
-- ============================================================


-- Wrapped in a transaction: this is pasted into the SQL editor by hand, and a
-- failure partway through would otherwise leave `kind` added but unpopulated,
-- or the trigger missing.
BEGIN;


-- ── 1. Test sessions ─────────────────────────────────────────────────────────
--
-- A session is one testing outing: same weather, same route, same afternoon.
--
-- Deliberately has NO vehicle_id. A session can span several vehicles — three
-- cars driven side by side on one loop is a single outing, and the whole point
-- of grouping them is that they share conditions. Each run carries its own
-- vehicle_id, so a session's runs may belong to different vehicles.
--
-- Distinct from `performance_sessions` (migration 036), which is one vehicle's
-- accel/braking outing and shares none of these columns.

CREATE TABLE test_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Human label for the outing, e.g. "Ottawa winter loop". Doubles as the
    -- short chart label for a pair whose halves both come from this session
    -- (see #153) — a good name here saves a lot of legend width.
    name            text,

    -- Wall-clock time at the test site. Zone-less for the same reason as
    -- performance_sessions.tested_at: sources report local time with no offset
    -- and we cannot infer one without a tz database.
    tested_at       timestamp,

    tester          text,
    location_name   text,

    -- Environmental context shared by every run in the session. runs.temperature_f
    -- stays authoritative for its own row; this is the session-level reading, and
    -- the congruence tiers in #154 prefer it when present.
    temperature_f   numeric,

    -- Provenance
    source_name     text,
    url             text,
    notes           text,

    created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE test_sessions IS
    'A testing outing grouping runs measured under the same conditions. May span multiple vehicles — no vehicle_id by design.';

ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read test sessions"
    ON test_sessions FOR SELECT USING (true);

CREATE POLICY "Contributors can insert test sessions"
    ON test_sessions FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update test sessions"
    ON test_sessions FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete test sessions"
    ON test_sessions FOR DELETE
    USING (current_user_role() = 'admin');


-- ── 2. runs.kind ─────────────────────────────────────────────────────────────
--
-- One shared derivation used by both the backfill and the sync trigger, so the
-- two can never disagree.
--
--   has_range AND NOT has_charging  → 'range'
--   everything else                 → 'charging'
--
-- Note what that second line covers:
--   • dual-role rows (both true) become 'charging' — they are split in #155
--   • both-false rows (currently invisible to BOTH selectors, since
--     isChargingRun is has_charging !== false and isRangeRun is !!has_range)
--     land as 'charging' rather than being lost

CREATE OR REPLACE FUNCTION runs_derive_kind(p_has_charging boolean, p_has_range boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN COALESCE(p_has_range, false) AND NOT COALESCE(p_has_charging, true)
        THEN 'range'
        ELSE 'charging'
    END;
$$;

ALTER TABLE runs ADD COLUMN kind text;

UPDATE runs SET kind = runs_derive_kind(has_charging, has_range);

ALTER TABLE runs ALTER COLUMN kind SET NOT NULL;
ALTER TABLE runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('charging', 'range'));

COMMENT ON COLUMN runs.kind IS
    'Test role discriminator. Maintained from has_charging/has_range by trigger trg_runs_sync_kind until #155 drops those columns and makes this authoritative.';

-- The trigger — not the application — owns `kind` during the transition.
--
-- This matters for deploy ordering: if the app wrote `kind` directly, shipping
-- the code before this migration is applied would break every run insert, and
-- forgetting to write it would silently mislabel new range runs as charging.
-- With the trigger, the booleans stay authoritative on write, the app only
-- reads `kind`, and the two can be deployed in either order.
--
-- Consequence: an explicitly-supplied `kind` is overwritten. That is intended
-- for now. #155 drops the trigger along with the booleans.

CREATE OR REPLACE FUNCTION runs_sync_kind() RETURNS trigger AS $$
BEGIN
    NEW.kind := runs_derive_kind(NEW.has_charging, NEW.has_range);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_runs_sync_kind
    BEFORE INSERT OR UPDATE OF has_charging, has_range ON runs
    FOR EACH ROW EXECUTE FUNCTION runs_sync_kind();


-- ── 3. Session link and curated pairing ──────────────────────────────────────
--
-- session_id is nullable and ADVISORY. Nothing may ever require it: most
-- existing runs will never have one, and imported runs must not become
-- second-class for lacking one. ON DELETE SET NULL — deleting a session
-- ungroups its runs, it does not delete them.

ALTER TABLE runs
    ADD COLUMN session_id bigint REFERENCES test_sessions(id) ON DELETE SET NULL;

CREATE INDEX idx_runs_session ON runs(session_id);

COMMENT ON COLUMN runs.session_id IS
    'Advisory grouping: runs measured during the same outing. Never required.';

-- The curator-set default range partner for a charging run, used as priority 1
-- of the resolution order in #150. Self-referencing; SET NULL so deleting a
-- range test cannot cascade into the charging test that referenced it.
--
-- That this points at a run whose kind is 'range' is enforced by the
-- application, not the schema — a cross-row CHECK would need its own trigger,
-- and it becomes expressible more cheaply once #155 lands.

ALTER TABLE runs
    ADD COLUMN paired_range_run_id bigint REFERENCES runs(id) ON DELETE SET NULL;

CREATE INDEX idx_runs_paired_range ON runs(paired_range_run_id);

COMMENT ON COLUMN runs.paired_range_run_id IS
    'Curator-set default range test for this charging run. App-enforced to reference a kind=range run.';


COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Run these after applying. Expected results noted on each.
--
-- 1. kind agrees with the booleans on every row — expect 0:
--
--      SELECT count(*) FROM runs
--      WHERE kind IS DISTINCT FROM runs_derive_kind(has_charging, has_range);
--
-- 2. Population census — the dual-role count is what #155 will split, and the
--    both-false count is worth eyeballing since those rows are currently
--    invisible in both run selectors:
--
--      SELECT kind,
--             count(*)                                                    AS rows,
--             count(*) FILTER (WHERE has_charging AND has_range)           AS dual_role,
--             count(*) FILTER (WHERE NOT has_charging AND NOT has_range)   AS neither
--      FROM runs GROUP BY kind;
--
-- 3. The trigger fires on insert — expect 'range'.
--
--    Wrapped in a transaction that is rolled back, so nothing is written and
--    there is no cleanup step to forget. `date` is NOT NULL on runs, hence the
--    placeholder — omitting it fails on that constraint, not on anything here.
--
--      BEGIN;
--      INSERT INTO runs (vehicle_id, name, date, has_charging, has_range)
--      VALUES ((SELECT id FROM vehicles LIMIT 1), 'trigger test', '2026-01-01', false, true)
--      RETURNING name, kind;
--      ROLLBACK;
