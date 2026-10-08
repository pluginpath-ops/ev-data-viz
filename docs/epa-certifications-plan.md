# #374 step 2 — EPA test vehicles and their certifications: plan

Status: **plan only, nothing built.** Revised 2026-10-08 after the owner's
answers on naming (N1–N7) and decisions (D1–D6). Step 1, the older-over-newer
guard in `planGroupImport`, is PR #400 and is not touched here; this stack
starts after it merges.

## The model

What we called a "test group" was never EPA's Test Group. EPA's **Test Group**
(`RHYXV00.0301`) is the **certification**: one filing, one model year (the
year is its first letter). Our `epa_test_groups` row is the **EPA test
vehicle** — the physical car in the lab, keyed by EPA's **Vehicle ID**. The two
are many-to-many: one Test Group covers several test vehicles (183 of the 459
corpus files name two or more Vehicle IDs, one names 15), and one test vehicle
appears in several years' Test Groups (157 do).

| Table | One row per | Holds |
|---|---|---|
| `epa_test_vehicles` (renamed from `epa_test_groups`) | Vehicle ID | the lab record: coefficients, tests, phases, curator values; **Since MY…** derived |
| `epa_certifications` (new) | Test Group — so exactly one model year | model year, document date, source file, Recertified, **Basis**, **covered models** |
| `epa_certification_test_vehicles` (new) | test vehicle in one certification | carryover origin (Test Group + year), **Guide link**, skip |

- Anything spanning years lives on the test vehicle and is **derived**:
  "Since MY2023" (the first year it appears in a certification — the anchor
  the owner asked for) and "MY2023 to MY2025".
- The **Guide link** sits on the test vehicle's row in one certification. Not
  on the certification itself: the Guide lists a row per configuration, and
  when one Test Group covers two test vehicles each matches different Guide
  rows (Ioniq 5 `RHYXV00.0W41`: two Vehicle IDs, two configurations).
- Covered models are certificate-wide, so they move to the certification
  instead of being copied onto every test vehicle in the file.
- A Vehicle ID is a sound key: the one ID found under two manufacturer codes
  (`PRU 004`, ELMS 2022 → Mullen 2024, Test Group suffix `046D` both years) is
  the same rebadged van.

## Names (settled)

| Thing | Name | UI | Replaces |
|---|---|---|---|
| The physical car EPA tested | **EPA test vehicle** — never a bare "vehicle", which is an EVBench vehicle | "Test vehicle", its id "Vehicle ID" | "test group", "certification group", "cert group" for this record |
| EPA's identifier for one year's filing | **Test Group** — the **certification** | "Test Group" | `epa_test_family_id` (a misnomer: EPA's test family is something else) |
| The certification row | **certification record** where "record" is needed for precision | — | "certification" meaning the lab record (Certification Statistics, `epaCertStats`, "211 certifications…" comments) |
| A test vehicle's first year in a certification | **Since** | "Since MY2023" | "first year tested" (would collide with "EPA tested" and "Tested") |
| Its years | **the years** | "MY2023 to MY2025"; a gap is written out: "MY2022, MY2024 to MY2025" (4 Vehicle IDs skip a year) | — |
| Figures or a certification standing in from another year | **From MY…** | "From MY2024" — matches the vocabulary's existing "from <platform>" for provided values | "flag", which the vocabulary keeps for the community accuracy signal |
| How a certification record came to exist | **Basis**: `csi` (a CSI file), `csv` (the Test Car List import), `guide` (made from a Guide link), `manual` | — | — |
| The same Test Group filed again, changed or not | **Recertified** | "Recertified 2024-03-05" | "revised", which implies a difference |

**The three EPA sources, named by where the data comes from** (owner,
2026-10-08). Every EPA figure says which of these it is from; a tab or a
heading names the source, and its description names the unit it counts.

| Source | Name | Short | One per | Tables |
|---|---|---|---|---|
| The Fuel Economy Guide — what is printed on the window sticker | **EPA Label** — EPA's own name for it, and the word the data, the columns (`label_*`) and the vocabulary already use. "Window sticker" may gloss it once in an explainer | label | configuration (a Guide row) | `epa_fe_guide` |
| A CSI filing — one Test Group, one model year | **EPA Certification** | cert | Test Group | `epa_certifications` |
| The car in the lab, inside a certification | **EPA test vehicle** | test vehicle | Vehicle ID | `epa_test_vehicles` |

- "Fuel Economy Guide" stays the name of the *file* EPA Label data is imported
  from (Admin's import, `feGuide*` code, `epa_fe_guide`); "EPA Label" is the
  data. That is one name per thing, not two.
- **Certification data** is anything read from a CSI document, including the
  lab results stored on the test vehicle.
- Tabs follow the rule, so neither changes name: **Label Statistics** (EPA
  Label data, one point per configuration) and **Certification Statistics**
  (certification data, one point per EPA test vehicle) — the unit goes in each
  tab's description. `epaCertStats` keeps its name; the earlier N1 rename of
  this tab is withdrawn.
- "EPA Label" is capitalised as a proper noun in UI text, so it never reads as
  a form or nav label. The 13 places that say "sticker" or "window sticker"
  become "EPA Label" in layer 1.
- **A test vehicle's row in one certification** gets no noun of its own:
  prose says "the test vehicle's certification".

## The owner's hard constraint, answered

**A vehicle resolves to a certification automatically: 0 of 119 mappings, and
0 of 50 primary configurations, fail to resolve.** Nothing is silent, nothing
asks a curator to pick, and no group-level fallback is needed. This holds
because the backfill keeps a certification for every existing Guide link (D1).

### The resolution rule

Inputs: the EVBench vehicle's `year` (a single year or a range like
`2022-2024`; all 109 parse today) and its configuration's test vehicle's
certifications.

1. **Exact** — a certification in one of the vehicle's years. Several → the
   newest; a tie → the one with a Guide link. A range with uncertified years
   is still exact, shown as "Certified MY2025 of 2025–2026".
2. **Carryover** — no exact year, but a certification's carryover origin is one
   of the vehicle's years → "From MY2026, carrying over MY2025".
3. **Nearest year** — otherwise, the nearest, ties to the newer → "From MY2024".
   2+ years off also raises a **Data Checks** finding: on the live data those
   are mapping mistakes (a 2022 Mach-E mapped to 2024–2026 configurations).
4. **Two certifications in one year for one test vehicle** (2 test vehicles,
   3 years in the corpus, 0 mapped): the one whose covered models name the
   vehicle's model, else the newest document date, marked. Never a picker.

Then the **Guide figures**: the resolved certification's link; if it has none,
the nearest linked year for the same test vehicle → "From MY…". None at all →
no Guide figures, as today.

### Measured outcome (2026-10-07 backup + the 459-file corpus)

Primary configurations (the vehicle's own EPA figures), 50 vehicles:

| | backfill only | after corpus re-import |
|---|---|---|
| Exact | 23 | 24 |
| Exact, range partly certified (shown) | 10 | 10 |
| Carryover (From MY…) | 1 | 0 |
| 1 year off (From MY…) | 12 | 12 |
| 2+ years off (From MY… + Data Checks) | 4 | 4 |
| **Not resolved** | **0** | **0** |
| Guide figures from the resolved certification | 40 | 40 |
| Guide figures From another year | 7 | 7 |
| No Guide link on the test vehicle (as today) | 3 | 3 |

All 119 mappings: 62 exact, 13 partly certified, 44 From MY…, **0
unresolved**. **No vehicle changes the Guide row it reads** — the 7 that today
show another year's figures without saying so start saying "From MY…".

Importing MY2026–27 CSI files, not re-importing 2021–25, is what turns
"From MY…" into exact: mapped vehicles are mostly MY2025–27.

## Findings behind the design

1. **104 of 794 records hold a mixed identity** — `model_year` disagrees with
   the year letter of their own Test Group (`NE-U568EA011A-0`: `SHYXV00.0W00`
   = 2025, `model_year` 2026, file `CSI-THYXV00.0W00`). The backfill takes the
   year from the Test Group's letter, which all 1,175 Guide rows agree with.
2. **Only 164 of 324 Guide links match the record's current year + Test
   Group.** Matching on the *Guide row's own* year and Test Group attaches
   198 exactly, 41 by year (the Guide carries a sibling Test Group — Toyota
   `D14` vs `D11`), and needs 85 rows of Basis `guide` (D1).
3. **Guide values are copied onto the record** (`feGuidePromotion.js`: 255
   records, 3,811 entries). One row cannot hold one link per year; Guide
   figures are read at render time from the resolved link, and the copies
   are demoted (layer 3).
4. **Production holds one source file per test vehicle**, so the SQL backfill
   seeds 475 certifications / 943 test-vehicle rows (140 test vehicles with
   2+ years). Re-importing the corpus through the new importer brings that to
   589 / 1,135 (266 with 2+ years). 15 Test Groups were Recertified in the
   corpus (two filings); the backfill sees 2.
5. **The parser skips the document date** (drops the `Date:` footer). Layer 2
   reads it; Recertified needs it.
6. **The Guide key match gets sharp.** `exactTestGroupMatches` compares the
   Guide's Test Group with our *Vehicle ID* — the confusion the rename fixes —
   so it only ever matched the 3 hand-made records whose ID is a Test Group.
   Per certification, (year, Test Group) finds exactly one Guide row for 163 of
   809 unlinked rows after re-import, several for 361 (262 proposed by the
   existing ranker), none for 241.
7. `preferred_test_number` is null on every record, so moving links does not
   have to choose between years' test selections yet.

## The rename, all the way down

Measured on `main` at 4dee5cf and the 2026-10-07 backup. It is mechanical but
large, so it is its own layer, first, with no change in behavior, so every
later layer is written in the right words.

### Database (migration 081)

| Object | Now | After |
|---|---|---|
| Table | `epa_test_groups` | `epa_test_vehicles` |
| Its key | `test_group_id` | `test_vehicle_id` |
| Foreign keys | `epa_coefficient_sets`, `epa_tests`, `epa_covered_models`, `epa_field_audit` `.test_group_id`; `epa_vehicle_mappings.epa_test_group_id` | `.test_vehicle_id` throughout |
| Test Group on the record (until layer 4 retires it) | `epa_test_family_id`, `carryover_test_group_id` | `test_group`, `carryover_test_group` |
| Constraints | `epa_test_groups_pkey`, `_fe_guide_row_id_fkey` (named in a PostgREST embed hint), `_label_method_check`, two override checks; `epa_coefficient_sets_test_group_id_category_key`/`_fkey`; `epa_tests_test_group_id_fkey`; `epa_covered_models_test_group_id_fkey`; `epa_vehicle_mappings_epa_test_group_id_fkey`, `…_vehicle_id_epa_test_group_id_key` | `epa_test_vehicles_…`, `…_test_vehicle_id_…` |
| Indexes | `idx_epa_groups_awaiting_fe_link`, `idx_epa_groups_fe_guide_row`, `idx_epa_coeff_sets_group`, `idx_covered_models_group`, `idx_epa_tests_group`, `idx_epa_audit_group` | `…_test_vehicle…` |
| Policies | 4 on `epa_test_groups` ("Public read epa_test_groups" …) | `ALTER POLICY … RENAME TO` with the new table name |
| Trigger | `trg_clear_fe_skip_on_link` on the table | moves with the table; dropped in layer 4 when the link leaves |
| Functions | `ensure_single_primary_epa_mapping`, `promote_sole_epa_mapping` read only `vehicle_id`/`is_primary` | unchanged — checked |
| **Stored data** | `epa_field_audit.table_name = 'epa_test_groups'` (66 rows); `overrides` keys `test_group_id`, `epa_test_family_id`, `carryover_test_group_id` (696 records); `chart_help` row `epacurves` says "linked EPA test group" | rewritten in the same migration |
| Left as is | `epa_fe_guide.smog_test_group` — it mirrors the Guide's own column (D5) and is a Test Group, correctly named; `epa_covered_models.certification_region` — EPA's term | — |

Old migrations stay as written; they are history, and the vocabulary records
the rename.

### Code (layer 1)

| Pattern | Refs | Files |
|---|---|---|
| `test_group_id` | 224 | 38 |
| `testGroupId(s)` | 103 | 18 |
| `…TestGroup…` identifiers | 135 | 25 |
| `epa_test_groups` | 64 | 16 |
| `epaGroup` / `EpaGroup` (the mapping's record) | 95 | 15 |
| `certGroup` / `CertGroup` | 30 | 8 |
| `epa_test_family_id` / `carryover_test_group_id` | 27 | 7 |
| `groupId` | 18 | 8 |
| bare `group` / `groups` meaning the record (top files: DataService 75, epaLinkSweep 68, EpaCuratorEditor 58, EpaDataCard 44) | ~1,000 | ~30 |
| prose "test group" / "certification group" | 214 lines (46 UI strings) | 62 |

Renamed: `getEpaTestGroupFull` → `getEpaTestVehicleFull`, `createEpaTestGroup`,
`deleteEpaTestGroup`, `getEpaTestGroupsAdmin`, `importEpaGroupFull`,
`planGroupImport`, `getCertGroupsForStats` / `ForCurves`, `getGroupsAwaitingFeLink`,
`classifyGroup`, `auditGroup(s)`, `summariseEpaGroups`, `epaRecordFromGroup`
(file and test file → `epaRecordFromTestVehicle`), the parser's `groups` output →
`testVehicles`, `parseEpaTestCarSheet`'s rows, AppContext's exports, and every
prop carrying the record.

**Kept, because they already mean EPA's Test Group:** `clusterByTestGroup`,
`configurationsInTestGroup` (`feGuideBrowse.js`, the Guide's Test Group) and
`exactTestGroupMatches` (its *call* is wrong today; layer 3 passes it a Test
Group instead of a Vehicle ID). Unrelated "group" words stay: `driveGroup`,
`buildFieldGroups`, `platformGroups`, the sub-nav's sections.

Also: `src/explainers/facts.json` (2 entries), `docs/vocabulary.md` (the
"test group" row, and the Retired table below), `docs/epa-*.md`, and outside
the repo `LocalDev/epa-csi/plancheck.mjs` and `dryrun.mjs` plus the memory
notes — updated by hand when layer 1 merges.

### Keeping it renamed

- **Retired rows in `docs/vocabulary.md`** for `epa_test_groups`,
  `test_group_id`, `testGroupId`, `epaGroup`, "certification group": `npm run
  vocab` then fails any added line that brings one back. "Test group" in prose
  cannot be machine-checked — it is now right for the certification — so it
  joins the pledge's reader-checked list.
- **A wiring assertion** that `src/` contains none of those identifiers — zero,
  a ratchet that cannot rise.

### Deploying a rename

Migrations are applied by hand and the code deploys on merge, so there is a
window where one side has the new names and the other the old.
`getVehicles` embeds the EPA mappings, and a failed embed blanks **the whole
site** (the 055/067 lesson). Layer 1's `getVehicles` therefore retries without
the EPA embed on a missing relation or column: for the minutes between deploy
and apply the site loads without EPA figures instead of not at all. Order:
merge layer 1 → deploy finishes → apply 081 → check. The fallback is removed
in layer 4.

PostgREST embed hints name constraints (`epa_fe_guide!epa_test_groups_fe_guide_row_id_fkey`),
which only a running PostgREST can test. **Recommend installing PostgREST
locally** (`brew install postgrest`, no Docker — the planned tier 2 of
`scripts/localdb.sh`) before layer 1: it is the one tool that tests exactly
this. Needs the owner's OK to install.

## The stack

Prefix `feature/epa-cert-374`, after #400 merges. Every layer leaves a working
app and passes `npm test`, `npm run lint`, `npm run drift`, `npm run vocab` and
`vite build` alone. Each migration runs twice on `scripts/localdb.sh` (the
second application must be a no-op).

### Layer 1 — rename to EPA test vehicle (no change in behavior)

Everything in "The rename, all the way down". Migration
`081_epa_test_vehicles_rename.sql`:

```sql
BEGIN;
ALTER TABLE IF EXISTS epa_test_groups RENAME TO epa_test_vehicles;
ALTER TABLE epa_test_vehicles    RENAME COLUMN test_group_id           TO test_vehicle_id;
ALTER TABLE epa_test_vehicles    RENAME COLUMN epa_test_family_id      TO test_group;
ALTER TABLE epa_test_vehicles    RENAME COLUMN carryover_test_group_id TO carryover_test_group;
ALTER TABLE epa_coefficient_sets RENAME COLUMN test_group_id TO test_vehicle_id;
ALTER TABLE epa_tests            RENAME COLUMN test_group_id TO test_vehicle_id;
ALTER TABLE epa_covered_models   RENAME COLUMN test_group_id TO test_vehicle_id;
ALTER TABLE epa_field_audit      RENAME COLUMN test_group_id TO test_vehicle_id;
ALTER TABLE epa_vehicle_mappings RENAME COLUMN epa_test_group_id TO test_vehicle_id;
-- Each wrapped in a DO block that checks information_schema first, so the
-- migration re-runs cleanly (RENAME has no IF EXISTS for columns).
-- ALTER TABLE … RENAME CONSTRAINT / ALTER INDEX … RENAME / ALTER POLICY … RENAME
-- for every object in the table above.
UPDATE epa_field_audit SET table_name = 'epa_test_vehicles' WHERE table_name = 'epa_test_groups';
UPDATE epa_test_vehicles SET overrides =
    (overrides - 'test_group_id' - 'epa_test_family_id' - 'carryover_test_group_id')
    || jsonb_strip_nulls(jsonb_build_object(
           'test_vehicle_id',      overrides->'test_group_id',
           'test_group',           overrides->'epa_test_family_id',
           'carryover_test_group', overrides->'carryover_test_group_id'))
 WHERE overrides ?| ARRAY['test_group_id','epa_test_family_id','carryover_test_group_id'];
UPDATE chart_help SET data_source = replace(data_source, 'EPA test group', 'EPA test vehicle')
 WHERE chart_key = 'epacurves';
-- Verify: no column, constraint, index or policy name matching 'test_group_id'
-- or 'epa_test_groups'; 0 audit rows on the old table name; 0 old override keys.
COMMIT;
```

**Tests:** the whole suite renamed and green with unchanged assertions (proof
nothing moved); the wiring ratchet; `npm run vocab` with the new Retired rows;
`plancheck.mjs` against the migrated local DB; with PostgREST, every
`DataService` read once.

**Risks:** a missed rename is a runtime error no build catches (Vite does not
resolve column names) — the ratchet and a PostgREST pass are the guard. Merge
conflicts with any open EPA work; #400 lands first and nothing else EPA should
be open meanwhile.

### Layer 2 — certifications: tables, backfill, importer

> **As built (2026-10-08).** The plan's `document_date` / `recertified_on` became
> the dates the certificate itself states: `certificate_issue_date`,
> `certificate_revision_date` (EPA's own field, shown as Recertified) and
> `csi_submitted_at`, which orders two filings exactly — all read from page 1 of
> 459 of 459 corpus files. Filings are ordered by that timestamp, then by EPA
> document id, then dated-over-undated (`compareFilings`; the document id has to
> come before a date, or importing the Jaguar's earlier filing replaced the
> later one the backfill held). Covered models live on the certification as
> rows with `certification_id` set and `test_vehicle_id` null; the legacy
> per-test-vehicle rows stay until layer 3. The parser now also reads Nissan's
> dotless Test Groups (`SNSXV0000TL2`), which it never did. Backfill on the
> 2026-10-08 11:11 backup: 475 certifications, 943 rows, 0 test vehicles
> without one, 0 Guide links lost, all 676 carryover origins placed.

Additive; nothing reads the new tables yet.

**Files:** `supabase/migrations/082_epa_certifications.sql`;
`parseEpaCsiPdf.js` (document date; the file's Test Group, model year, covered
models as one certification; per-test-vehicle carryover);
`epaImportMerge.js` (`planCertificationImport`: new Test Group inserts; same
Test Group with a newer document date updates and records Recertified; an
older filing is held); `DataService.importEpaTestVehicleFull` writes the
certification, then each test vehicle's row, and clean-replaces covered models
**per certification**; link, unlink and skip **write both** the old record
columns and the new row until layer 3, so a link made between layers is not
lost; `EpaPdfImportModal.jsx` copy: a carryover Vehicle ID reads "adds the
MY2024 certification", not "overwrite".

**Migration 082 sketch**

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS epa_certifications (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_group             text    NOT NULL UNIQUE,   -- EPA's Test Group
    model_year             integer NOT NULL,          -- = the Test Group's year letter
    document_date          date,
    source_file            text,
    recertified_on         date,   -- set when a later filing of this Test Group replaced one
    recertified_from_file  text,   -- the filing it replaced
    basis                  text    NOT NULL DEFAULT 'csi'
                           CHECK (basis IN ('csi', 'csv', 'guide', 'manual')),
    created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS epa_certification_test_vehicles (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    certification_id       bigint NOT NULL REFERENCES epa_certifications(id) ON DELETE CASCADE,
    test_vehicle_id        text   NOT NULL REFERENCES epa_test_vehicles(test_vehicle_id) ON DELETE CASCADE,
    carryover_test_group   text,
    carryover_model_year   integer,
    fe_guide_row_id        bigint REFERENCES epa_fe_guide(id) ON DELETE SET NULL,
    fe_guide_skipped_at    timestamptz,
    fe_guide_skip_note     text,
    UNIQUE (certification_id, test_vehicle_id)
);
-- Indexes: certification (model_year), link (test_vehicle_id), link
-- (fe_guide_row_id) WHERE linked, link awaiting WHERE unlinked and unskipped.
-- RLS on both: the epa_test_vehicles policies verbatim, DROP POLICY IF EXISTS
-- first. The 058 skip-clearing trigger recreated on the link table.
ALTER TABLE epa_covered_models ADD COLUMN IF NOT EXISTS certification_id bigint
    REFERENCES epa_certifications(id) ON DELETE CASCADE;

-- Backfill. Year from the Test Group's letter (L 2020 … V 2027, W 2028 …),
-- never from model_year. Test Group shape: five letters, then 00.0xxx, or
-- 0000xxx (Nissan).
-- 1. The Test Group in source_file (not .csv)              → basis csi
-- 2. test_group where it differs from the file's           → csi, or csv if no PDF
-- 3. Records whose test_vehicle_id is itself a Test Group  → manual
-- 4. Each Guide link → the row whose (year, Test Group) is the Guide row's;
--    else that year's row; else a new certification + row, basis guide.
--    (198 / 41 / 85 links)
-- 5. Skips (3) → the row from the source file.
-- 6. Covered models → the certification from the source file.
-- All ON CONFLICT DO NOTHING.
-- Verify on the 2026-10-07 backup: 475 certifications, 943 rows,
-- 0 test vehicles without a row, 324 linked rows, 0 linked test vehicles
-- without a linked row.
COMMIT;
```

**Tests:** parser (document date; multi-vehicle file → one certification,
several rows; carryover per row); `planCertificationImport` (insert, Recertified,
older held, covered models follow the certification); a JS twin of the
migration's year-letter map and Test Group pattern
(`certificationBackfill.test.js`, Nissan included); `plancheck.mjs` after a
full corpus re-import: 589 / 1,135.

**Left unlinked:** 619 of 943 rows after backfill (324 linked, 3 skipped);
811 of 1,135 after re-import. No existing link is lost.

**Risks:** the 64 records whose stored Test Group differs from their file get
two certifications; both are real Test Groups, and a year with no file behind
it shows up in layer 3's audit. Links made by SQL outside `DataService`
between layers 2 and 3 would not be written twice.

### Layer 3 — read path, the resolution rule, From MY…, derivations, sweep, counts

> **As built (2026-10-08).** One function, `testVehicleView`, gives every reader
> the test vehicle as a certification shows it: that year's identity, and that
> year's Guide figures laid over the stored values (`guideOverlay`; a curator's
> hand-set value still wins). `viewForVehicle` uses the vehicle's year
> (getVehicles, the explainer preview, the curator form opened from a vehicle,
> variant suggestions); `viewForTestVehicle` uses Since and the newest linked year
> (statistics, curves, the audit, the Guide browser). So the ~30 readers kept
> their field names. Link, unlink, skip and accept act on one certification
> (`linkRowId`); the sweep is one item per test vehicle per certification and
> counts in certifications (943, across 794 test vehicles). Migration 083 restores
> what promotion copied (255 records, 3,811 values) and is safe in either order
> with this code. Visible in this layer: "From MY…" beside the EPA range (19
> vehicles on the 2026-10-08 data), a line on the Guide picker when the figures
> are another year's, and a Data Checks finding for 2+ years (6 on the same data).
>
> **One deviation from D4.** "Since" is derived from the certifications at read
> time (`sinceYear`), not kept in a renamed, trigger-maintained column. The answer
> is the same; a renamed column would have made 083 another deploy-order break
> like 081, and the stored `model_year` is now only "the year last imported",
> retired with the other identity columns in layer 4.
>
> **Measured.** Every one of the 119 mappings was compared, today's code and data
> against this code on the migrated data, before and after 083: 109 identical; 10
> differ only in pack voltage (3) or specific energy (8), where a CSI re-import had
> overwritten copied Guide values with the PDF's own while the record stayed
> linked — the Guide-beats-certificate rule now holds there. No range, MPGe or
> adjustment figure changed.

**Files**
- New `src/utils/epaCertification.js` (pure): `vehicleModelYears`,
  `certificationYears`, `sinceYear`, `formatYears` ("MY2022, MY2024 to
  MY2025"), `resolveCertification(vehicle, testVehicle)` →
  `{ certification, match, guideRow, guideYear, fromYear }`,
  `newestLinkedCertification(testVehicle)` (D3).
- `DataService.js` — every Guide reader: `EPA_GROUP_FIELDS` (renamed in layer
  1) embeds the test vehicle's certifications with their Guide rows' overlay
  columns only; link/unlink/accept/skip take a link-row id; the sweep queue
  and progress count rows; audit, statistics and curves read the newest linked
  certification (D3); `getFeGuideVehicleLinks` goes through the link rows.
- `feGuidePromotion.js` → a render-time overlay: manual beats Guide beats lab.
  Accepting a Guide value clears the manual tag rather than copying.
- `epaRecordFromTestVehicle.js`, `epaDerivations.js` (adjustment signature),
  `epaConfiguration.js` (label range from the resolved certification),
  `vehicleFigures.js` — "From MY2024" reaches the vehicle through the existing
  basis line (`epaRangeBasis`, `.stat-cell-basis`).
- `epaLinkSweep.js` — one item per link row; `exactTestGroupMatches` is
  finally given a Test Group; covered models per certification.
  `feGuideMatch.js` — `exactYear` against the certification's year.
- `epaAudit.js`, `epaCertStats.js`, `epaCurveSubjects.js`, `dataChecks.js`
  (the 2+-years finding; the panel renders it unchanged).
- `FeGuideLinkSweep.jsx`, `FeGuidePicker.jsx` — keep working on link rows,
  showing the test vehicle plus "MY2024"; no redesign yet.
- `supabase/migrations/083_epa_certifications_read.sql`.

**Migration 083 sketch**

```sql
BEGIN;
-- Demote Guide copies: restore each overrides.<col>.previous, drop the
-- 'fe_guide' tags (255 records, 3,811 entries). The figures stay on the Guide row.
-- Since: model_year → first_model_year, kept by a trigger on the link table
-- (min of the certifications' model_year). The importer stops writing
-- identity fields to the test vehicle — this supersedes #400's guard (D4).
ALTER TABLE epa_test_vehicles RENAME COLUMN model_year TO first_model_year;
CREATE OR REPLACE FUNCTION sync_test_vehicle_since() … ;
COMMENT ON COLUMN epa_test_vehicles.fe_guide_row_id IS 'Retired by 083; read epa_certification_test_vehicles.';
-- Same comment on fe_guide_skipped_at, fe_guide_skip_note, test_group,
-- source_file, carryover_test_group, carryover_model_year.
COMMIT;
```

**Tests:** `epaCertification.test.js` — every `match`, ranges, partial ranges,
carryover, tie → newer, 2+ years, two certifications in one year, the Guide
falling back to the nearest linked year, `formatYears` with a gap; fixtures
from real IDs (`NE-U568EA011A-0`, `PGW1-0.0-J-905`, `202625-2`). Overlay order
in `feGuidePromotion.test.js`; `epaConfiguration`, `epaLinkSweep`,
`epaAudit`, `epaCertStats`, `feGuideMatch` suites. Wiring: no
`…_fe_guide_row_id_fkey` embed on the test vehicle remains; every Guide reader
goes through `resolveCertification` or `newestLinkedCertification`; "From
MY…" reaches `vehicleFigures`; the Data Checks finding is registered. A
corpus run over the dump (`npx vite-node`) reproduces the table above.

**For viewers:** no figure changes; 27 of 50 primary configurations gain a
line (10 only "Certified MY… of …"), 4 appear in Data Checks. Link progress
reads in rows: "324 of 943".

**Risks:** demotion cannot be undone in place — values return through the
overlay, but diff `epaConfigurationFigures` for every vehicle on a local
restore before and after. `getVehicles` gains ~1,100 nested rows; select the
overlay columns only. A test vehicle whose newest linked year changes class or drive
moves bucket in Certification Statistics.

### Layer 4 — UI: years, per-certification linking, the Guide detail

> **As built (2026-10-09).** Each EPA card on a vehicle's EPA sub-tab says
> "Vehicle ID … · Since MY… · MY… to MY…" and lists its certifications in a
> table (year, Test Group, Recertified / carryover / Basis, Guide state); the row
> the vehicle reads is filled, rows do not react to hover, and a curator's
> **Link** / **Change** button aims the Guide picker at another year. The picker
> sits above the reconciliation checks, which now run across the card and wrap.
> Every suggested Guide row — in the picker and the link sweep — carries the EPA
> tab's verdict before linking (`guideCandidateCheck`: unadjusted MPGe and an
> impossible label, as two badges). The sweep's batch links only proposals whose
> MPGe matches EPA; matching-MPGe rows with an impossible label have their own
> button, and everything the check does not confirm is left to a curator. The
> Guide-row detail names the certification each test vehicle is linked through;
> the Admin list and the primary picker show the years; the curator form's model
> year is a read-only "Since". **Not in this layer:** dropping the retired
> columns (084) and the getVehicles fallback — both wait until 081 is applied in
> production.

- **`EpaVehicleSection.jsx`** (the vehicle's EPA sub-tab): each configuration
  shows "Test vehicle NE-U568EA011A-0 · Since MY2025 · MY2025 to MY2026", its
  certifications (Test Group, year, Recertified, Basis), each one's Guide link
  and skip, and "From MY…" beside the one the vehicle resolves to.
- **`GuideCertificationResults.jsx`** (D5): the Guide-row detail stays a mirror
  of the FE Guide import; beneath it, what links add — the Test Group the row
  belongs to, its test vehicles with their years, Recertified, and the lab
  results.
- `FeGuidePicker.jsx` (one link row; candidates in its year first),
  `FeGuideLinkSweep.jsx` (a row per test vehicle per certification;
  progress "N of M across K test vehicles"), `PrimaryConfigurationPicker.jsx`
  (years and From MY… per configuration), the Admin EPA list (a years column),
  and each statistics tab's description naming its unit.
- `src/index.css`: semantic classes for the years line and the From MY… note
  from existing tokens (the warning color `exactYear` already uses); `npm run
  drift` must not rise.
- Migration `084`: drop the columns 083 retired, once layer 3 has run in
  production without reading them — or a later cleanup PR if the owner prefers
  a waiting period (the `runs.color` approach). Remove layer 1's `getVehicles`
  fallback.

**Tests:** wiring (years and From MY… render on both surfaces), contrast,
playground catalogue; owner's visual sign-off in the browser preview before
commit; contributor paths against the local DB, since the preview is signed
out.

## Decisions (owner, 2026-10-08)

- **D1** Keep a certification for every Guide link without a file (Basis
  `guide`).
- **D2** One certification per Test Group; a second filing marks it
  Recertified and the newer filing's document wins.
- **D3** Lab-side readers (statistics, curves, audit) use the test vehicle's
  newest linked certification.
- **D4** The test vehicle's year becomes Since (first certified year), kept by
  trigger; the importer stops writing identity to it.
- **D5** The Guide-row detail (`GuideCertificationResults`) mirrors the FE
  Guide import, with what links to certifications add beneath.
- **D6** The 5 hand-set label values (R1T240XR22, 26-XA4E-2, VBMXV00.0N5C,
  STSLV00.0L2Y, R2-159XR20AT) stay on the test vehicle for every year, shown
  as set by hand for all years.
- **Rename** all the way into code and database, as layer 1.
- **Two tables** — certification and test vehicle are many-to-many.

## Open before layer 1

Nothing. PostgREST 16.4 is installed. Re-measure on the next complete backup
before layer 2's verification counts are trusted.

## How the numbers were measured

Newest backup `LocalDev/evbench-app-20261007-1753.dump`, restored into a
separate database on the local cluster (dropped afterwards; the shared one was
not touched). Certifications came from each record's `source_file` and
stored Test Group (year from the letter) and, for "after re-import", every
`ids` entry in `LocalDev/epa-csi/dryrun-results.json`. Sweep candidates were
ranked by the real `feGuideMatch.js`. Rename counts are `grep` over `src/` and
`scripts/` at 4dee5cf, and the catalog of the restored database. The scripts
were throwaway; layer 3's corpus test replaces them.
