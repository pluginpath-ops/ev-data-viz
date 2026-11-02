# EPA test vehicle identity, and what stands behind a Guide row

Investigation, 2026-10-31; layers 1 and 2 built the same night, layers 3 and 4
the next day after the owner's answers (see **Status** at the end). Measured on the full CSI corpus
(`LocalDev/epa-csi/`, 2021–2027, 718 files, 1,360 EPA test vehicles), the
Fuel Economy Guide CSVs MY22–MY27 (1,303 EV rows) and the 2026-10-27 backup.
Scripts and a per-row result table: `LocalDev/epa-csi/identity/` (see the end).

Two problems, one cause: we key an EPA test vehicle by a string the importer
makes up from whatever one PDF happens to list, and we then ask a curator to
link that record one-to-one to a Guide row that is often not one-to-one.

---

## Part A — Duplicates, and the opposite: two cars on one record

### What a test number tells us

* **A test number never belongs to two different (Vehicle ID, config index)
  pairs.** 0 conflicts across the whole corpus, and no test number appears
  under two configurations inside one PDF. Two records sharing a test number
  are the same thing.
* **The same test can be renumbered** between filings. 19 cases: same
  procedure, date, CD range and AC energy, new number. Polestar 3 moved from
  Volvo's manufacturer code to Polestar's (`TVVX10092040` → `VPAB10094171`),
  VinFast refiled, Mullen re-badged ELMS's UD1, Zoox `SZOX1`/`TZOX1`. Mercedes
  re-reported an EQS's separate city/highway tests as one multi-cycle test.
* **(Vehicle ID, config index) is not stable either.** Maserati's Grecale filing
  swapped the coefficients of configs 0 and 2 between 2026 and 2027 while the
  tests stayed put. Porsche lists a Cross Turismo as config 1 one year and 0
  the next. Tests are the anchor. Road load is corroboration only.

### Why duplicates appear

`parseEpaCsiPdf.js` keys a test vehicle as its bare Vehicle ID unless that ID
repeats in the same PDF, when it adds `-<config index>`. A carryover filing
that lists one configuration therefore produces `1SMV5028` for the vehicle the
original filing stored as `1SMV5028-0`. The config index is right there
("1SMV5028 / 0") and is thrown away.

* Corpus: **28 groups** of one shared-test configuration under two or three keys
  (Ioniq 5, EV6, RZ, i7, Spectre, EQE/EQS, Macan, Taycan, R1S/R1T, EX30, Blazer,
  Lyriq, Gravity, Charger, RS e-tron GT…), plus Zoox via renumbering.
* Backup: **43 test numbers** under two ids. All 43 are caught by "shares a
  test", including the 10 that are not suffix twins (e.g. Tesla
  `STSLV00.0L2Y`, a Test Group used as an id by an old CSV import, with 9–12
  audit rows, against the real Vehicle ID `YD224-061538`).

### The opposite failure: two cars collapsed onto one key

The same rule silently merges different cars when a Vehicle ID is reused:

| Key | What it holds | Evidence |
|---|---|---|
| `NNGAA078` | GMC Hummer EV SUT (config 0, NGMXD…0003) **and** BrightDrop EV600 (config 1, NGMXD…0004) | different carlines, different road load. Backup: 4 tests, labelled EV600 |
| `Mullen THREE` | test weight 5,500 lb (2024) and 10,500 lb (2025) | different cars |
| `NLNC2EML6L1008051` | Karsan e-JEST, 8,500 lb (2022) then 9,500 lb (2024/26) | probably a retest at a new weight, owner to judge |
| `FE-Y1ATH-25`, `FE-Y1ASCUV-25` | Porsche, config 1 (2025) vs config 0 (2026), different tests and road load | ambiguous |

Same key with **new tests and the same road load** is a legitimate retest and
should stay one record: Nissan Ariya (4 IDs, retested 2026), VW ID.4
`VW316640470`, Bugatti Nevera, ProMaster, Fiat 500e, VinFast VF 7, Volvo EX90.

### Root fix (recommended)

On import, resolve each incoming test vehicle to a stored record **by shared
test** before using the made-up key:

1. If any incoming test number is already stored, adopt that record's id.
2. Else, if a stored test matches on procedure + date + CD range + AC energy (a
   renumbered test), adopt that record's id and say so in the import report.
3. Else, use today's key.

**Guards, so intended behavior survives:**

* **Mercedes `/N` (PR #413).** File 66073 holds `V297PSM140f-Z2791 / 1` and a
  different car whose real ID is `V297PSM140f-Z2791-1`. Production briefly
  stored config 1's test under `…-1`. If that row is still there, rule 1 would
  send config 1 back onto the EQS 580's record. **An adopted id must never be
  another incoming vehicle's key in the same file, and two incoming vehicles
  never adopt one id.** In either case fall back to the made-up key and warn.
* **BMW reusing one ID across tire packages, configs 0–4.** Untouched: each
  config has its own tests, so nothing is shared.
* **A car tested twice** (Mercedes CLA 350, two multi-cycle tests a month apart) and
  **retests under one key** (Ariya, ID.4): untouched. Same key, more tests.
* **Older file fills blanks only (#412) and the newer certification's identity
  is held (#374).** Unchanged: adoption only picks *which* row; `planGroupImport`
  still decides what is written.
* **A new collision** (rule 3 lands on a stored key that shares no test and has
  a different carline or test weight, like `NNGAA078`) should not write onto it.
  Proposed: key it `<Vehicle ID>/<config>@<Test Group>` and warn. **The form of
  that key is an open name.**

Optional, worth it: store EPA's own `vehicle_id` and `config_index` as columns,
so identity is data, not a parse of our key.

### One-time merge

A SQL function, `merge_epa_test_vehicles(keep, drop)`, run once over the
groups found by "shares a test", in one transaction per pair:

* **Which survives:** the one carrying curation (vehicle mappings, audit rows,
  Guide links). Otherwise the one with more tests. Otherwise the bare id.
* **Repoint** `epa_tests` (by test number; the drop side's duplicate tests go,
  and their audit `row_id`s move to the kept test), `epa_test_phases` (follow
  their test), `epa_coefficient_sets` (by category, keep the kept side's),
  `epa_covered_models`, `epa_certification_test_vehicles` (one row per
  certification; where both sides have one, keep the one with a Guide link),
  `epa_vehicle_mappings` (de-duplicate per vehicle; keep `is_primary`),
  `epa_field_audit.test_vehicle_id`. Then fill the kept record's blank fields
  from the dropped one, the same "fill blanks" rule as #412.
* **Report, don't merge:** pairs where both sides have different Guide links,
  different primary mappings, or disagreeing held (`manual`) values. Those go to
  a curator.
* Test on the local mirror first: `localdb.sh up`, migrate, merge, then
  re-import one year folder and confirm zero new duplicates.

Splitting `NNGAA078` and `Mullen THREE` is a separate, by-hand job: tests and
coefficients go to a new record per car, and the links must be checked.

---

## Part B — A Guide row is often not one EPA test vehicle

### The identity that settles it

For every EPA test vehicle, the CSI gives the unadjusted consumption exactly:

```
city kWh/100 mi = 100 × AC Recharge Event Energy ÷ CD range (city, or the multi-cycle's)
hwy  kWh/100 mi = 100 × AC Recharge Event Energy ÷ CD range (highway)
```

It needs no DC energy and no phases, so it works for `1RMV5449` and for the
other 245 files without DC energy. Where a Guide row is one tested
configuration, it matches to the 4th decimal. The Guide prints its kWh/100 mi
line to 4 decimals for most makers; Ford, Dodge and VinFast print 1, so the
tolerance must follow the printed precision.

### What the corpus says

Each Guide row was checked against every EPA test vehicle in its certification
**and in the certification it carries over from**. Pooling the carryover
matters: the MY26/27 Blazer filings list one config, while the label still
blends the three from MY25.

| Verdict | Rows | Meaning |
|---|---:|---|
| exact | 617 (+24 other carline) | one EPA test vehicle reproduces the row |
| near-exact | 46 (+18) | within a hair of one; treat as exact with a note |
| blend | 122 (+28) | inside the span of 2–3 EPA test vehicles of the same carline: a sales-weighted label |
| beyond the tested ones | 412 | the row describes a configuration nobody tested (a wheel, tire or charger option) |
| one cycle exact | 7 | data quirk |
| no PDF in corpus | 29 | |

By brand: Hyundai, Genesis, Kia, Lexus, Volvo, Mercedes and Mini are mostly
exact. Rivian is mostly exact but blends often, as do Porsche, Audi and BMW.
GM, Cadillac, VW, Lucid, Tesla, Ford and Nissan are dominated by rows beyond
the tested configurations.

**Rows beyond the tested ones are real, not noise.** BMW i4 eDrive35/40 on 18"
have no test; only 19" was tested. Lucid Air rows for 19"/20"/21" wheels sit
around one tested Touring XR. Equinox EV AWD 19 kW charger sits a near-uniform
~7–8% above the 11 kW row, which is an exact match to `1SMV5061`. Charger-named
rows are over-represented here (67 of 412 vs 25 of 641 exact): a charger option
changes AC losses in both cycles alike, while a wheel option changes city and
highway differently.

### Why linking by hand keeps failing

The current pre-link check (`guideCandidateCheck` → `checkUnadjustedMpge`)
compares model-derived MPGe with **±1% "agrees", ±5% "close"**. Sibling
configurations are often closer than that: R1S 20" configs are 0.4% apart,
EX30 19"/20" 1.2%, Blazer `-1`/`-2` 5%. So one row "agrees" with several EPA
test vehicles, a blend "agrees" with none, and a row beyond the tested ones
reads as "close" to whichever sibling is nearest. It also needs DC energy and
phases, which many files lack.

### The model (decided by the owner, 2026-10-31)

1. **Compute what stands behind each Guide row — "Tested via" — automatically**,
   from the identity above, against every test vehicle certified under the
   row's Test Group, carline (or covered model) first:
   * **exact** → that EPA test vehicle.
   * **near** → that one, just past rounding.
   * **blend** → the 2–3 EPA test vehicles, shown as the **span** of their
     figures. No weights: they are EPA's sales mix, unpublished, and not unique
     with three or more.
   * **untested** → nothing tested is this row. The nearest tested trim of the
     carline is offered as a suggestion, with how far apart the two cycles are;
     a curator may link it, the numbers never do.
   * **no lab data** → no test vehicle in the pool has the tests to compare.
2. **The curator makes one choice: vehicle → Guide row (EPA Label).** That link
   reads like the car (trim, wheels, charger) — the iX3's wheel and tire
   options are Guide rows. The Guide row → EPA test vehicle half is computed,
   with its evidence, and only overridden by hand.
3. **What a vehicle then shows:** the EPA Label from its Guide row, always.
   Physics (coefficients, test weight, DC energy, η):
   * from the one EPA test vehicle when exact or near;
   * from the blend's members, as a span, when blend;
   * from a similar tested trim only when a curator linked it, and labelled so.
4. **Cross-carline matches** (`otherCarline`, 45 rows) are never auto-applied.
   Porsche's generic "Taycan" carline is a legitimate case; VinFast's VF 9
   landing between VF 8 configurations is not.

This also absorbs Part A's mess: a duplicate pair reproduces the same point,
so the computation counts each test once before it classifies.

**Why "untested" does not link a similar trim on the numbers.** The first
version linked a tested configuration when the row was the same factor away in
both cycles (within 1.5%), on the theory that EPA derives an untested model type
by scaling a tested one. Measured against a null: a same-maker pool from
*another* Test Group of the adjacent years scales uniformly within 0.3% for 14%
of these rows, against 26% for the row's own pool — a likelihood ratio near 2.
Same-maker cars simply share a city/highway ratio. Not the confidence the owner
asked for, so the classifier reports the nearest trim and stops.

**Two pool facts the first analysis half-missed.**
* A *later* file can name configurations first certified under an earlier
  Test Group that the earlier file never listed. BMW's MY2024 i7 file
  (`RBMXV00.0G7S`) lists one configuration of `CL34779`; the MY2026 file lists
  four, each "originally certified" under `RBMXV00.0G7S`, and the MY2024 Guide
  rows are those configurations exactly. The pool takes any member whose
  carryover names the Test Group.
* The Guide's `#1 Smog Rating Test Group` joins to a stored certification for
  1,192 of 1,211 Guide EV rows on the mirror. It was written off as a join key
  when it was compared with test vehicles' own `test_group`; against
  certifications it is the key. The `parseFeGuide` header said otherwise and
  is corrected; `FeGuidePicker`'s still does (layer 3 touches it).

**The Guide's kWh/100mi line.** The importer kept only the MPGe line of each
configuration's pair. GM, Ford and most others print MPGe to 1 decimal and
kWh/100mi to 4 (1,723 of 2,576 figures) — and 1 decimal of MPGe cannot tell
sibling configurations apart. Migration 094 stores the kWh/100mi figures.

### Measured on the mirror, layers 1–2 applied

| Tested via | Rows | of which other carline |
|---|---|---|
| exact | 601 | 20 |
| near | 70 | 6 |
| blend | 150 | 17 (57 ambiguous: another pair explains it as well) |
| untested | 368 | — |
| no lab data | 22 | — |
| **Guide EV rows** | **1,211** | |

**Every test, not the first (2026-11-03, the 11-02 backup).** Tested via
read one point per test vehicle, from its first multi-cycle test. A test
vehicle tested twice has two, and the Guide can print the later one: the R1S
Quad Max (22in UHP) was run in February and May in both drive modes, and its
EPA Label is the 50/50 mean of the May runs. Reading the first test missed
that and called the row a three-way blend of other wheel sizes. Now every
test is a point, and a blend's members must be different test vehicles. On
the mirror: exact 602 → 608, blend 150 → 157, untested 366 → 354, near and no
lab data unchanged. The 20 rows that moved:

| Change | Rows | Examples |
|---|---|---|
| untested → blend | 11 | R1S/R1T All-Terrain Tri Max (20in), R1S/R1T Performance (20in AT), ID.4 Pro S (2022); SQ8 / SQ8 Sportback (20in) MY2024–25 as an ambiguous three-way of `RAZS-ES-290-2/3/4` |
| untested → exact | 1 | A6 e-tron quattro ultra (2027) |
| blend → exact | 4 | RS e-tron GT Performance MY2025–27, VF 9 Plus (2024) |
| ambiguous blend → blend | 4 | R1S/R1T Quad (22in UHP) MY2026–27: the UHP pair, not three of other wheels |

Spot checks across makes (LocalDev/epa-csi/identity/testedvia.json):
Ioniq 5 AWD MY25/26 by wheel size, EV9 GT-Line/RWD/Standard, Taycan 4S
Performance Battery, R1S Dual Large/Max, EX30 all four: **exact**. EV9 Long
Range AWD and the MY2022 R1S: **blend** of two configurations. Blazer EV AWD
MY25–27: **blend** of `1SMV5028-1`/`-2`, ambiguous with `-0` — the three are
nearly collinear. Blazer EV AWD MY24, every MY2022 Mach-E: **untested** (the
nearest tested trim is ~11% off), as in the Python analysis.

## Part C — Manufacturer comments: capture them, and read them before the PDF

**What we keep today.** Only "Manufacturer Test Vehicle Comments", and only
its first text item (`commentsBefore`, `items[b + 1]`), so a note that wraps
is cut short. The per-test "Manufacturer Test Comments", inside each test's
block, is not read at all.

**What is there.** 2,980 per-test comments in 622 of 718 files. 2,329 of them
(366 files) state energy figures. Examples:

* per-cycle DC Wh/mi and UBE: GM's `MCT UBE ENERGY = 89050.7 WH`, VW's
  `ECdc_cyc: UDDS1 - 192.55 Wh/mi…`, Toyota's `Net Vehicle DC energy
  consumption [DC Wh/mile]:197.95`;
* the configuration tested: BMW's `iX xDrive60 (23'' Wheels)_A_ETW-6000_…`,
  VW's `"B-Drive" … as ID.4 Pro S and for the ID.4 Pro model`;
* red flags: Tesla's Cybertruck `Dummy data submission for EPA COC`, Toyota's
  `input the result of EPA confirmatory testing`.

Of the 336 files missing DC energy in the structured fields, **172 state it in
a comment**. Of the 246 PDFs behind the 419 Guide rows left unexplained or
untested, **199 have per-test comments**.

**Recommendation: capture them, then hand an agent the comments, not the PDF.**

1. The parser keeps both comment fields in full (all items up to the next
   label) on the test (`epa_tests`), and the vehicle-level one un-truncated.
   This is a small change plus one column.
2. Wherever a Guide row stays unresolved, or a check fails, the comments of
   every EPA test vehicle in its pool are shown beside the verdict.
3. The agent pass reads only the comments of the outliers. That is a few lines
   per test, each tied to one test number, so every claim the agent makes can
   be quoted back to its source. Reading whole PDFs costs about 13 pages of
   boilerplate for every line of signal, and answers are not tied to a test.
   Keep the whole-PDF read for whatever is left after the comments.
4. Later, once the agent shows which phrasings recur: deterministic extractors
   for the big patterns (GM UBE, VW/Toyota per-cycle Wh/mi), stored with an
   `overrides` source of their own (e.g. `comment`), so a curator can tell a
   comment-derived figure from a structured one.

## Spot checks

Chosen by brand, then a seeded random draw per verdict.

* **Ioniq 5 MY25 (7 rows):** all exact, each to its own EPA test vehicle,
  including the XRT and N. **Mach-E MY25 (6):** all exact at Ford's 1-decimal
  precision. **EX30 MY25 (4):** all exact; shows `202532` (config 1) beside
  `202532-0`. **Ariya Platinum+, GV60 AWD, i5 M60:** exact.
* **Blazer EV AWD MY25/26/27:** blend of `1SMV5028-0/-1/-2` in all three years.
  **Equinox EV AWD:** exact to `1SMV5061` (11 kW). The 19 kW row is beyond the
  tested ones.
* **EV9 Long Range AWD MY25:** blend of `MV-U329EA203A-0/-1`. The GT-Line and
  both RWD rows are exact.
* **i4 MY25:** xDrive40 18" exact; xDrive40 19" a blend of two 19" configs;
  eDrive35/40 18" beyond the tested ones (only 19" tested).
* **Model Y MY25:** LR RWD exact; Performance a blend that reaches into another
  carline; LR AWD 1% off its EPA test vehicle, beyond the tested ones.
* **ID.4 MY25:** unresolved. The pool holds only ID.7 configs, so the ID.4's
  own carryover filing is missing from the corpus.
* **Taycan 4S MY25:** blends and one exact match under Porsche's generic
  "Taycan" carline.
* **Seeded random:** a Lucid Air GT XR 21" "blend" that was really 0.06% from
  one config. That is why near-exact is its own verdict now. A VF 9 Plus
  matched only across carlines, which is why those never auto-apply.

## Decisions (owner, 2026-10-31)

1. **Link vehicle → Guide row (EPA Label), then test vehicles through it.** The
   vehicle → test vehicle direction was only ever a way to reach the dyno
   coefficients.
2. **Err toward not assuming.** An untested trim is linked to a similar one only
   with confidence — which the numbers alone do not give (above).
3. **"Tested via"** for the field ("Tested configurations" was the other
   candidate; "configuration" is the vehicle's link in the vocabulary).
4. **A blend is a span**, never an estimated weighting.

Left to me, decided: a reused Vehicle ID is keyed `<Vehicle ID>@<Test Group>`;
`NNGAA078` and `Mullen THREE` are split (different carline / 5,500 vs 10,500
lb); `NLNC2EML6L1008051` (Karsan) and the Porsche Cross Turismo pair stay one
record each (retests).

## Status

**Layer 1 — identity (built).**
* `utils/epaTestVehicleIdentity.js`: the import adopts the stored record that
  holds a parsed test vehicle's test (by test number, else fingerprint), with
  the PR #413 Mercedes guard; a reused Vehicle ID for another car becomes
  `<Vehicle ID>@<Test Group>`. `EpaPdfImportModal` reads every file first,
  then resolves keys across the batch and the database
  (`DataService.getEpaTestVehicleIdentity`).
* Parser: "Manufacturer Test Comments" read in full onto each test
  (`epa_tests.mfr_test_comments`).
* Migration 093: the comment column, the fingerprint, the duplicates view and
  `merge_epa_test_vehicles`. Verified on a restore of the 2026-10-27 backup:
  29 pairs merged, no test number, Guide link, primary or audit row lost; one
  pair held back on a real conflict (Tesla `YD224-061538`, two Guide rows).
* `LocalDev/curation/epa-identity/split-reused-ids.sql` splits the two reused
  IDs on stored data; then re-import their four PDFs.
* Test Car List twins: the Test Car List writes a configuration under its bare
  Vehicle ID with no tests, and a CSI file listing several configurations
  wrote the same car as `<ID>-<config>` with them (`RMA00015` and
  `RMA00015-0`, one Mach-E GT). 21 such pairs, 10 of them with vehicle links
  on the wrong half. No test to share, so they pair on key, configuration
  number, carline and test weight: in the duplicates view, in the CSI import
  (`testCarListTwin`), and in the Test Car List import, which now writes onto
  the stored `<ID>-<config>`. All 21 merged on the mirror with no conflict.
* Re-import of all 718 PDFs against the merged mirror: **0** new duplicates
  (the parser's raw keys would have made 32). Against an empty database the
  resolver splits exactly `NNGAA078` and `Mullen THREE`.

**Layer 2 — Tested via (built).** `utils/guideTestedVia.js`
(`testedVia`, `guideTestedViaPool`), migration 094 + `parseFeGuide` for the
kWh/100mi figures. Pure; nothing in the app calls it yet.

**Layer 3 — the vehicle's EPA Label (built; owner answers 2026-10-31).**

Answers: a blend's nearest member stands for the vehicle; keep an existing
configuration unless a Guide row contradicts it ("only contradicted ones");
build and test it all locally, apply in the order given below.

* Migration 095: `vehicle_guide_rows` (vehicle → Guide row) and
  `epa_vehicle_mappings.via_guide_row_id` (the row a configuration came in
  through). Same RLS as the mappings.
* `utils/vehicleGuideLinks.js`: what a row's Tested via links
  (`configurationsFromTestedVia`), a configuration's standing
  (`configurationStanding`: tested via label / other label / not behind
  label / unconfirmed), and the one-time move (`planVehicleGuideLinks`).
* The vehicle's EPA section leads with its EPA Label (owner, 2026-11-01: key
  it on the Guide row, with the test configurations behind it). Each row shows
  its Tested via, then every test vehicle of its certification with a **match**
  badge (`utils/guideRowMatches.js`: exact / near / blend + nearest /
  alternative / possible / other label / no match / no lab data), its
  kWh/100mi against the row's, whether the vehicle links it, and Link/Unlink.
  The ranked picker shows the same list for each candidate before it is
  linked. Test data follows; each card keeps a standing badge, and its
  per-year certification table and Guide picker are folded under "Label
  figures by year" for curators, since read alone they did not say whether a
  link was good.
* Admin → Data Checks → EPA Label links: preview, then apply, the move.

Two rules the data changed, both on the mirror:

1. **Which rows a vehicle gets.** From the certification links alone, the
   Ioniq 5 XRT's AWD test vehicles pointed at the "Ioniq 5 RWD" row — old
   mistakes carried over. From Tested via alone, one Taycan test vehicle is a
   blend member of a dozen Taycan rows and the R1S's stand behind the R1T's.
   So a row is linked only where both agree: a configuration's certification
   points at it AND its Tested via names that configuration. 163 rows.
2. **What "contradicted" means.** Of 17 configurations the vehicle's own rows
   did not name, 7 stood behind a sibling row of the same certification (the
   Gravity GT on 21/22in wheels where the vehicle linked the 20/21in row). They
   are the right car, so they are kept and marked "other label". Removed: the
   10 that no Guide row of their certification names (iX3 ×2, IONIQ 9 ×3, EQE
   SUV ×2, CLA 250+, Model Y Performance, Ioniq 5 RWD).

The move on the mirror: 163 rows linked, 10 configurations removed, 7 added (a
blend's other members), 10 primaries set (only where the old primary went,
or there was none), 96 left unconfirmed; a second run is empty. Not done: an
existing primary is not moved to a blend's nearest member when it is itself
a member (the Blazer EV RS AWD keeps `1SMV5028`, which explains the row as
well as -1 and -2).

Not built: the manufacturer comments beside an untested row (Part C). The
comments are stored; showing them is a small follow-up.

**Layer 4 — test vehicles behind no EPA Label (built; owner, 2026-10-31:
"hide/remove all the extraneous retests and variants that don't tie to the
published info").** A test vehicle is behind no EPA Label when every Guide row
of its certification is explained by Tested via (exact, near or blend) and it
could stand behind none of them — not within reach of a row, not as one end of
a blend pair, not as a corner of a three-way blend
(`couldStandBehind` in `guideTestedVia.js`). A row nobody reproduces, a
certification with no Guide row imported, or a test vehicle with no lab
figures leaves it unjudged. Marked, never deleted: the Guide link sweep's own
skip with `NO_LABEL_NOTE`, so every reader that honors a skip honors it;
its Guide links are cleared (each paired one car's lab data with another's
label) and its vehicle links removed. A curator's own skip is never
overwritten, and only this mark is lifted when a later Guide adds a row it
stands behind. Admin → Data Checks → Behind no EPA Label previews and applies;
Admin → EPA Data hides them behind a "Show N behind no EPA Label" toggle.

On the mirror (applied in the app, then restored): 68 of 910 behind no EPA
Label, 492 behind a row, 350 unjudged. Applying cleared 24 Guide links,
skipped 94 memberships and removed 17 vehicle links; a second run is empty.
**Three vehicles lose their only configuration** — EQE 320+ and EQE SUV 320+
(`X294PSM245r-Z2695`) and Model 3 LR (`3D221-731644`) — and the IONIQ 9 AWD
keeps two with no primary, as it had none before. Removed anyway (owner,
2026-11-01: "if it's bad, remove it"); those vehicles want an EPA Label
linked (layer 3).

**Applying to production, in order** (corrected 2026-11-02: the re-imports
come after the code that writes them is deployed — main's Guide parser drops
the kWh/100mi figures and main's PDF import writes no manufacturer comments and
keys test vehicles the old way):
1. Migration 093, then in the SQL editor, after reading the list:
   `SELECT keep_id, drop_id, via, conflicts FROM epa_test_vehicle_duplicates;`
   and merge the conflict-free ones. The one Tesla pair held back
   (`STSLV00.0L2Y` / `YD224-061538`, two Guide rows) is a curator's call:
   merge with `force => true` or leave it. Then run
   `LocalDev/curation/epa-identity/split-reused-ids.sql`.
2. Migration 094.
3. Merge layers 1–2 and let them deploy.
4. Re-import each year's Guide CSV (fills 094's kWh/100mi columns; Tested via
   reads them, so before step 6).
5. Re-import every CSI PDF, the split script's four included. Each existing
   test gets its manufacturer comments (093's column, empty until then); the
   import routes every test vehicle to its stored record by test number, and
   writes no Guide link, skip, mapping or primary. Dry run on the 2026-11-02
   backup: 0 new duplicates (the parser's raw keys would have made 55).
6. Migration 095, merge layer 3, then Admin → Data Checks → EPA Label links:
   preview, read, apply.
7. Merge layer 4 (no migration), then Admin → Data Checks → Behind no EPA
   Label: preview, read the vehicle links it removes and the vehicles it
   leaves with no configuration, apply. After layer 3's move, so a
   configuration that move keeps is judged against the links it made.
8. Link an EPA Label to each vehicle step 7 left with no configuration, and
   to the top vehicles the 2026-11-02 audit found clear-cut
   (`LocalDev/curation/epa-label-top100/apply.sql`, one comment per vehicle —
   do it with the app's Link/Unlink, not the SQL).

**Measured on the 2026-11-02 backup (local mirror).** EPA Label links: 164
rows linked, 10 configurations removed, 7 added, 10 primaries set. Behind no
EPA Label: 68 of 910 marked, 24 Guide links cleared, 11 vehicle links
removed; EQE 320+, EQE SUV 320+ and Model 3 LR left with none. A second run
of each is empty. Audit of the top 100 vehicles by the Vehicles tab's order:
13 right, 18 with a wrong row or configuration, 61 missing a row, 8 with no
row in the imported Guide; the wrong ones came from earlier hand links (an
EX90 test vehicle on a Polestar 3, an Air Sapphire as an Air Dream's primary)
that the move promoted, not from the move's rules.

## Running the analysis again

From the repo root of the main checkout (`LocalDev/` lives there):

```
S=LocalDev/epa-csi/identity node LocalDev/epa-csi/identity/full.mjs
python3 -I LocalDev/epa-csi/identity/comp.py LocalDev/epa-csi/identity/full.json
python3 -I LocalDev/epa-csi/identity/blend.py LocalDev/epa-csi/identity/full.json LocalDev/EPA_Files LocalDev/epa-csi/identity/blend.json
```

`full.mjs` needs `LocalDev/epa-csi/.parser.bundle.mjs`, which `dryrun.mjs`
builds. `guide-basis.csv` has one line per Guide EV row: verdict, nearest EPA
test vehicle and the pool it was judged against.

The shipped code, against the local mirror (`DB=` a restored database with 093
and 094 applied; `REPO=` the checkout under test):

```
DB=evafter REPO=$PWD node LocalDev/epa-csi/identity/guide-kwh-backfill.mjs   # Guide kWh figures, as a re-import would
DB=evafter REPO=$PWD node LocalDev/epa-csi/identity/reimport.mjs              # would re-importing every PDF duplicate anything?
DB=evafter REPO=$PWD node LocalDev/epa-csi/identity/testedvia.mjs             # Tested via for every Guide EV row → testedvia.json
```

Vocabulary: checked against docs/vocabulary.md. "EPA test vehicle", "Vehicle
ID", "Test Group", "certification", "EPA Label" and "Guide row" are its terms.
"Configuration" is avoided for a CSI config, since vocabulary gives it to the
linked mapping. New entries added there: **an EPA test** (never "run"), the
`<Vehicle ID>@<Test Group>` key, and **Tested via** with its values; a blend
is a **span**, since "range" means distance here.
