-- ============================================================
-- Local test database: what Supabase provides and a public-schema dump does not.
--
-- Applied BEFORE restoring the dump, because the dump's policies, grants and
-- foreign keys all reference these and fail to create without them. A restore
-- into a bare cluster throws 35 "schema auth does not exist" errors and silently
-- ends up with NO WORKING RLS — which is the one thing this database exists to
-- test.
--
-- ── Fidelity: stub the identity, not the authorisation ──────────────────────
--
-- `auth.uid()` is faked. `public.current_user_role()` is NOT — it arrives from
-- the dump exactly as migration 001 defines it:
--
--     SELECT role FROM public.profiles WHERE id = auth.uid();
--
-- and every RLS policy that calls it is the real one too. So a test exercises
-- the actual authorisation logic and only lies about who is asking. Replacing
-- current_user_role() instead would have been easier and would have tested
-- nothing: the policies would be running against a function production does not
-- have.
--
-- What this therefore does NOT cover: GoTrue's login, refresh and session
-- handling, and the JWT path that populates auth.uid() for real. Those are
-- Supabase's code, not ours.
-- ============================================================

-- ── Roles the dump grants to ────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ── auth.users ──────────────────────────────────────────────────────────────
--
-- Only the columns anything in `public` actually reads: `profiles.id` is a
-- foreign key to this, and get_admin_users selects id, email and created_at.
-- Deliberately not a replica of Supabase's table — the rest of it is session
-- tokens and provider identities that no migration in this repo touches, and
-- inventing them would suggest a fidelity this does not have.
CREATE TABLE IF NOT EXISTS auth.users (
    id         uuid PRIMARY KEY,
    email      text,
    created_at timestamptz DEFAULT now()
);

-- ── Who is asking ───────────────────────────────────────────────────────────
--
-- Read from a session setting, so a role is chosen per connection:
--
--     SET test.user_id = '00000000-0000-4000-a000-000000000001';   -- the admin
--
-- `true` as the second argument to current_setting means "return NULL if unset"
-- rather than raising, so an unauthenticated session — the anonymous visitor —
-- is the natural default rather than an error.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
AS $$ SELECT CASE WHEN auth.uid() IS NULL THEN 'anon' ELSE 'authenticated' END $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
AS $$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email(), auth.jwt()
    TO anon, authenticated, service_role;


-- ── Supabase's privilege model, reproduced ──────────────────────────────────
--
-- Supabase grants table access to anon and authenticated broadly and lets RLS
-- do the deciding. That distinction matters here: a privilege check runs BEFORE
-- any policy, so a role with no GRANT is refused with "permission denied for
-- table" and the policy is never consulted at all. Testing against that would
-- prove only that the grants are missing.
--
-- Default privileges cover tables created by migrations applied after the dump
-- was taken, which would otherwise arrive with no grants at all.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
