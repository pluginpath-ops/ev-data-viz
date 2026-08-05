# Database Schema

Supabase (PostgreSQL) backend for EV Data Visualization.

---

## Tables

### `profiles`

One row per authenticated user. Created automatically by the `on_auth_user_created` trigger.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `uuid` | — | FK → `auth.users.id` (PK) |
| `is_owner` | `boolean` | `false` | **Deprecated** — superseded by `role`. Keep until fully removed. |
| `role` | `text` | `'user'` | `CHECK (role IN ('admin','contributor','user'))` |

**Trigger:** `on_auth_user_created` calls `handle_new_user()` after every insert on `auth.users`, inserting a `profiles` row with `role = 'user'` (ON CONFLICT DO NOTHING so manual bootstrapping survives).

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (new.id, 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

### `vehicles`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `bigint` | auto | PK |
| `user_id` | `uuid` | — | FK → `auth.users.id`. Owner of the record. NULL on pre-RBAC rows. |
| `name` | `text` | — | Display name |
| `make` | `text` | — | |
| `model` | `text` | — | |
| `year` | `text` | — | |
| `battery` | `numeric` | — | kWh |
| `range` | `numeric` | — | EPA miles |
| `power` | `numeric` | — | Peak kW |
| `visibility` | `text` | `'private'` | `'public'` or `'private'`. New vehicles always default to `'private'`. |
| `image_url` | `text` | — | Card background image (Supabase Storage) |
| `sort_order` | `integer` | — | Manual drag-to-reorder position |
| `specs` | `jsonb` | `NULL` | Structured vehicle specifications (see below) |
| `flagged_specs` | `text[]` | `'{}'` | Field keys flagged as potentially inaccurate by public users (e.g. `['powertrain.horsepower_hp']`). Append-only via `flag_spec_field` RPC; cleared by `unflag_spec_field` (admin only). |
| `created_at` | `timestamptz` | `now()` | |

> **`specs` JSONB structure:** Each category key maps to an object of predefined field keys plus `_custom` (user-defined key-value pairs). Categories: `pricing`, `powertrain`, `compute`, `infotainment`, `dimensions`, `wheels`, `suspension`, `lighting`, `charging`, `interior`. See `src/utils/vehicleSpecSchema.js` for the full field list. `specs = NULL` means no specs entered yet — handled gracefully by all UI components.
>
> ```json
> { "powertrain": { "motors": 2, "motor_type": "Permanent Magnet", "_custom": { "gear_ratio": "9.73:1" } } }
> ```

> **Note:** Vehicles created before `user_id` tracking was added will have `user_id = NULL`. Only admins can edit/delete them until ownership is assigned:
> ```sql
> UPDATE public.vehicles SET user_id = '<admin-uuid>' WHERE user_id IS NULL;
> ```

---

### `runs`

One charging or range test session per vehicle.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `bigint` | auto | PK |
| `vehicle_id` | `bigint` | — | FK → `vehicles.id` |
| `name` | `text` | — | |
| `date` | `text` | — | ISO date string. **NOT NULL** — inserts must supply it |
| `color` | `text` | `'#3b82f6'` | Chart series color |
| `is_default` | `boolean` | `false` | |
| `synthetic` | `boolean` | `false` | True for estimated/simulated data |
| `kind` | `text` | — | `'charging'` \| `'range'`. Test role discriminator. Derived from the two booleans below by trigger `trg_runs_sync_kind`; see migration 044 |
| `has_charging` | `boolean` | `true` | **Superseded by `kind`** — still written, no longer read. Dropped in #155 |
| `has_range` | `boolean` | `false` | **Superseded by `kind`** — still written, no longer read. Dropped in #155 |
| `session_id` | `bigint` | `NULL` | FK → `test_sessions.id` ON DELETE SET NULL. Advisory grouping; never required |
| `paired_range_run_id` | `bigint` | `NULL` | FK → `runs.id` ON DELETE SET NULL. Curator-set default range partner for a charging run |
| `software_version` | `text` | — | |
| `conditions` | `text` | — | Freeform notes |
| `source` | `text` | — | URL to source video/post |
| `url` | `text` | — | Range test source link |
| `charging_url` | `text` | — | Charging test source link |
| `start_soc` | `numeric` | — | % |
| `end_soc` | `numeric` | — | % |
| `speed_mph` | `numeric` | — | |
| `distance_miles` | `numeric` | — | |
| `energy_kwh` | `numeric` | — | |
| `temperature_f` | `numeric` | — | |
| `elevation_gain_ft` | `numeric` | — | |
| `trim_id` | `bigint` | `NULL` | FK → `trims.id` ON DELETE SET NULL. Which trim/wheel/tire config was used for this test. |
| `populated_fields` | `text[]` | — | Which data columns have values: `['soc','chargeRate','time','range','temperature']` |
| `calculated_fields` | `text[]` | — | Fields computed rather than measured |
| `created_at` | `timestamptz` | `now()` | |

> Runs have no `user_id`. Ownership and edit permission are inherited from the parent vehicle via RLS subquery joins.

---

### `test_sessions`

One testing outing — the runs measured during it share weather, route and afternoon. Added by migration 044 as groundwork for charging/range pairing (#150).

**No `vehicle_id` by design:** a session can span several vehicles (three cars driven side by side on one loop is a single outing, and shared conditions are the whole point of grouping them). Each run carries its own `vehicle_id`, so one session's runs may belong to different vehicles.

Distinct from `performance_sessions` (migration 036), which is one vehicle's accel/braking outing and shares none of these columns.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `bigint` | auto | PK |
| `name` | `text` | — | Human label, e.g. "Ottawa winter loop". Doubles as the short chart label for a pair whose halves both come from this session |
| `tested_at` | `timestamp` | — | Wall-clock at the test site; zone-less, as sources report local time with no offset |
| `tester` | `text` | — | |
| `location_name` | `text` | — | |
| `temperature_f` | `numeric` | — | Session-level reading. `runs.temperature_f` stays authoritative per row; congruence checks prefer this when present |
| `source_name` | `text` | — | |
| `url` | `text` | — | |
| `notes` | `text` | — | |
| `created_at` | `timestamptz` | `now()` | |

---

### `data_points`

Individual time-series frames within a run.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` | PK |
| `run_id` | `bigint` | FK → `runs.id` |
| `frame` | `integer` | Sequential index within the run |
| `timestamp` | `timestamptz` | Wall-clock time (optional) |
| `soc` | `numeric(5,1)` | State of charge 0–100% |
| `charge_rate` | `numeric(8,2)` | kW |
| `time_value` | `numeric(8,1)` | Minutes or seconds |
| `range_value` | `numeric(8,1)` | Miles or km |
| `temperature` | `numeric(6,1)` | °C or °F |

---

### `tags`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` | PK |
| `name` | `text` | Unique |

### `vehicle_tags`

| Column | Type | Notes |
|--------|------|-------|
| `vehicle_id` | `bigint` | FK → `vehicles.id` |
| `tag_id` | `bigint` | FK → `tags.id` |

---

### `trims`

Named trim configurations for a vehicle (e.g. different wheel/tire packages).

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `bigint` | auto | PK |
| `vehicle_id` | `bigint` | — | FK → `vehicles.id` ON DELETE CASCADE |
| `name` | `text` | — | e.g. "Long Range AWD 19\"" |
| `wheel_size` | `text` | `NULL` | e.g. "19 inch" |
| `tire_size` | `text` | `NULL` | e.g. "255/45R19" |
| `epa_range_miles` | `numeric` | `NULL` | EPA-rated range for this trim in miles |
| `created_at` | `timestamptz` | `now()` | |

RLS mirrors `runs`: SELECT when parent vehicle is visible; INSERT/UPDATE/DELETE when vehicle is owned by user or role is `admin`/`contributor`. See `migrations/004_vehicle_trims.sql`.

---

### `votes`

Public vote records for accuracy vouching (👍) and run flagging (🚩). Deduplicated by `browser_token` (UUID stored in `localStorage`).

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | `bigint` | auto | PK |
| `target_type` | `text` | — | `'vehicle_specs'` or `'run'` |
| `target_id` | `bigint` | — | `vehicle_id` or `run_id` depending on `target_type` |
| `vote_type` | `text` | — | `'vouch'` or `'flag'` |
| `browser_token` | `uuid` | — | Client-side identity (from `localStorage`) |
| `created_at` | `timestamptz` | `now()` | |

**Unique constraint:** `(browser_token, target_type, target_id)` — one vote per browser per target.
RLS: SELECT/INSERT/DELETE open to all (including anonymous). No UPDATE — change vote by DELETE + INSERT.

> Spec field flags are stored separately on `vehicles.flagged_specs` (see above) as a simple set, not in this table.

---

### `site_settings`

Key-value store for global site configuration.

| Column | Type | Notes |
|--------|------|-------|
| `key` | `text` | PK |
| `value` | `text` | |

Current keys: `header_image_url`

Written via the `update_site_setting(key, value)` RPC (SECURITY DEFINER, admin-only).

---

## Storage Buckets

| Bucket | Public | Notes |
|--------|--------|-------|
| `vehicle-images` | Yes | Card background images. Path: `{vehicleId}.{ext}` |
| `site-assets` | Yes | Site-wide assets. Path: `header_image.{ext}` |

---

## Functions (RPCs)

All functions are in the `public` schema and callable via `supabase.rpc(name, args)`.

### `current_user_role() → text`

Returns the `role` of the currently authenticated user from `profiles`. Declared `STABLE` so PostgreSQL can cache the result within a single query — used inside RLS policies to avoid a per-row subquery.

```sql
CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;
```

---

### `get_admin_users() → table`

Returns all registered users with their roles. **Admin-only** (raises exception otherwise). Requires `SECURITY DEFINER` to read `auth.users`.

Returns: `id uuid, email text, created_at timestamptz, role text`

---

### `set_user_role(target_user_id uuid, new_role text) → void`

Updates a user's role. **Admin-only**. Validates that `new_role` is one of `'admin'`, `'contributor'`, `'user'`.

---

### `update_site_setting(setting_key text, setting_value text) → void`

Upserts a row in `site_settings`. Admin-only SECURITY DEFINER function used because direct upsert on `site_settings` hits a double-RLS issue (INSERT + ON CONFLICT UPDATE).

---

### `merge_run_data_points(p_run_id, p_join_key, p_rows) → json`

Merges new data points into an existing run using a set-based UPDATE + INSERT. Join key is `'soc'` or `'time'`. Returns `{ updated: N, inserted: M }`.

---

### `replace_run_data_points(p_run_id, p_rows) → void`

Deletes all existing data points for a run and inserts the new set. Used when replacing data wholesale (e.g. re-uploading a CSV).

---

## Row-Level Security

RLS is enabled on `vehicles`, `runs`, `trims`, `votes`, and `site_settings`.

### `vehicles`

| Operation | Allowed when |
|-----------|-------------|
| SELECT | `visibility = 'public'` OR `user_id = auth.uid()` OR role is `admin`/`contributor` |
| INSERT | Any authenticated user (`auth.uid() IS NOT NULL`) |
| UPDATE | `user_id = auth.uid()` OR role is `admin`/`contributor` |
| DELETE | `user_id = auth.uid()` OR role is `admin` |

### `runs`

Runs inherit ownership from their parent vehicle via subquery join.

| Operation | Allowed when |
|-----------|-------------|
| SELECT | Parent vehicle is visible (same SELECT rule as vehicles) |
| INSERT | Parent vehicle is owned by user OR role is `admin`/`contributor` |
| UPDATE | Parent vehicle is owned by user OR role is `admin`/`contributor` |
| DELETE | Parent vehicle is owned by user OR role is `admin` |

---

### `test_sessions`

Has no parent vehicle to inherit from (a session may span several), so it carries its own policies — the same shape as `manufacturers`.

| Operation | Allowed when |
|-----------|-------------|
| SELECT | Always (public read) |
| INSERT | Role is `admin`/`contributor` |
| UPDATE | Role is `admin`/`contributor` |
| DELETE | Role is `admin` |

---

## Migrations

| File | Description |
|------|-------------|
| `migrations/001_rbac.sql` | Add `profiles.role`, RBAC helper functions, rebuild RLS on vehicles + runs |
| `migrations/002_fix_get_admin_users.sql` | Backfill `profiles` rows for pre-existing auth users; fix `get_admin_users()` to use LEFT JOIN so users without a profile row still appear |
| `migrations/003_vehicle_specs.sql` | Add `specs jsonb` column to `vehicles` for structured vehicle specifications |
| `migrations/004_vehicle_trims.sql` | Add `trims` table for named vehicle trim configurations (wheel/tire size) |
| `migrations/005_votes.sql` | Add `votes` table (vouch/flag counts), `flagged_specs text[]` on vehicles, and `flag_spec_field` / `unflag_spec_field` RPCs |
| `migrations/006_run_trim_link.sql` | Add `runs.trim_id` FK to trims, add `trims.epa_range_miles` for per-trim EPA range |

### Applying migrations

Supabase does not auto-apply files in `supabase/migrations/` unless you use the Supabase CLI with a linked project. For now, **paste each file's contents into the Supabase SQL Editor** and run it.

### Bootstrap checklist (first deploy)

1. Run `001_rbac.sql` in the SQL Editor
2. Verify the `on_auth_user_created` trigger exists (create it if not — SQL above)
3. Set the first admin:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE id = '<your-uuid>';
   ```
4. Assign ownership of pre-RBAC vehicles:
   ```sql
   UPDATE public.vehicles SET user_id = '<admin-uuid>' WHERE user_id IS NULL;
   ```
5. *(Future)* Drop the deprecated `is_owner` column once confirmed stable:
   ```sql
   ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_owner;
   ```
