import { describe, it, expect } from 'vitest';
import { buildGreenNcapImportSql, bab130RangeTest, fastChargeTest, lit } from '../greenNcapImportSql';

const EV9 = {
    source: { slug: 'kia-ev9-gt-line-2025-0229', url: 'https://www.greenncap.com/assessments/kia-ev9-gt-line-2025-0229/' },
    layout: '2025',
    identity: { make: 'KIA', model: 'EV9', variant: "GT-line", reference: '25-KIA-0229', testYear: 2025, vinModelYear: 2024, powerKw: 283 },
    battery: { rechargedKwh: 109.06, netBatteryKwh: 95.37, gridToBattery: 0.8745 },
    tests: [
        { key: 'wltc_warm', label: 'WLTC+ Warm', group: 'lab', rated: true, tempC: 23, fromGridKwh100km: 23.35, fromBatteryKwh100km: 20.42, rangeKm: 467 },
        { key: 'bab130', label: 'BAB130 Motorway', group: 'lab', rated: true, tempC: 23, fromGridKwh100km: 35.13, fromBatteryKwh100km: 30.72, rangeKm: 310.5 },
        { key: 'on_road', label: 'On-Road Drive', group: 'road', rated: true, tempC: null, fromGridKwh100km: 21.72, fromBatteryKwh100km: 19, rangeKm: 502.1 },
    ],
    fastCharging: { points: [
        { timeS: 0, soc: 7, powerKw: 0 }, { timeS: 4, soc: 7, powerKw: 180.5 },
        ...Array.from({ length: 300 }, (_, i) => ({ timeS: 8 + i * 4, soc: 8 + Math.floor(i / 4), powerKw: 200 })),
    ] },
};
const OLD = { ...EV9, fastCharging: undefined, source: { slug: 'vw-id3-2021-0060' }, layout: '2020', battery: { netBatteryKwh: null }, identity: { make: 'Volkswagen', model: 'ID.3' } };

describe('lit', () => {
    it('quotes text, leaves numbers, writes NULL and jsonb', () => {
        expect(lit("O'Neil")).toBe("'O''Neil'");
        expect(lit(1.5)).toBe('1.5');
        expect(lit(null)).toBe('NULL');
        expect(lit(NaN)).toBe('NULL');
        expect(lit({ a: 1 })).toBe(`'{"a":1}'::jsonb`);
        expect(lit(['soc', 'time'])).toBe("ARRAY['soc', 'time']");
    });
});

describe('bab130RangeTest', () => {
    it('is the computed range on the net battery, steady at the 130 km/h cruise', () => {
        expect(bab130RangeTest(EV9)).toMatchObject({ distance_miles: 192.9, energy_kwh: 95.37, start_soc: 100, end_soc: 0, speed_mph: 80.8, speed_basis: 'steady', temperature_f: 73.4 });
    });
    it('is null without a net battery figure', () => {
        expect(bab130RangeTest(OLD)).toBe(null);
    });
});

describe('fastChargeTest', () => {
    it('keeps every point, time in minutes, and summarizes it as addRun would', () => {
        const t = fastChargeTest(EV9);
        expect(t.points).toHaveLength(302);
        expect(t.points[1]).toEqual({ time: 0.067, soc: 7, chargeRate: 180.5 });
        expect(t.figures).toMatchObject({ start_soc: 7, end_soc: 82, populated_fields: ['soc', 'chargeRate', 'time'] });
        expect(t.figures.charge_summary.peakKw).toBe(200);
        expect(t.figures.charge_summary.windows[10].kw).toBe(200);
    });
    it('is null without a curve', () => {
        expect(fastChargeTest(OLD)).toBe(null);
    });
});

describe('buildGreenNcapImportSql', () => {
    const { sql, counts } = buildGreenNcapImportSql([OLD, EV9], new Map([[EV9.source.slug, 27], [OLD.source.slug, 999]]));

    it('counts what it writes', () => {
        expect(counts).toEqual({ assessments: 2, linked: 2, rangeTests: 1, chargingTests: 1 });
    });

    it('is one transaction that seeds the source once', () => {
        expect(sql.startsWith('-- Green NCAP import')).toBe(true);
        expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;\n$/);
        expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.sources/);
    });

    it('keeps identity extras in published, and links the vehicle', () => {
        expect(sql).toContain(`'{"powerKw":283}'::jsonb`);
        expect(sql).toMatch(/ON CONFLICT \(slug\) DO UPDATE SET reference = EXCLUDED\.reference/);
        expect(sql).toContain('-- kia-ev9-gt-line-2025-0229 → vehicle 27');
    });

    it('replaces the tests, marking the road one', () => {
        expect(sql).toContain("DELETE FROM public.green_ncap_tests WHERE assessment_id = (SELECT id FROM public.green_ncap_assessments WHERE slug = 'kia-ev9-gt-line-2025-0229');");
        expect(sql).toContain("(2, 'on_road', 'On-Road Drive', true, true, NULL, 21.72, 19, NULL, 502.1)");
    });

    it('upserts the range test without touching listed or excluded', () => {
        const run = sql.slice(sql.indexOf('INSERT INTO public.runs'));
        expect(run).toMatch(/ON CONFLICT \(green_ncap_assessment_id, kind\) WHERE green_ncap_assessment_id IS NOT NULL/);
        expect(run).not.toMatch(/is_hidden|is_excluded|is_default/);
    });

    it('upserts the charging test, then replaces its points', () => {
        const run = sql.slice(sql.indexOf("'Green NCAP DC fast charge'") - 400);
        expect(run).toMatch(/ON CONFLICT \(green_ncap_assessment_id, kind\)/);
        expect(sql).toContain("DELETE FROM public.data_points WHERE run_id = (SELECT id FROM public.runs WHERE kind = 'charging' AND green_ncap_assessment_id = (SELECT id FROM public.green_ncap_assessments WHERE slug = 'kia-ev9-gt-line-2025-0229'));");
        expect(sql).toContain('(1, 7, 180.5, 0.067)');
    });

    it('deletes any charging test a car can no longer have', () => {
        expect(sql).toContain("DELETE FROM public.runs WHERE kind = 'charging' AND green_ncap_assessment_id = (SELECT id FROM public.green_ncap_assessments WHERE slug = 'vw-id3-2021-0060');");
    });

    it('deletes any range test a car can no longer have', () => {
        expect(sql).toContain("DELETE FROM public.runs WHERE kind = 'range' AND green_ncap_assessment_id = (SELECT id FROM public.green_ncap_assessments WHERE slug = 'vw-id3-2021-0060');");
    });
});
