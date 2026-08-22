-- ============================================================
-- Three known users, one per role, applied AFTER the dump.
--
-- Fixed UUIDs so a test can hard-code them and a JWT can be minted for them
-- ahead of time. Version 4 shaped but obviously synthetic, so they are never
-- mistaken for real accounts in a query result.
--
-- The 'user' role is the one worth remembering: it is the signed-in viewer, and
-- migration 001 makes it the DEFAULT for a new profile. Most permission bugs
-- live at that boundary rather than at anonymous.
-- ============================================================

INSERT INTO auth.users (id, email) VALUES
    ('00000000-0000-4000-a000-000000000001', 'admin@localdb.test'),
    ('00000000-0000-4000-a000-000000000002', 'contributor@localdb.test'),
    ('00000000-0000-4000-a000-000000000003', 'viewer@localdb.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role) VALUES
    ('00000000-0000-4000-a000-000000000001', 'admin'),
    ('00000000-0000-4000-a000-000000000002', 'contributor'),
    ('00000000-0000-4000-a000-000000000003', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
