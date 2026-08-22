# scripts/

## `localdb.sh` — a local mirror for testing migrations and permissions

A throwaway Postgres restored from a production dump, with a stubbed auth layer,
so two things can be tested without touching the live database:

1. **Migrations**, before they are pasted into the Supabase SQL editor.
2. **Role-gated behaviour** — RLS policies, and anything that depends on being
   an admin or contributor.

The second is the one that has been missing. The browser preview is signed out,
so every contributor- and admin-gated path has been unverifiable locally; here a
session picks its own identity and the *real* policies decide.

### Why it earns its keep

Migration 057 was run against a local cluster before production and four defects
came out of it:

- A contributor calling `merge_manufacturers` would have repointed every vehicle
  and then silently failed to delete the source brand — RLS filters `UPDATE` and
  `DELETE` without raising, so a half-applied merge would have looked like a
  success.
- Brands with no vehicles returned no usage row at all, so the admin panel could
  not tell "none" from "could not find out" — and the Delete button keyed off it.
- `DISTINCT ON` without a matching `ORDER BY` seeded an arbitrary casing.
- `CREATE POLICY` has no `IF NOT EXISTS`, so a **second** application aborted.
  That one is invisible on the first run and could not have been found by
  reading the file.

### Prerequisites

`postgresql@18` (Homebrew). No Docker — deliberately, matching
`LocalDev/backup-and-apply.md`.

A dump in `LocalDev/`, produced by `./LocalDev/backup-evbench.command`. Those are
public-schema only: no `auth` schema, so no emails and no session tokens. That
is also why this script has to supply the auth stub itself.

### Use

```bash
scripts/localdb.sh up                 # create, restore the newest dump, seed
scripts/localdb.sh migrate 057        # apply migration(s) by number or path
scripts/localdb.sh psql --as admin    # a shell as admin/contributor/user/anon
scripts/localdb.sh status
scripts/localdb.sh down
scripts/localdb.sh reset              # destroy and rebuild from the dump
```

Three seeded users, one per role, with fixed UUIDs:

| Role | UUID |
|---|---|
| `admin` | `00000000-0000-4000-a000-000000000001` |
| `contributor` | `00000000-0000-4000-a000-000000000002` |
| `user` (signed-in viewer) | `00000000-0000-4000-a000-000000000003` |

Inside a session, switch identity with `SET test.user_id = '…';` or `RESET
test.user_id;` for anonymous.

### How the fidelity works, and where it stops

**`auth.uid()` is stubbed. Authorisation is not.** `public.current_user_role()`
arrives from the dump exactly as migration 001 defines it, and every RLS policy
that calls it is the real one. A test therefore exercises the actual
authorisation logic and only lies about who is asking.

Two settings make that work, and both are required:

- `test.user_id` — who the policies think you are.
- `role` — who Postgres thinks you are. Without it the connection is `postgres`,
  a **superuser**, and superusers bypass RLS entirely: every policy silently
  passes, a denied write appears to succeed, and the tool would report that a
  permission check passed when it never ran.

Signed-in roles map to `authenticated` and anonymous to `anon`, mirroring
Supabase, where the app-level role lives in `profiles` and Postgres only
distinguishes signed-in from not.

**Not covered:** GoTrue's login, refresh and session handling, and the JWT path
that populates `auth.uid()` for real. Those are Supabase's code, not ours. The
`auth.users` stub carries only the columns something in `public` actually reads.

### Notes

- The cluster lives in `$TMPDIR/evbench-localdb`, never in the repo. Override
  with `EVBENCH_PGDATA`.
- It listens on a unix socket only — a database holding a copy of production has
  no business accepting TCP.
- `reset` is cheap. Treat the local database as disposable and never as a second
  source of truth; rebuild it from a fresh dump rather than fixing it in place.
- Re-dump when you are about to write a migration, and after a significant
  import. There is no continuous replication and there should not be: that would
  need a standing production credential and would sync the personal data the
  backup script deliberately excludes.
