#!/usr/bin/env bash
#
# A throwaway Postgres that mirrors production, for testing migrations and
# role-gated behaviour without touching the live database.
#
# ── Why ──────────────────────────────────────────────────────────────────────
#
# Migrations here are applied by hand in the Supabase SQL editor, which means
# the first time one runs is against real data. Running 057 against a local
# cluster first caught four defects, one of which — CREATE POLICY has no
# IF NOT EXISTS, so a second application aborts — only appeared on the second
# run and could not have been found by reading it.
#
# It also makes RLS testable. The browser preview is signed out, so every
# contributor- and admin-gated path has been unverifiable locally for months;
# here a session picks its own identity and the REAL policies decide.
#
# ── Usage ────────────────────────────────────────────────────────────────────
#
#   scripts/localdb.sh up                 create, restore the newest dump, seed
#   scripts/localdb.sh migrate 057        apply migration(s) by number or path
#   scripts/localdb.sh psql --as admin    a shell as admin/contributor/user/anon
#   scripts/localdb.sh status             is it running, and what is in it
#   scripts/localdb.sh serve              serve it to the app: PostgREST + a local
#                                         sign-in, and .env.local pointing at them
#   scripts/localdb.sh unserve            stop serving; remove .env.local
#   scripts/localdb.sh env [checkout]     write .env.local into a checkout (default:
#                                         this one) — each worktree runs its own app
#   scripts/localdb.sh down               stop
#   scripts/localdb.sh reset              destroy and start over
#
# Dumps come from LocalDev/backup-evbench.command. They are public-schema only —
# no auth schema, so no emails and no session tokens — which is why this script
# has to supply the auth stub itself. See scripts/localdb-prelude.sql.

set -euo pipefail

# macOS ships a UTF-8 locale that initdb rejects with "postmaster became
# multithreaded during startup"; C is what works and nothing here is
# collation-sensitive.
export LC_ALL=C

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# LocalDev/ is git-ignored, so it exists only in the main checkout — a worktree
# has none. Its backups are found through the repository the worktree shares.
LOCALDEV="$REPO/LocalDev"
if [ ! -d "$LOCALDEV" ]; then
  LOCALDEV="$(dirname "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")/LocalDev"
fi
PORT="${EVBENCH_PG_PORT:-55432}"
DB="${EVBENCH_PG_DB:-evbench}"
PGDATA_DIR="${EVBENCH_PGDATA:-${TMPDIR:-/tmp}/evbench-localdb}"
# A unix socket path may not exceed 103 bytes, and the default TMPDIR on macOS
# is long enough to blow that on its own. Keep it short and predictable.
SOCK="${EVBENCH_PG_SOCKET:-/tmp/evbench-pg}"

# Serving the app (`serve`): PostgREST on one port, the Supabase stand-in the
# app talks to on another. Both on 127.0.0.1 only. The secret signs local test
# tokens and nothing else; it is not, and must never become, a real one.
API_PORT="${EVBENCH_API_PORT:-3998}"
PGRST_PORT="${EVBENCH_PGRST_PORT:-3999}"
JWT_SECRET='localdb-postgrest-secret-not-for-production-0123456789'

ADMIN_UID='00000000-0000-4000-a000-000000000001'
CONTRIB_UID='00000000-0000-4000-a000-000000000002'
VIEWER_UID='00000000-0000-4000-a000-000000000003'

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing $1 — brew install postgresql@18"; }

running() { pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1; }

psql_raw() { psql -h "$SOCK" -p "$PORT" -U postgres "$@"; }

newest_dump() {
  # -t sorts by mtime, so the newest backup is first — but "newest" and
  # "finished" are not the same thing. A dump still being written is the newest
  # file in the directory, and restoring one fails deep inside the process with
  # "input file is too short", which reads like a corrupt backup rather than a
  # race.
  #
  # The table of contents is not enough to ask whether the file is complete:
  # it is written first, so a dump cut off mid-data (a backup that stalled on
  # 2026-10-08) passes `pg_restore -l` and restores as an almost empty database
  # — 0 vehicles, no error. Reading the whole archive to /dev/null touches no
  # database and fails on a truncated one with "end of file".
  local f
  for f in $(ls -t "$LOCALDEV"/*.dump 2>/dev/null); do
    if pg_restore -f /dev/null "$f" >/dev/null 2>&1; then echo "$f"; return 0; fi
    warn "skipping $(basename "$f") — unreadable, still being written?"
  done
  return 1
}

start_cluster() {
  need initdb; need pg_ctl; need psql
  mkdir -p "$SOCK"
  if [ ! -d "$PGDATA_DIR/base" ]; then
    say "==> initdb $PGDATA_DIR"
    initdb -D "$PGDATA_DIR" -U postgres --auth=trust >/dev/null
  fi
  if running; then
    say "==> already running on port $PORT"
  else
    say "==> starting postgres on port $PORT"
    # listen_addresses='' keeps this on the unix socket only: a test database
    # holding a copy of production has no business accepting TCP.
    pg_ctl -D "$PGDATA_DIR" \
      -o "-p $PORT -k $SOCK -c listen_addresses=''" \
      -l "$PGDATA_DIR/postgres.log" start >/dev/null
    sleep 2
  fi
}

cmd_up() {
  start_cluster
  local dump; dump="$(newest_dump || true)"
  [ -n "$dump" ] || die "no dump in LocalDev/ — run ./LocalDev/backup-evbench.command first"

  if psql_raw -lqt | cut -d\| -f1 | grep -qw "$DB"; then
    warn "database '$DB' already exists — use 'reset' to rebuild it from the dump"
    cmd_status
    return
  fi

  say "==> creating $DB"
  psql_raw -q -c "CREATE DATABASE $DB;"

  say "==> auth stub and roles (before the restore, so policies and FKs resolve)"
  psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO/scripts/localdb-prelude.sql"

  # Restored in three phases so the foreign key from profiles to auth.users can
  # be satisfied. pg_restore does pre-data, then data, then constraints; the FK
  # is validated in that last phase against an auth.users the dump cannot
  # populate, because the dump deliberately excludes the auth schema. So the
  # rows are backfilled in between.
  say "==> restoring $(basename "$dump") (schema + data)"
  pg_restore -h "$SOCK" -p "$PORT" -U postgres -d "$DB" \
    --no-owner --section=pre-data --section=data "$dump" \
    2>"$PGDATA_DIR/restore.log" || true

  say "==> backfilling auth.users from restored profiles"
  psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO auth.users (id) SELECT id FROM public.profiles ON CONFLICT DO NOTHING;"

  say "==> restoring constraints and indexes"
  pg_restore -h "$SOCK" -p "$PORT" -U postgres -d "$DB" \
    --no-owner --section=post-data "$dump" \
    2>>"$PGDATA_DIR/restore.log" || true

  # Tables created by migrations applied AFTER this dump was taken have no
  # grants of their own. In production Supabase's default privileges cover them;
  # here the prelude sets the same defaults, and this sweeps up anything the
  # dump created before those defaults existed.
  say "==> granting table access to anon/authenticated (RLS still decides)"
  psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 <<'GRANTS'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
    TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
GRANTS

  say "==> seeding one user per role"
  psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO/scripts/localdb-seed.sql"

  local errs; errs="$(grep -ci "error:" "$PGDATA_DIR/restore.log" 2>/dev/null || echo 0)"
  [ "$errs" -gt 0 ] && warn "restore reported $errs error(s) — $PGDATA_DIR/restore.log"

  cmd_status
}

# Every signed-in role maps to `authenticated`; only anonymous is `anon`. That
# mirrors Supabase, where the app role lives in `profiles` and Postgres only
# distinguishes signed-in from not.
dbrole_for() {
  case "${1:-anon}" in
    anon|"") echo "anon" ;;
    *)       echo "authenticated" ;;
  esac
}

uid_for() {
  case "${1:-anon}" in
    admin)       echo "$ADMIN_UID" ;;
    contributor) echo "$CONTRIB_UID" ;;
    user|viewer) echo "$VIEWER_UID" ;;
    anon|"")     echo "" ;;
    *) die "unknown role '$1' (admin | contributor | user | anon)" ;;
  esac
}

cmd_psql() {
  local as="anon"
  if [ "${1:-}" = "--as" ]; then as="${2:-anon}"; shift 2; fi
  running || die "not running — scripts/localdb.sh up"
  local uid; uid="$(uid_for "$as")"
  local dbrole; dbrole="$(dbrole_for "$as")"
  # Two settings, and BOTH are required.
  #
  # `test.user_id` is who the policies think you are. `role` is who Postgres
  # thinks you are, and without it this tests nothing at all: the connection is
  # made as `postgres`, a superuser, and **superusers bypass RLS entirely**.
  # Every policy silently evaluates to true, a denied write appears to succeed,
  # and the tool reports that a permission check passed when it never ran.
  #
  # Switching to anon/authenticated — the same unprivileged roles PostgREST
  # uses — is what puts the real policies in the path.
  PGOPTIONS="-c role=$dbrole -c test.user_id=$uid" \
    psql -h "$SOCK" -p "$PORT" -U postgres -d "$DB" "$@"
}

cmd_migrate() {
  running || die "not running — scripts/localdb.sh up"
  [ $# -gt 0 ] || die "usage: localdb.sh migrate <number|path> [...]  e.g. migrate 057"
  for arg in "$@"; do
    local file="$arg"
    if [ ! -f "$file" ]; then
      file="$(ls "$REPO"/supabase/migrations/"${arg}"_*.sql 2>/dev/null | head -1 || true)"
    fi
    [ -n "$file" ] && [ -f "$file" ] || die "no migration matching '$arg'"
    say "==> $(basename "$file")"
    # ON_ERROR_STOP so a broken migration fails loudly here rather than half
    # applying, which is the entire point of trying it locally first.
    psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 -f "$file"
  done
  say "ok"
}

cmd_status() {
  if ! running; then say "stopped"; return; fi
  local tables rows
  tables="$(psql_raw -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo '?')"
  say "running  socket=$SOCK  port=$PORT  db=$DB  tables=$tables"
  psql_raw -d "$DB" -tAc \
    "SELECT '  ' || p.role || '  ' || p.id FROM public.profiles p
      WHERE p.id::text LIKE '00000000-0000-4000-a000-%' ORDER BY p.role" 2>/dev/null || true
  if pid_alive "$PGDATA_DIR/auth-proxy.pid"; then
    say "serving  http://localhost:$API_PORT  (PostgREST 127.0.0.1:$PGRST_PORT)"
  else
    echo "  not serving — scripts/localdb.sh serve"
  fi
  cat <<EOS

  psql as a role:   scripts/localdb.sh psql --as contributor
  inside psql:      SET test.user_id = '$ADMIN_UID';   -- or RESET for anonymous
  apply a migration: scripts/localdb.sh migrate 057
EOS
}

# ── Serving the app ─────────────────────────────────────────────────────────
#
# The standard way to test anything that changes the database or needs a
# privileged role (CLAUDE.md): restore the newest backup (`up`), apply the
# migrations under test (`migrate`), then `serve` — and run the app against it.
# Signing in opens a local page offering the three seeded users, and the real
# RLS policies decide what each may do. Left running between sessions unless
# the owner says otherwise.

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# Whatever already listens on a port. A second `serve` must adopt it rather than
# start another copy: the copy fails to bind, exits, and its pid would replace
# the live one in the .pid file — found 2026-10-10, when status said "not
# serving" over a stand-in that had been answering for a day.
listener_pid() { { lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | head -1; }

mint_token() {   # mint_token <role> [sub] — a long-lived local test JWT
  LOCALDB_JWT_SECRET="$JWT_SECRET" node -e '
    const c = require("crypto"); const [role, sub] = process.argv.slice(1);
    const b = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b({ alg: "HS256", typ: "JWT" });
    const p = b({ role, ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
    console.log(`${h}.${p}.${c.createHmac("sha256", process.env.LOCALDB_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`);
  ' "$@"
}

# .env.local in this checkout, pointing the dev server at the stand-in. Vite
# reads it over .env; delete it (or `unserve`) to point back at production.
cmd_env() {
  local dir="${1:-$REPO}"
  [ -d "$dir" ] || die "no such checkout: $dir"
  local anon; anon="$(mint_token anon)"
  cat > "$dir/.env.local" <<ENV
# Written by scripts/localdb.sh serve — the app reads the LOCAL database, not
# production. \`scripts/localdb.sh unserve\` (or deleting this file) undoes it.
# Restart the dev server after it changes; Vite reads env only at startup.
VITE_SUPABASE_URL=http://localhost:$API_PORT
VITE_SUPABASE_ANON_KEY=$anon
ENV
  say "==> wrote $dir/.env.local (restart the dev server to pick it up)"
}

cmd_serve() {
  running || die "not running — scripts/localdb.sh up"
  need node
  command -v postgrest >/dev/null 2>&1 || die "missing postgrest — brew install postgrest"

  # Signing in through the API: PostgREST verifies the token and puts its
  # claims in request.jwt.claims, so auth.uid() reads `sub` from there as well
  # as from test.user_id. Re-applied here so a database restored before this
  # existed gets it too.
  PGOPTIONS='-c client_min_messages=warning' \
    psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO/scripts/localdb-prelude.sql" >/dev/null
  psql_raw -q -d "$DB" -v ON_ERROR_STOP=1 <<'GRANTS'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
GRANTS

  local conf="$PGDATA_DIR/postgrest.conf"
  cat > "$conf" <<CONF
db-uri = "postgres://postgres@/$DB?host=$SOCK&port=$PORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
CONF
  local held
  held="$(listener_pid "$PGRST_PORT")"
  [ -n "$held" ] && ! pid_alive "$PGDATA_DIR/postgrest.pid" && echo "$held" > "$PGDATA_DIR/postgrest.pid"
  held="$(listener_pid "$API_PORT")"
  [ -n "$held" ] && ! pid_alive "$PGDATA_DIR/auth-proxy.pid" && echo "$held" > "$PGDATA_DIR/auth-proxy.pid"

  if pid_alive "$PGDATA_DIR/postgrest.pid"; then
    kill -USR1 "$(cat "$PGDATA_DIR/postgrest.pid")" 2>/dev/null || true   # reload the schema cache
    say "==> PostgREST already serving on 127.0.0.1:$PGRST_PORT (schema reloaded)"
  else
    nohup postgrest "$conf" > "$PGDATA_DIR/postgrest.log" 2>&1 &
    echo $! > "$PGDATA_DIR/postgrest.pid"
    say "==> PostgREST on 127.0.0.1:$PGRST_PORT"
  fi
  if pid_alive "$PGDATA_DIR/auth-proxy.pid"; then
    say "==> stand-in already on http://localhost:$API_PORT"
  else
    LOCALDB_JWT_SECRET="$JWT_SECRET" LOCALDB_API_PORT="$API_PORT" LOCALDB_PGRST_PORT="$PGRST_PORT"       nohup node "$REPO/scripts/localdb-auth-proxy.mjs" > "$PGDATA_DIR/auth-proxy.log" 2>&1 &
    echo $! > "$PGDATA_DIR/auth-proxy.pid"
    say "==> stand-in on http://localhost:$API_PORT (data + local sign-in)"
  fi
  sleep 1
  curl -sf "http://localhost:$API_PORT/rest/v1/" -o /dev/null -H "apikey: x"     || warn "the API did not answer yet — see $PGDATA_DIR/postgrest.log and auth-proxy.log"
  cmd_env
  cat <<EOS

  Run the app as usual (npm run dev / the preview). Sign in opens a local page:
  pick Local admin, contributor or viewer — no real accounts are involved.
  Stop with: scripts/localdb.sh unserve
EOS
}

cmd_unserve() {
  for f in postgrest auth-proxy; do
    pid_alive "$PGDATA_DIR/$f.pid" && kill "$(cat "$PGDATA_DIR/$f.pid")" && say "stopped $f"
    rm -f "$PGDATA_DIR/$f.pid"
  done
  if [ -f "$REPO/.env.local" ] && grep -q "localdb.sh serve" "$REPO/.env.local"; then
    rm "$REPO/.env.local" && say "removed .env.local — restart the dev server to point back at production"
  fi
}

cmd_down()  { cmd_unserve; running && pg_ctl -D "$PGDATA_DIR" stop >/dev/null && say "stopped" || say "not running"; }
cmd_reset() { cmd_unserve; running && pg_ctl -D "$PGDATA_DIR" stop >/dev/null 2>&1 || true; rm -rf "$PGDATA_DIR" "$SOCK"; say "removed $PGDATA_DIR"; cmd_up; }

case "${1:-help}" in
  up)      shift; cmd_up "$@" ;;
  down)    shift; cmd_down "$@" ;;
  reset)   shift; cmd_reset "$@" ;;
  psql)    shift; cmd_psql "$@" ;;
  migrate) shift; cmd_migrate "$@" ;;
  status)  shift; cmd_status "$@" ;;
  serve)   shift; cmd_serve "$@" ;;
  unserve) shift; cmd_unserve "$@" ;;
  env)     shift; cmd_env "$@" ;;
  *) sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
