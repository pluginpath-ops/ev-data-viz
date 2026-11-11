-- 096: saved selections — a reader's own named vehicle sets
--
-- A saved selection is a name and an ordered list of vehicle ids, so a reader
-- who keeps returning to the same few comparisons can put the chips back in
-- one click. Personal: each row belongs to one signed-in user and nobody else
-- can read it, curators included. Signed-out readers keep theirs in the
-- browser, and the app moves them here on the first signed-in load
-- (utils/savedSelections.js, hooks/useSavedSelections.js).
--
-- The first table that holds anything per user; every other preference still
-- lives in the browser.
--
--   user_id      the owner. Filled from auth.uid() when left out, and every
--                policy checks it, so a row cannot be written for someone else.
--                Deleted with the user.
--   name         unique per user, ignoring case; the app trims it and caps it
--                at 60 (SAVED_SELECTION_NAME_MAX).
--   vehicle_ids  ordered, as the chips were. Not a foreign key (an array cannot
--                have one), so a vehicle deleted later leaves its id behind and
--                the reader skips ids it cannot find — the rule featured
--                comparisons (089) follow.
--
-- Safe to run twice: the table and index are IF NOT EXISTS and every policy is
-- dropped IF EXISTS before it is created.

CREATE TABLE IF NOT EXISTS public.saved_selections (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     uuid        NOT NULL DEFAULT auth.uid()
                REFERENCES auth.users(id) ON DELETE CASCADE,
    name        text        NOT NULL
                CHECK (btrim(name) <> '' AND char_length(name) <= 60),
    vehicle_ids bigint[]    NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_selections_user_name_idx
    ON public.saved_selections (user_id, lower(name));

ALTER TABLE public.saved_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own saved selections" ON public.saved_selections;
CREATE POLICY "Read own saved selections"
    ON public.saved_selections FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Insert own saved selections" ON public.saved_selections;
CREATE POLICY "Insert own saved selections"
    ON public.saved_selections FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Update own saved selections" ON public.saved_selections;
CREATE POLICY "Update own saved selections"
    ON public.saved_selections FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delete own saved selections" ON public.saved_selections;
CREATE POLICY "Delete own saved selections"
    ON public.saved_selections FOR DELETE
    USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_selections TO authenticated;
