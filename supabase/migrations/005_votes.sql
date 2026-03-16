-- Migration 005: Public voting — spec vouches, run votes, spec field flags
-- Applies: paste into Supabase SQL Editor

-- ── 1. Votes table (for counted, browser-token-deduplicated vouches/flags on specs & runs) ──

CREATE TABLE IF NOT EXISTS public.votes (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_type   text   NOT NULL CHECK (target_type IN ('vehicle_specs', 'run')),
    target_id     bigint NOT NULL,        -- vehicle_id for 'vehicle_specs', run_id for 'run'
    vote_type     text   NOT NULL CHECK (vote_type IN ('vouch', 'flag')),
    browser_token uuid   NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (browser_token, target_type, target_id)
);

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read vote counts
CREATE POLICY "votes: select" ON public.votes
    FOR SELECT USING (true);

-- Anyone can insert a vote (browser_token is the client-side identity)
CREATE POLICY "votes: insert" ON public.votes
    FOR INSERT WITH CHECK (true);

-- Anyone can delete (client only sends DELETE WHERE browser_token = their own token)
CREATE POLICY "votes: delete" ON public.votes
    FOR DELETE USING (true);

-- ── 2. Field-level flags on vehicles (simple set — no counting, no dedup needed) ──

ALTER TABLE public.vehicles
    ADD COLUMN IF NOT EXISTS flagged_specs text[] NOT NULL DEFAULT '{}';

-- ── 3. RPCs for atomic flag operations ──

-- Flag a specific spec field (idempotent — skips if already flagged)
-- SECURITY DEFINER so anonymous callers can UPDATE vehicles.flagged_specs
-- without needing general UPDATE permission on the vehicles table.
CREATE OR REPLACE FUNCTION public.flag_spec_field(p_vehicle_id bigint, p_field_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.vehicles
    SET flagged_specs = array_append(flagged_specs, p_field_key)
    WHERE id = p_vehicle_id
      AND NOT (p_field_key = ANY(flagged_specs));
$$;

-- Unflag a specific spec field (admin-only enforcement in application layer)
CREATE OR REPLACE FUNCTION public.unflag_spec_field(p_vehicle_id bigint, p_field_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.vehicles
    SET flagged_specs = array_remove(flagged_specs, p_field_key)
    WHERE id = p_vehicle_id;
$$;
