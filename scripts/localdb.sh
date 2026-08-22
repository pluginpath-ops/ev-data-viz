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
PORT="${EVBENCH_PG_PORT:-55432}"
DB="${EVBENCH_PG_DB:-evbench}"
PGDATA_DIR="${EVBENCH_PGDATA:-${TMPDIR:-/tmp}/evbench-localdb}"
# A unix socket path may not exceed 103 bytes, and the default TMPDIR on macOS
# is long enough to blow that on its own. Keep it short and predictable.
SOCK="${EVBENCH_PG_SOCKET:-/tmp/evbench-pg}"

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
  # race. pg_restore -l parses the archive's table of contents without touching
  # the database, so it is a cheap way to ask whether the file is complete.
  local f
  for f in $(ls -t "$REPO"/LocalDev/*.dump 2>/dev/null); do
    if pg_restore -l "$f" >/dev/null 2>&1; then echo "$f"; return 0; fi
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
  cat <<EOS

  psql as a role:   scripts/localdb.sh psql --as contributor
  inside psql:      SET test.user_id = '$ADMIN_UID';   -- or RESET for anonymous
  apply a migration: scripts/localdb.sh migrate 057
EOS
}

cmd_down()  { running && pg_ctl -D "$PGDATA_DIR" stop >/dev/null && say "stopped" || say "not running"; }
cmd_reset() { running && pg_ctl -D "$PGDATA_DIR" stop >/dev/null 2>&1 || true; rm -rf "$PGDATA_DIR" "$SOCK"; say "removed $PGDATA_DIR"; cmd_up; }

case "${1:-help}" in
  up)      shift; cmd_up "$@" ;;
  down)    shift; cmd_down "$@" ;;
  reset)   shift; cmd_reset "$@" ;;
  psql)    shift; cmd_psql "$@" ;;
  migrate) shift; cmd_migrate "$@" ;;
  status)  shift; cmd_status "$@" ;;
  *) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
