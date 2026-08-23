-- ============================================================
-- Migration 058: remembering that a group was deliberately left unlinked (#238)
--
-- Additive. Two columns on epa_test_groups. Nothing is dropped or rewritten.
--
-- ── Why a skip has to be recorded ───────────────────────────────────────────
--
-- The linking sweep lists every certification group with no Fuel Economy Guide
-- row — 159 of 204 today. A curator will work through them and some will have
-- no correct answer: a group EPA never published a label for, a prototype, a
-- configuration withdrawn before sale.
--
-- Without somewhere to record that, those groups return to the top of the list
-- on every visit, and the sweep never finishes. Worse, the same judgement gets
-- made repeatedly by someone who cannot tell whether they are looking at a new
-- problem or one they already dismissed.
--
-- So a skip is a decision, stored like any other. It is deliberately NOT a
-- deletion and NOT a link: the group stays unlinked and stays visible under a
-- filter, because "we looked and there is nothing" is different from "nobody
-- has looked", and only one of them should be hidden by default.
--
-- ── Why not a status enum ───────────────────────────────────────────────────
--
-- The obvious alternative is a single `link_status` column with values like
-- 'unlinked' / 'linked' / 'skipped'. That would put the truth in two places:
-- `fe_guide_row_id` already says whether a group is linked, and a status column
-- could disagree with it. A timestamp that is either set or null cannot.
-- ============================================================

BEGIN;

ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS fe_guide_skipped_at timestamptz,
    ADD COLUMN IF NOT EXISTS fe_guide_skip_note  text;

COMMENT ON COLUMN epa_test_groups.fe_guide_skipped_at IS
    'When a curator decided this group has no Fuel Economy Guide row to link (#238). Null means nobody has judged it yet — which is not the same as no match existing.';
COMMENT ON COLUMN epa_test_groups.fe_guide_skip_note IS
    'Why it was skipped, in the curator''s words. Optional, and the only record of a judgement that is otherwise invisible.';

-- Partial, because the interesting query is "what still needs deciding" — every
-- group with neither a link nor a skip — and that is a small slice of the table
-- that shrinks as the sweep progresses.
CREATE INDEX IF NOT EXISTS idx_epa_groups_awaiting_fe_link
    ON epa_test_groups (test_group_id)
    WHERE fe_guide_row_id IS NULL AND fe_guide_skipped_at IS NULL;

-- A link supersedes a skip. Without this, linking a group that was skipped
-- earlier leaves both set, and any query using the skip as "do not show me
-- this" would keep hiding a group that is now perfectly linked.
CREATE OR REPLACE FUNCTION public.clear_fe_skip_on_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.fe_guide_row_id IS NOT NULL AND OLD.fe_guide_row_id IS NULL THEN
        NEW.fe_guide_skipped_at := NULL;
        NEW.fe_guide_skip_note  := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_fe_skip_on_link ON epa_test_groups;
CREATE TRIGGER trg_clear_fe_skip_on_link
    BEFORE UPDATE ON epa_test_groups
    FOR EACH ROW
    EXECUTE FUNCTION public.clear_fe_skip_on_link();

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. The columns landed — expect 2:
--
--      SELECT count(*) FROM information_schema.columns
--       WHERE table_name = 'epa_test_groups'
--         AND column_name IN ('fe_guide_skipped_at', 'fe_guide_skip_note');
--
-- 2. What the sweep will show. Expect the linked count to match what the admin
--    panel reports, and awaiting to be the rest:
--
--      SELECT count(*) FILTER (WHERE fe_guide_row_id IS NOT NULL)     AS linked,
--             count(*) FILTER (WHERE fe_guide_row_id IS NULL
--                               AND fe_guide_skipped_at IS NOT NULL)  AS skipped,
--             count(*) FILTER (WHERE fe_guide_row_id IS NULL
--                               AND fe_guide_skipped_at IS NULL)      AS awaiting
--      FROM epa_test_groups;
--
-- 3. Linking clears a skip:
--
--      UPDATE epa_test_groups SET fe_guide_skipped_at = now()
--       WHERE test_group_id = (SELECT test_group_id FROM epa_test_groups
--                               WHERE fe_guide_row_id IS NULL LIMIT 1);
--      UPDATE epa_test_groups SET fe_guide_row_id = (SELECT id FROM epa_fe_guide LIMIT 1)
--       WHERE fe_guide_skipped_at IS NOT NULL;
--      SELECT count(*) FROM epa_test_groups
--       WHERE fe_guide_row_id IS NOT NULL AND fe_guide_skipped_at IS NOT NULL;  -- expect 0
