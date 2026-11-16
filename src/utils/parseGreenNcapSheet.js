/**
 * One Green NCAP results sheet (the .ods on an assessment page) → structured JSON.
 *
 *   parseGreenNcapSheet(odsSheets(contentXml)) → { layout, identity, battery, tests, fastCharging, warnings }
 *
 * Three layouts are in circulation, and the parser reads all of them by label,
 * never by fixed cell:
 *
 *   2020–21  sheet RESULTS, "MAIN RESULTS 1", rows like "WLTC+ cold engine (14 degr C)",
 *            real-world rows "PEMS+ Cold Engine 1"; no measured battery figures
 *   2022–24  sheet RESULTS, same block, plus Measured Recharged Energy and
 *            Measured Net Battery Capacity on the first lab row
 *   2025–    sheet TEST_RESULTS; WLTP type-approval row carries the battery
 *            figures; a Fast_charging sheet holds a DC charging curve
 *
 * Units are kept as published (kWh/100km, km, kWh, °C) and each test also
 * carries US equivalents (mi, mi/kWh, Wh/mi), so nothing downstream converts.
 *
 * What a "range" here is: Green NCAP does not drive the lab tests to empty. Its
 * Driving Range column is the measured net battery capacity divided by the
 * test's from-battery consumption (Kia EV9: 95.37 kWh / 30.72 kWh/100km = 310.5
 * km). It is a computed figure, and `rangeBasis` says so.
 */
// The extension is for Node: scripts/parseGreenNcap.mjs imports this file directly.
import { MI_TO_KM } from '../constants/units.js';

const norm = s => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = cell => {
    if (!cell) return null;
    if (cell.value != null) return cell.value;
    const t = cell.text.replace(',', '.').replace('%', '');
    const n = Number(t);
    if (!t || !Number.isFinite(n)) return null;
    return cell.text.includes('%') ? n / 100 : n;
};
const r = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// ── Tests ───────────────────────────────────────────────────────────────────

// Each printed row label → one stable key. Order matters: first match wins.
// `tempC` is the lab's ambient; null where the label and site do not say.
// BAB130 runs at 23 °C (greenncap.com/laboratory-tests); its cycle peaks at
// 130 km/h with hard 80→130 accelerations, so it is a mixed cycle, not steady.
const TEST_KEYS = [
    { re: /^wltp coc type approval/,                    key: 'wltp_type_approval', group: 'lab',  tempC: null },
    { re: /^wltc\+ cat cold|^wltc\+ cat \(-7|^wltc\+ cold engine \(-7/, key: 'wltc_cat_cold', group: 'lab', tempC: -7 },
    { re: /^wltc\+ cat warm/,                           key: 'wltc_cat_warm',      group: 'lab',  tempC: -7 },
    { re: /^wltc\+ cold engine 2/,                      key: 'wltc_cold_2',        group: 'lab',  tempC: null, rated: false },
    { re: /^wltc\+ cold engine average/,                key: 'wltc_cold_avg',      group: 'lab',  tempC: null, rated: false },
    { re: /^wltc\+ cold engine \((\d+)/,                key: 'wltc_cold',          group: 'lab',  tempC: m => +m[1] },
    { re: /^wltc\+ reg\. warm/,                         key: 'wltc_warm_repeat',   group: 'lab',  tempC: 23, rated: false },
    { re: /^wltc\+ warm/,                               key: 'wltc_warm',          group: 'lab',  tempC: 23 },
    { re: /^bab ?130/,                                  key: 'bab130',             group: 'lab',  tempC: 23 },
    { re: /^on-road drive/,                             key: 'on_road',            group: 'road', tempC: null },
    { re: /^pems\+ cold engine 1/,                      key: 'on_road',            group: 'road', tempC: null },
    { re: /^pems\+ cold engine 2/,                      key: 'on_road_2',          group: 'road', tempC: null },
    { re: /^short urban trip|^short trip \/ cold start 1/, key: 'short_urban',     group: 'road', tempC: null },
    { re: /^short trip \/ cold start 2/,                key: 'short_urban_2',      group: 'road', tempC: null },
    { re: /^(pems\+ )?eco/,                             key: 'on_road_eco',        group: 'road', tempC: null },
    { re: /^(pems\+ )?heavy load/,                      key: 'on_road_heavy',      group: 'road', tempC: null },
];

// Column header (+ its unit row) → field. The 2020–21 sheet repeats "from
// grid" in Wh/s for the congestion rows, so the unit decides. Wordings seen:
// the 2020 Kona and ZOE say plain "Energy Consumption" for from-grid; the 2022
// Q4 e-tron says "Gross Battery Capacity (from grid)" for recharged energy.
const COLUMNS = [
    { re: /from grid|^energy consumption$/, unit: /kwh\/100 ?km/, field: 'fromGridKwh100km' },
    { re: /board comp\.? energy/,           unit: /kwh\/100 ?km/, field: 'boardComputerKwh100km' },
    { re: /driving range \(electr/,         unit: /^km$/,         field: 'rangeKm' },
    { re: /recharged electric energy|gross battery capacity \(from grid\)/, unit: /kwh/, field: 'rechargedKwh' },
    { re: /net(to)? battery capacity/,      unit: /kwh/,          field: 'netBatteryKwh' },
    { re: /grid to battery/,                unit: /.*/,           field: 'gridToBattery' },
    { re: /(consumpt\.|consumption) from battery/, unit: /kwh\/100 ?km/, field: 'fromBatteryKwh100km' },
];

function findCell(rows, pred) {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) if (row[c] && pred(norm(row[c].text))) return { r: i, c };
    }
    return null;
}

function readMainResults(rows, warnings) {
    const head = findCell(rows, t => t === 'main results 1');
    if (!head) { warnings.push('No "MAIN RESULTS 1" block'); return { tests: [], battery: {} }; }

    const header = rows[head.r] ?? [], units = rows[head.r + 1] ?? [];
    const cols = {};
    header.forEach((cell, c) => {
        if (!cell) return;
        const col = COLUMNS.find(k => k.re.test(norm(cell.text)) && k.unit.test(norm(units[c]?.text)));
        if (col && cols[col.field] == null) cols[col.field] = c;
    });
    for (const k of COLUMNS) if (cols[k.field] == null && k.field !== 'rechargedKwh' && k.field !== 'netBatteryKwh' && k.field !== 'gridToBattery')
        warnings.push(`Column not found: ${k.field}`);

    const tests = [], battery = {};
    let group = null;
    for (let i = head.r + 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const first = norm(row[1]?.text);
        if (/main results 2|regene-?ration|phev/.test(first)) break;
        if (/^laboratory/.test(first)) group = 'lab';
        else if (/^(on-road|real-world)/.test(first)) group = 'road';
        // The label is the last text cell before the figures (col 3; col 2 is a sub-group).
        const label = row[3]?.text?.trim();
        if (!label || /congestion/i.test(label)) continue;

        const fig = {};
        for (const [field, c] of Object.entries(cols)) fig[field] = num(row[c]);
        // First figure wins, and a "kWh" under 2 is not one: the 2022 Q4 e-tron
        // has its efficiency (0.88) typed into the net-capacity column a row down.
        for (const f of ['rechargedKwh', 'netBatteryKwh']) {
            if (fig[f] == null || battery[f] != null) continue;
            if (fig[f] < 2) warnings.push(`${f} ${fig[f]} on "${label}" is not a kWh figure; ignored`);
            else battery[f] = fig[f];
        }
        // Stored as 0.874 in most sheets, 88.7 (a bare percent) in some.
        if (fig.gridToBattery != null && battery.gridToBattery == null)
            battery.gridToBattery = fig.gridToBattery > 1.5 ? fig.gridToBattery / 100 : fig.gridToBattery;
        delete fig.rechargedKwh; delete fig.netBatteryKwh; delete fig.gridToBattery;
        if (Object.values(fig).every(v => v == null)) continue; // a row the car was not put through

        const known = TEST_KEYS.find(k => k.re.test(norm(label)));
        if (!known) warnings.push(`Unknown test row: "${label}"`);
        const m = known && norm(label).match(known.re);
        tests.push({
            key: known?.key ?? null,
            label,
            group: known?.group ?? group,
            rated: known?.rated ?? !/not rated/i.test(label),
            tempC: typeof known?.tempC === 'function' ? known.tempC(m) : (known?.tempC ?? null),
            ...fig,
        });
    }
    return { tests, battery };
}

// ── Identity (SPECS) ────────────────────────────────────────────────────────

const SPEC_FIELDS = [
    ['make', /^brand/],
    ['model', /^model/],
    ['variant', /^variant name/],
    ['reference', /test reference number/],
    ['drivetrain', /^drive axle|^drivetrain/],
    ['vin', /^vin tested vehicle/],
    ['declaredUsableKwh', /^declared battery capacity \(usable\)|^declared battery capacity \[kwh\]|^battery size/],
    ['declaredInstalledKwh', /^declared battery capacity \(installed\)/],
    ['wltpKwh100km', /^declared electric energy consumption \(for bev\)/],
    ['wltpRangeKm', /^declared electric range \(for bev\)|^published driving range/],
    ['wltpCityRangeKm', /^declared electric range city \(for bev\)/],
    ['voltageV', /^traction battery voltage/],
    ['heating', /^heating concept/],
    ['powerKw', /^engine\/system power|^engine power/],
    ['torqueNm', /^engine\/system torque|^torque/],
    ['tyres', /^tyre size/],
    ['testMassKg', /^test mass/],
    ['emptyMassKg', /^empty vehicle mass|^actual vehicle mass|^actual mass/],
    ['productionRegion', /^production region/],
];
const NUMERIC = new Set(['declaredUsableKwh', 'declaredInstalledKwh', 'wltpKwh100km', 'wltpRangeKm',
    'wltpCityRangeKm', 'voltageV', 'powerKw', 'torqueNm', 'testMassKg', 'emptyMassKg']);

function readSpecs(rows) {
    const out = {};
    for (const row of rows) {
        const label = norm(row?.[0]?.text);
        if (!label) continue;
        const hit = SPEC_FIELDS.find(([f, re]) => out[f] == null && re.test(label));
        if (!hit || !row[1]) continue;
        const [field] = hit;
        out[field] = NUMERIC.has(field) ? num(row[1]) : row[1].text.replace(/\s+/g, ' ').trim() || null;
    }
    return out;
}

// ── Model year from the VIN ─────────────────────────────────────────────────

// Position 10 is the model year in North American VINs. European makers often
// fill it too, but the standard there does not require it, so this is a hint
// for matching, never a fact: it must land within two years of the test.
const VIN_YEAR = 'ABCDEFGHJKLMNPRSTVWXY123456789';
export function vinModelYear(vin, testYear) {
    if (!vin || vin.length !== 17 || !testYear) return null;
    const i = VIN_YEAR.indexOf(vin[9].toUpperCase());
    if (i < 0) return null;
    const candidates = [1980 + i, 2010 + i, 2040 + i];
    const best = candidates.reduce((a, b) => (Math.abs(b - testYear) < Math.abs(a - testYear) ? b : a));
    return Math.abs(best - testYear) <= 2 ? best : null;
}

// ── Fast charging (2025 layout) ─────────────────────────────────────────────

const toSeconds = t => {
    const parts = (t ?? '').split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
};

function readFastCharging(rows) {
    if (!rows?.length) return null;
    const head = rows[0] ?? [];
    const col = re => head.findIndex(c => c && re.test(norm(c.text)));
    const cSoc = col(/^soc/), cTime = col(/^time/), cPower = col(/^power/);
    if (cSoc < 0 || cTime < 0 || cPower < 0) return null;
    const points = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const soc = num(row?.[cSoc]), power = num(row?.[cPower]), t = toSeconds(row?.[cTime]?.text);
        if (soc == null || power == null || t == null) continue;
        points.push({ timeS: t, soc: r(soc, 2), powerKw: r(power, 3) });
    }
    // Times are mm:ss and wrap past 59:59 in some sheets; carry the hour.
    for (let i = 1, add = 0; i < points.length; i++) {
        if (points[i].timeS + add < points[i - 1].timeS - 1800) add += 3600;
        points[i].timeS += add;
    }
    return points.length ? { points } : null;
}

// ── Whole sheet ─────────────────────────────────────────────────────────────

const usFigures = t => ({
    rangeMi: r(t.rangeKm != null ? t.rangeKm / MI_TO_KM : null, 1),
    fromBatteryWhPerMi: r(t.fromBatteryKwh100km != null ? t.fromBatteryKwh100km * 10 * MI_TO_KM : null, 0),
    fromGridWhPerMi: r(t.fromGridKwh100km != null ? t.fromGridKwh100km * 10 * MI_TO_KM : null, 0),
});

export function parseGreenNcapSheet(sheets) {
    const warnings = [];
    const resultsName = ['TEST_RESULTS', 'RESULTS'].find(n => sheets[n]);
    // 2022 is told from 2020 by the measured battery figures, read below.
    let layout = resultsName === 'TEST_RESULTS' ? '2025' : '2020';
    if (!resultsName) warnings.push('No RESULTS or TEST_RESULTS sheet');

    const identity = readSpecs(sheets.SPECS ?? []);
    if (!identity.make || !identity.model) warnings.push('SPECS has no brand or model');
    const { tests, battery } = readMainResults(sheets[resultsName] ?? [], warnings);

    // SPECS repeats the battery figures in the 2022 layout; fill only gaps.
    for (const row of sheets.SPECS ?? []) {
        const label = norm(row?.[0]?.text);
        if (battery.rechargedKwh == null && /^measured recharged/.test(label)) battery.rechargedKwh = num(row[1]);
        if (battery.netBatteryKwh == null && /^measured netto? battery/.test(label)) battery.netBatteryKwh = num(row[1]);
    }
    if (layout === '2020' && battery.netBatteryKwh != null) layout = '2022';
    if (battery.rechargedKwh != null && battery.netBatteryKwh != null) {
        const computed = battery.netBatteryKwh / battery.rechargedKwh;
        if (battery.gridToBattery == null) battery.gridToBattery = computed;
        else if (Math.abs(battery.gridToBattery - computed) > 0.002)
            warnings.push(`Grid-to-battery ${battery.gridToBattery} disagrees with net/recharged ${r(computed, 4)}`);
    }

    // The ref number's first two digits are the test year ("25-KIA-0229").
    const refYear = identity.reference?.match(/^(\d{2})-/)?.[1];
    const testYear = refYear ? 2000 + Number(refYear) : null;

    return {
        layout,
        identity: { ...identity, testYear, vinModelYear: vinModelYear(identity.vin, testYear) },
        battery: {
            rechargedKwh: r(battery.rechargedKwh, 2),
            netBatteryKwh: r(battery.netBatteryKwh, 2),
            gridToBattery: r(battery.gridToBattery, 4),
        },
        rangeBasis: 'net battery capacity ÷ from-battery consumption (computed, not driven to empty)',
        tests: tests.map(t => ({
            ...t,
            fromGridKwh100km: r(t.fromGridKwh100km, 2),
            boardComputerKwh100km: r(t.boardComputerKwh100km, 2),
            fromBatteryKwh100km: r(t.fromBatteryKwh100km, 2),
            rangeKm: r(t.rangeKm, 1),
            ...usFigures(t),
        })),
        fastCharging: readFastCharging(sheets.Fast_charging),
        warnings,
    };
}
