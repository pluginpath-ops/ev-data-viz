/**
 * The SQL that imports parsed Green NCAP assessments (docs/green-ncap-plan.md,
 * step 3). The owner runs it on the local mirror, then in production.
 *
 * Per car, upserted by slug:
 *   - the assessment, as published, with the owner-confirmed vehicle_id (or none)
 *   - its tests, replaced
 *   - the BAB130 range test, when the car is linked and the sheet gives the
 *     net battery and BAB130 figures; otherwise any earlier one is deleted
 *
 * A re-import refreshes the range test's figures and vehicle but leaves its
 * listed / excluded / default flags alone: those are a curator's judgments.
 * One transaction; safe to run twice.
 *
 * Pure: takes parsed cars (scripts/parseGreenNcap.mjs) and a slug → vehicle id map.
 */
import { MI_TO_KM } from '../constants/units.js';

export const GREEN_NCAP_SOURCE = 'Green NCAP';
export const BAB130_RANGE_TEST_NAME = 'Green NCAP BAB130';
// Scored at its 130 km/h cruise, steady, as third-party tests are scored at
// their target speed (owner, 2026-11-16). The trace averages 77.6 mph; its
// dips and full-throttle climbs are not modeled (docs/green-ncap-plan.md).
export const BAB130_CRUISE_MPH = Math.round((130 / MI_TO_KM) * 10) / 10;
export const BAB130_TEMP_F = 73.4; // 23 °C

const IDENTITY_COLUMNS = new Set(['make', 'model', 'variant', 'reference', 'vin', 'drivetrain',
    'declaredUsableKwh', 'wltpRangeKm', 'testYear', 'vinModelYear']);

/** A SQL literal. */
export function lit(v) {
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
    return `'${String(v).replace(/'/g, "''")}'`;
}

const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** The BAB130 range test's figures, or null when the sheet cannot give them. */
export function bab130RangeTest(car) {
    const net = car.battery?.netBatteryKwh;
    const bab = car.tests?.find(t => t.key === 'bab130');
    if (net == null || bab?.fromBatteryKwh100km == null) return null;
    // Green NCAP's own computed range, else the same division it does.
    const km = bab.rangeKm ?? (net / bab.fromBatteryKwh100km) * 100;
    return {
        distance_miles: round(km / MI_TO_KM, 1),
        energy_kwh: net,
        start_soc: 100,
        end_soc: 0,
        speed_mph: BAB130_CRUISE_MPH,
        speed_basis: 'steady',
        temperature_f: BAB130_TEMP_F,
        conditions: 'Lab dynamometer, BAB130 motorway cycle: 130 km/h cruise with dips to 110 and full-throttle accelerations (averages 77.6 mph). Range computed: net battery ÷ consumption.',
    };
}

const bySlug = slug => `(SELECT id FROM public.green_ncap_assessments WHERE slug = ${lit(slug)})`;

function assessmentSql(car, vehicleId) {
    const id = car.identity ?? {};
    const s = car.source ?? {};
    const published = Object.fromEntries(Object.entries(id).filter(([k]) => !IDENTITY_COLUMNS.has(k)));
    const row = {
        slug: s.slug, reference: id.reference, make: id.make, model: id.model, variant: id.variant,
        layout: car.layout, test_year: id.testYear, vin: id.vin, vin_model_year: id.vinModelYear,
        drivetrain: id.drivetrain, declared_usable_kwh: id.declaredUsableKwh, wltp_range_km: id.wltpRangeKm,
        recharged_kwh: car.battery?.rechargedKwh, net_battery_kwh: car.battery?.netBatteryKwh,
        grid_to_battery: car.battery?.gridToBattery, published,
        page_url: s.url, sheet_url: s.sheetUrl, datasheet_url: s.datasheetUrl, rated_on: s.ratedOn,
        fetched_at: s.fetchedAt, vehicle_id: vehicleId,
    };
    const cols = Object.keys(row);
    return `INSERT INTO public.green_ncap_assessments (${cols.join(', ')})\nVALUES (${cols.map(c => lit(row[c])).join(', ')})\n`
        + `ON CONFLICT (slug) DO UPDATE SET ${cols.filter(c => c !== 'slug').map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now();`;
}

function testsSql(car) {
    const slug = car.source.slug;
    const out = [`DELETE FROM public.green_ncap_tests WHERE assessment_id = ${bySlug(slug)};`];
    if (!car.tests?.length) return out;
    const values = car.tests.map((t, i) => `(${[i, t.key, t.label, t.group === 'road', t.rated !== false, t.tempC,
        t.fromGridKwh100km, t.fromBatteryKwh100km, t.boardComputerKwh100km, t.rangeKm].map(lit).join(', ')})`);
    out.push(`INSERT INTO public.green_ncap_tests (assessment_id, position, key, label, on_road, rated, temp_c,\n`
        + `    from_grid_kwh_100km, from_battery_kwh_100km, board_computer_kwh_100km, range_km)\n`
        // Cast: a column that is NULL on every row would otherwise read as text.
        + `SELECT a.id, v.position, v.key, v.label, v.on_road, v.rated, v.temp_c::numeric, v.from_grid::numeric,\n`
        + `    v.from_battery::numeric, v.board_computer::numeric, v.range_km::numeric\n`
        + `FROM public.green_ncap_assessments a, (VALUES\n    ${values.join(',\n    ')}\n`
        + `) v(position, key, label, on_road, rated, temp_c, from_grid, from_battery, board_computer, range_km)\n`
        + `WHERE a.slug = ${lit(slug)};`);
    return out;
}

function rangeTestSql(car, vehicleId) {
    const slug = car.source.slug;
    const figures = vehicleId != null ? bab130RangeTest(car) : null;
    if (!figures) return [`DELETE FROM public.runs WHERE kind = 'range' AND green_ncap_assessment_id = ${bySlug(slug)};`];
    const row = { vehicle_id: vehicleId, name: BAB130_RANGE_TEST_NAME, kind: 'range', source: GREEN_NCAP_SOURCE,
        source_url: car.source.url, ...figures };
    const cols = Object.keys(row);
    return [`INSERT INTO public.runs (${cols.join(', ')}, green_ncap_assessment_id)\n`
        + `SELECT ${cols.map(c => lit(row[c])).join(', ')}, a.id FROM public.green_ncap_assessments a WHERE a.slug = ${lit(slug)}\n`
        + `ON CONFLICT (green_ncap_assessment_id, kind) WHERE green_ncap_assessment_id IS NOT NULL\n`
        + `DO UPDATE SET ${cols.filter(c => c !== 'kind').map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now();`];
}

/**
 * @param cars       parsed cars (parsed.json)
 * @param vehicleFor Map slug → confirmed vehicle id; absent = not linked
 * @returns {{ sql: string, counts: { assessments, linked, rangeTests } }}
 */
export function buildGreenNcapImportSql(cars, vehicleFor = new Map()) {
    const parts = [
        '-- Green NCAP import (docs/green-ncap-plan.md, step 3). Generated by scripts/importGreenNcap.mjs.',
        '-- Run on the local mirror first. One transaction; safe to run twice.',
        'BEGIN;',
        '',
        '-- The source, so Data Checks reads the tests as attributed.',
        `INSERT INTO public.sources (name, domains)\nSELECT ${lit(GREEN_NCAP_SOURCE)}, ARRAY['greenncap.com']\n`
            + `WHERE NOT EXISTS (SELECT 1 FROM public.sources WHERE lower(name) = lower(${lit(GREEN_NCAP_SOURCE)}));`,
    ];
    const counts = { assessments: 0, linked: 0, rangeTests: 0 };
    for (const car of [...cars].sort((a, b) => a.source.slug.localeCompare(b.source.slug))) {
        const vehicleId = vehicleFor.get(car.source.slug) ?? null;
        counts.assessments++;
        if (vehicleId != null) counts.linked++;
        if (vehicleId != null && bab130RangeTest(car)) counts.rangeTests++;
        parts.push('', `-- ${car.source.slug}${vehicleId != null ? ` → vehicle ${vehicleId}` : ' (not linked)'}`,
            assessmentSql(car, vehicleId), ...testsSql(car), ...rangeTestSql(car, vehicleId));
    }
    parts.push('', 'COMMIT;', '');
    return { sql: parts.join('\n'), counts };
}
