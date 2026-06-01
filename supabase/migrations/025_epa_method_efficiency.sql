-- ============================================================
-- EPA label-method inference + drivetrain-efficiency provenance
--
-- Two related additions to epa_test_groups:
--
-- 1. label_method_inferred — neither EPA source file (Test Car List
--    or Master Emissions List) contains an explicit window-sticker
--    label method. We infer it from which cycles have energy data
--    (5-cycle when US06+SC03+ColdFTP present, 2-cycle when only
--    UDDS+HWFET). This flag marks values that were inferred rather
--    than set explicitly by an admin, so the UI can show uncertainty.
--    When an admin picks a method from the dropdown, this is cleared.
--
-- 2. drivetrain_eta_override — the steady-state curve back-solves
--    drivetrain efficiency (η) from the HWFET measurement. When HWFET
--    energy data is absent (e.g. the Master Emissions List format) the
--    curve falls back to a generic estimate. This column lets an admin
--    pin a specific η. A manual override is still treated as "uncertain"
--    (it is not a direct HWFET measurement) — only HWFET-calibrated η
--    counts as measured.
-- ============================================================

ALTER TABLE public.epa_test_groups
    ADD COLUMN IF NOT EXISTS label_method_inferred boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS drivetrain_eta_override numeric(4,3)
        CHECK (drivetrain_eta_override IS NULL
               OR (drivetrain_eta_override > 0 AND drivetrain_eta_override <= 1));

COMMENT ON COLUMN public.epa_test_groups.label_method_inferred IS
    'True when label_method was auto-inferred from cycle availability rather than set explicitly by an admin.';
COMMENT ON COLUMN public.epa_test_groups.drivetrain_eta_override IS
    'Admin-pinned drivetrain efficiency (0–1). NULL = use HWFET-calibrated or estimated value. A manual override is still flagged uncertain in the UI.';
