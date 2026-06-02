-- ============================================================
-- Migration 027: EPA curator refactor — Part 2 (coefficient sets)
--
-- Spec Section 2 (Road Load & Weight). A configuration can carry more
-- than one coefficient set, distinguished by Coefficient Category
-- (City/Highway, Cold CO, US06, Evap). City/Highway is the primary set
-- used by the steady-state curve; others are kept for context and
-- specialised derivations (e.g. Cold-CO notes).
--
-- Coefficients live here rather than on epa_test_groups so the category
-- dimension is first-class. (The legacy target/set columns remain on
-- epa_test_groups until the post-PR-E cleanup migration.)
-- ============================================================

CREATE TABLE epa_coefficient_sets (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_group_id   text NOT NULL
                        REFERENCES epa_test_groups(test_group_id) ON DELETE CASCADE,

    -- Which coefficient set this is. Cold-CO coefficients run higher to
    -- account for cold-soak tire stiffness; US06 covers aggressive transients.
    category        text NOT NULL DEFAULT 'City/Highway'
                        CHECK (category IN ('City/Highway','Cold CO','US06','Evap')),
    -- Exactly one set per group is the primary (drives the curve).
    is_primary      boolean NOT NULL DEFAULT false,

    -- Curb weight + 300 lb, rounded — dyno inertia simulator value.
    equiv_test_weight_lbs numeric(10,2),

    -- EPA standard units: A [lbf], B [lbf/mph], C [lbf/mph²].
    target_a        numeric(10,4),   -- EPA-accepted (coastdown) — default for calcs
    target_b        numeric(10,6),
    target_c        numeric(10,8),
    set_a           numeric(10,4),   -- what was actually programmed on the dyno
    set_b           numeric(10,6),
    set_c           numeric(10,8),

    overrides       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz DEFAULT now(),

    UNIQUE (test_group_id, category)
);

CREATE INDEX idx_epa_coeff_sets_group ON epa_coefficient_sets(test_group_id);

-- At most one primary coefficient set per test group.
CREATE UNIQUE INDEX idx_epa_coeff_sets_one_primary
    ON epa_coefficient_sets(test_group_id)
    WHERE is_primary;

ALTER TABLE epa_coefficient_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read epa_coefficient_sets"
    ON epa_coefficient_sets FOR SELECT USING (true);

CREATE POLICY "Curators insert epa_coefficient_sets"
    ON epa_coefficient_sets FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update epa_coefficient_sets"
    ON epa_coefficient_sets FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete epa_coefficient_sets"
    ON epa_coefficient_sets FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
