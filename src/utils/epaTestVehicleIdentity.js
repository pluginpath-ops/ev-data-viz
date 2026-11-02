/**
 * Which stored EPA test vehicle a parsed one IS — decided by its tests, not
 * by the key the parser made up.
 *
 * The parser keys a test vehicle by its bare Vehicle ID unless that ID repeats
 * in the same PDF, when it adds `-<config>` (or `/<config>`, parseEpaCsiPdf
 * `repeatedId`). The key therefore depends on how many configurations one file
 * happens to list. The MY2025 Blazer EV file lists three and stored
 * `1SMV5028-0`; the MY2026 and MY2027 carryover files list one and stored
 * `1SMV5028` — one test, two records, each collecting its own links. 30
 * pairs like that were in the data (migration 093 merges them).
 *
 * The identity that holds is the test. Measured over all 718 CSI files
 * (2021–2027): a test number never belongs to two different (Vehicle ID,
 * configuration) pairs, and no test number appears under two configurations
 * of one file. So a parsed test vehicle whose test is already stored IS that
 * record, whatever its key. EPA also renumbers a test when it is filed again
 * (Polestar's MY2027 filing moved every test from Volvo's code to Polestar's),
 * so a test with no stored number is matched on its fingerprint as well.
 *
 * The opposite failure is handled here too: one Vehicle ID reused for a
 * different car. GM's `NNGAA078` is a Hummer EV SUT in one MY2022 file and a
 * BrightDrop EV600 in another; both were written onto one record. A parsed
 * test vehicle whose key is stored, that shares no test with it, and that is a
 * different carline or a very different test weight, is keyed
 * `<key>@<Test Group>` instead.
 *
 * Pure: the caller supplies what is stored (DataService
 * getEpaTestVehicleIdentity) and applies the result.
 */

/** A different car, not a retest: test weight apart by more than this share. */
export const DIFFERENT_CAR_WEIGHT_SHARE = 0.25;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * A test's fingerprint: procedure, date, CD range and AC energy. Two of
 * them alike is the same test filed under two numbers. Both figures must be
 * real — Zoox filed 999 miles and no energy in two years under two Vehicle
 * IDs, and placeholders match each other. Mirrors epa_test_fingerprint() in
 * migration 093.
 */
export function testFingerprint(t) {
    const cd = num(t?.cd_range_combined_calc);
    const ac = num(t?.ac_recharge_kwh);
    if (!t?.test_date || t?.procedure_code == null || !(cd > 0) || !(ac > 0)) return null;
    return [t.procedure_code, t.test_date, cd.toFixed(1), ac.toFixed(2)].join('|');
}

const normCarline = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const testWeight = (tv) => num(tv?.equiv_test_weight_lbs)
    ?? num((tv?.coefficient_sets ?? []).find(c => c.equiv_test_weight_lbs != null)?.equiv_test_weight_lbs);

/** True when `a` and `b`, under one key and sharing no test, are different cars. */
export function isDifferentCar(a, b) {
    const ca = normCarline(a?.epa_carline_name);
    const cb = normCarline(b?.epa_carline_name);
    if (ca && cb && ca !== cb) return true;
    const wa = testWeight(a);
    const wb = testWeight(b);
    if (wa && wb && Math.abs(wa - wb) / Math.min(wa, wb) > DIFFERENT_CAR_WEIGHT_SHARE) return true;
    return false;
}

/** A key the parser suffixed for a repeated Vehicle ID: `<ID>-<config>` or `<ID>/<config>`. */
const SUFFIXED = /^(.+)[-/](\d+)$/;

/**
 * The stored Test Car List record that is this suffixed configuration, or
 * null: the bare Vehicle ID, holding no tests, with the same configuration
 * number, and not a different car. A real ID can end in digits (Tesla's
 * `3D224-649671`), which is why the stored record has to exist and agree on
 * the configuration rather than the key being trusted alone.
 */
export function testCarListTwin(key, tv, records) {
    const m = SUFFIXED.exec(key ?? '');
    if (!m) return null;
    const [, base, config] = m;
    const rec = records[base];
    if (!rec || rec.has_tests !== false) return null;
    if (String(rec.vehicle_config_number ?? '0') !== config) return null;
    if (tv.vehicle_config_number != null && String(tv.vehicle_config_number) !== config) return null;
    return isDifferentCar(rec, tv) ? null : base;
}

/**
 * @param {Array<{ name, testVehicles: Array }>} files  parsed files, in the
 *        order they will be imported; testVehicles as parseEpaCsiText returns
 * @param {Object} stored  what the database holds
 * @param {Object<string,string>} stored.byTestNumber   test number → test_vehicle_id
 * @param {Object<string,string>} stored.byFingerprint  testFingerprint → test_vehicle_id
 * @param {Object<string,Object>} stored.records        test_vehicle_id → { epa_carline_name, equiv_test_weight_lbs,
 *        vehicle_config_number, has_tests }, for the parsed keys and their bare Vehicle IDs
 * @returns {{ files: Array, renamed: Array<{ file, from, to, why }>, warnings: string[] }}
 *   files    the same files with each test vehicle's `test_vehicle_id` resolved,
 *            and nothing else added: each test vehicle is written to
 *            epa_test_vehicles as it stands, so a key the table has no column
 *            for fails the import ("renamedFrom" did, on the 2022 corpus)
 *   renamed  every change, for the review
 *   warnings what a curator should read: refused adoptions, reused IDs
 */
export function resolveTestVehicleIds(files, stored = {}) {
    // What is known so far: the database, then each file as it is resolved,
    // so a batch holding the MY2025 and MY2026 Blazer files ends on one record
    // even when neither was stored before.
    const byNumber = { ...(stored.byTestNumber ?? {}) };
    const byPrint  = { ...(stored.byFingerprint ?? {}) };
    const records  = { ...(stored.records ?? {}) };
    const renamed = [];
    const warnings = [];

    const out = files.map(file => {
        const tvs = file.testVehicles ?? [];
        const ownKeys = new Set(tvs.map(t => t.test_vehicle_id));
        const claimed = new Set();

        const resolved = tvs.map(tv => {
            const key = tv.test_vehicle_id;
            const tests = tv.tests ?? [];
            const viaNumber = new Set(tests.map(t => byNumber[t.test_number]).filter(Boolean));
            const viaPrint  = new Set(tests.map(t => byPrint[testFingerprint(t)]).filter(Boolean));
            const found = viaNumber.size ? viaNumber : viaPrint;
            let why = viaNumber.size ? 'shares a test number' : 'shares a renumbered test';

            let id = key;
            if (found.size > 1) {
                warnings.push(`${file.name}: ${key}'s tests are stored under ${[...found].join(' and ')} — imported as ${key}; those records may be one car (merge_epa_test_vehicles).`);
            } else if (found.size === 1) {
                const target = [...found][0];
                // Never onto another vehicle of this same file, and never two
                // onto one: the MY2027 Mercedes file holds configuration 1 of
                // `V297PSM140f-Z2791` AND a car whose own ID is
                // `V297PSM140f-Z2791-1`, and a failed upload once stored the
                // first one's test under the second's key (PR #413).
                if (target !== key && (ownKeys.has(target) || claimed.has(target))) {
                    warnings.push(`${file.name}: ${key}'s test is stored under ${target}, which is another test vehicle in this file — imported as ${key}. Check ${target}'s tests.`);
                } else {
                    id = target;
                }
            } else if (testCarListTwin(key, tv, records)) {
                // The Test Car List keys a configuration by its bare Vehicle ID;
                // this file suffixed it because it lists several. With no test
                // to go on, the stored record with no tests and this
                // configuration number is this car (21 pairs like that were in
                // the data: `RMA00015` and `RMA00015-0`, one Mach-E GT).
                id = testCarListTwin(key, tv, records);
                why = 'the Test Car List record';
            } else if (records[key] && isDifferentCar(records[key], tv)) {
                id = `${key}@${tv.test_group ?? file.name}`;
                why = 'reused Vehicle ID';
                warnings.push(`${file.name}: Vehicle ID ${key} is already ${records[key].epa_carline_name ?? 'another car'}, with none of these tests — this ${tv.epa_carline_name ?? 'car'} is imported as ${id}.`);
            }

            claimed.add(id);
            if (id !== key) renamed.push({ file: file.name, from: key, to: id, why });
            return id === key ? tv : { ...tv, test_vehicle_id: id };
        });

        // Known from here on, for the files after this one.
        for (const tv of resolved) {
            for (const t of tv.tests ?? []) {
                if (t.test_number) byNumber[t.test_number] ??= tv.test_vehicle_id;
                const fp = testFingerprint(t);
                if (fp) byPrint[fp] ??= tv.test_vehicle_id;
            }
            records[tv.test_vehicle_id] ??= {
                epa_carline_name: tv.epa_carline_name ?? null,
                equiv_test_weight_lbs: testWeight(tv),
                vehicle_config_number: tv.vehicle_config_number ?? null,
                has_tests: (tv.tests ?? []).length > 0,
            };
        }
        return { ...file, testVehicles: resolved };
    });

    return { files: out, renamed, warnings };
}
