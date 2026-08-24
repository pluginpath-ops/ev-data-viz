import { describe as suite, it, expect } from 'vitest';
import { decorateRow } from '../feGuideBrowse';
import {
    quantile, describe as summarize1, toObservations, summarise, overall,
    histogram, extremes, observationLabel, UNITS, DEFAULT_UNIT, MEASURES,
    applyStatsFilters, bestCoveredYear, yearsPresent,
} from '../epaGuideStats';

/**
 * A guide row, decorated the way the view decorates them.
 *
 * `carline_class` uses an `in` check rather than `??`, so a test can pass an
 * explicit null to mean "this row has no class" — `??` would coalesce it back
 * to the default and quietly test the opposite of what was written.
 */
const row = (o) => decorateRow({
    id: o.id, model_year: o.year ?? 2026, division: o.make ?? 'BMW',
    carline: o.carline ?? 'x', smog_test_group: o.tg ?? `tg-${o.id}`,
    carline_class: 'cls' in o ? o.cls : 'Standard SUV 4WD',
    label_comb_mpge: o.mpge, label_city_mpge: o.city, label_hwy_mpge: o.hwy,
    label_comb_range_mi: o.range, nominal_pack_kwh: o.pack, motor_count: o.motors ?? 2,
}, undefined);

suite('quantile', () => {
    it('interpolates rather than picking a neighbour', () => {
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([1, 2, 3], 0.5)).toBe(2);
    });
    it('handles the degenerate cases', () => {
        expect(quantile([], 0.5)).toBeNull();
        expect(quantile([7], 0.5)).toBe(7);
    });
});

suite('describe', () => {
    it('reports the five-number summary and n', () => {
        const d = summarize1([1, 2, 3, 4, 5]);
        expect(d).toMatchObject({ n: 5, min: 1, median: 3, max: 5 });
    });
    it('ignores nulls and blanks rather than counting them as zero', () => {
        // Number(null) is 0 and finite; counting it would drag every median.
        expect(summarize1([10, null, 20, '', undefined]).n).toBe(2);
        expect(summarize1([10, null, 20]).median).toBe(15);
    });
    it('is all-null for an empty set, never zero', () => {
        expect(summarize1([])).toMatchObject({ n: 0, median: null });
    });
});

suite('unit of analysis', () => {
    // The corpus problem in miniature: one make files four variants of a single
    // certified vehicle, another files one.
    const rows = [
        row({ id: 1, make: 'Rivian', tg: 'R', mpge: 70 }),
        row({ id: 2, make: 'Rivian', tg: 'R', mpge: 72 }),
        row({ id: 3, make: 'Rivian', tg: 'R', mpge: 74 }),
        row({ id: 4, make: 'Rivian', tg: 'R', mpge: 76 }),
        row({ id: 5, make: 'Mazda',  tg: 'M', mpge: 100 }),
    ];

    it('per configuration counts every variant', () => {
        expect(toObservations(rows, 'config')).toHaveLength(5);
    });
    it('per test group collapses the variants EPA certified together', () => {
        const obs = toObservations(rows, 'test_group');
        expect(obs).toHaveLength(2);
        // Median of 70/72/74/76, not the first or the mean of a skewed set.
        expect(obs.find(o => o.brand === 'Rivian').label_comb_mpge).toBe(73);
    });
    it('per make collapses to one row per brand', () => {
        expect(toObservations(rows, 'make')).toHaveLength(2);
    });
    it('changes the answer, which is why the unit is a visible choice', () => {
        const perConfig = overall(rows, { unit: 'config', measure: 'label_comb_mpge' }).median;
        const perGroup  = overall(rows, { unit: 'test_group', measure: 'label_comb_mpge' }).median;
        expect(perConfig).toBe(74);     // dragged toward the make with four rows
        expect(perGroup).toBe(86.5);    // one vote each
        expect(perConfig).not.toBe(perGroup);
    });
    it('records how many rows each observation stands for', () => {
        const obs = toObservations(rows, 'test_group');
        expect(obs.find(o => o.brand === 'Rivian')._n).toBe(4);
        expect(obs.find(o => o.brand === 'Mazda')._n).toBe(1);
    });
    it('every declared unit is implemented', () => {
        UNITS.forEach(u => expect(toObservations([row({ id: 1, mpge: 1 })], u.key)).toHaveLength(1));
    });
    it('defaults to the test group', () => {
        expect(DEFAULT_UNIT).toBe('test_group');
    });
});

suite('summarise', () => {
    const rows = [
        row({ id: 1, cls: 'Standard Pick-up Trucks 4WD', mpge: 64 }),
        row({ id: 2, cls: 'Standard Pick-up Trucks 2WD', mpge: 70 }),
        row({ id: 3, cls: 'Standard Pick-up Trucks 4WD', mpge: 67 }),
        row({ id: 4, cls: 'Large Cars', mpge: 100 }),
        row({ id: 5, cls: 'Large Cars', mpge: 104 }),
        row({ id: 6, cls: 'Large Cars', mpge: 108 }),
    ];

    it('groups a class across its drivetrain variants', () => {
        // The whole reason splitCarlineClass exists: 4WD and 2WD pickups are
        // one body, and grouping on the raw string reports two classes.
        const out = summarise(rows, { dimension: 'body_class', measure: 'label_comb_mpge' });
        expect(out.map(b => b.bucket).sort()).toEqual(['Large Car', 'Standard Pickup']);
    });
    it('reports n per bucket', () => {
        const out = summarise(rows, { dimension: 'body_class', measure: 'label_comb_mpge' });
        expect(out.find(b => b.bucket === 'Standard Pickup').n).toBe(3);
    });
    it('marks thin buckets suppressed instead of dropping them', () => {
        const thin = [...rows, row({ id: 7, cls: 'Two Seaters', mpge: 90 })];
        const out = summarise(thin, { dimension: 'body_class', measure: 'label_comb_mpge', minN: 3 });
        const seater = out.find(b => b.bucket === 'Two Seater');
        expect(seater.suppressed).toBe(true);
        expect(seater.n).toBe(1);
    });
    it('sinks suppressed buckets below the reportable ones', () => {
        const thin = [...rows, row({ id: 7, cls: 'Two Seaters', mpge: 999 })];
        const out = summarise(thin, { dimension: 'body_class', measure: 'label_comb_mpge', minN: 3 });
        // Despite the highest median, it must not top the ranking on n=1.
        expect(out[out.length - 1].bucket).toBe('Two Seater');
    });
    it('skips rows with no value for the dimension', () => {
        const out = summarise([...rows, row({ id: 8, cls: null, mpge: 50 })],
            { dimension: 'body_class', measure: 'label_comb_mpge' });
        expect(out.reduce((s, b) => s + b.n, 0)).toBe(6);
    });
});

suite('histogram', () => {
    it('bins equal-width so a pile at one value stays visible', () => {
        // The adjustment factor's spike at exactly 0.700 is the finding;
        // quantile bins would smear it across buckets.
        const rows = [0.7, 0.7, 0.7, 0.7, 0.9].map((v, i) =>
            row({ id: i, tg: `t${i}`, mpge: v * 100 }));
        const h = histogram(rows, { measure: 'label_comb_mpge', bins: 4 });
        expect(h.n).toBe(5);
        expect(h.bins[0].count).toBe(4);
        expect(h.bins[3].count).toBe(1);
    });
    it('puts the maximum in the last bin, not past the end', () => {
        const rows = [1, 2, 3].map((v, i) => row({ id: i, tg: `t${i}`, mpge: v }));
        const h = histogram(rows, { measure: 'label_comb_mpge', bins: 2 });
        expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(3);
    });
    it('survives every value being identical', () => {
        const rows = [5, 5].map((v, i) => row({ id: i, tg: `t${i}`, mpge: v }));
        expect(histogram(rows, { measure: 'label_comb_mpge' }).bins).toHaveLength(1);
    });
});

suite('extremes', () => {
    const rows = [
        row({ id: 1, carline: 'Slow', city: 80, hwy: 100 }),   // ratio 0.8
        row({ id: 2, carline: 'Mid',  city: 100, hwy: 100 }),  // 1.0
        row({ id: 3, carline: 'Town', city: 130, hwy: 100 }),  // 1.3
    ];
    it('names both tails', () => {
        const e = extremes(rows, { measure: 'city_hwy_ratio', count: 1 });
        expect(e.highest[0].carline).toBe('Town');
        expect(e.lowest[0].carline).toBe('Slow');
    });
    it('labels an observation readably', () => {
        expect(observationLabel(rows[0])).toBe('2026 BMW Slow');
    });
});

suite('measures', () => {
    it('every measure key is distinct', () => {
        const keys = MEASURES.map(m => m.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

suite('identity without an id column', () => {
    // A projection that omits `id` used to make every row share one bucket, so
    // the corpus collapsed to a single observation and reported a median of one
    // number with nothing to say it had happened.
    const bare = (o) => decorateRow({
        model_year: 2026, division: o.make, carline: o.carline,
        model_type_index: o.idx, smog_test_group: o.tg,
        label_comb_mpge: o.mpge, carline_class: 'Large Cars',
    }, undefined);

    const rows = [
        bare({ make: 'BMW', carline: 'i4', idx: '1', tg: 'a', mpge: 100 }),
        bare({ make: 'BMW', carline: 'i5', idx: '2', tg: 'b', mpge: 110 }),
        bare({ make: 'BMW', carline: 'i7', idx: '3', tg: 'c', mpge: 120 }),
    ];

    it('keeps configurations distinct via the natural key', () => {
        expect(toObservations(rows, 'config')).toHaveLength(3);
        expect(overall(rows, { unit: 'config', measure: 'label_comb_mpge' }).n).toBe(3);
    });
    it('separates configurations sharing a carline but not a model type index', () => {
        // Audi lists "Q6 e-tron quattro" three times in MY27 at different ranges.
        const audi = [
            bare({ make: 'Audi', carline: 'Q6 e-tron quattro', idx: '1', tg: 'x', mpge: 90 }),
            bare({ make: 'Audi', carline: 'Q6 e-tron quattro', idx: '2', tg: 'y', mpge: 95 }),
        ];
        expect(toObservations(audi, 'config')).toHaveLength(2);
    });
    it('does not merge unrelated vehicles that both lack a test group', () => {
        const noTg = [
            bare({ make: 'A', carline: 'one', idx: '1', tg: null, mpge: 50 }),
            bare({ make: 'B', carline: 'two', idx: '2', tg: null, mpge: 150 }),
        ];
        expect(toObservations(noTg, 'test_group')).toHaveLength(2);
    });
});

suite('filters and defaults are shared, not duplicated', () => {
    // Guide rows and certification observations are given the same three
    // dimension field names on purpose, so one filter serves both. Written
    // twice, the second copy drifts the first time a filter is added.
    const obs = (o) => ({ model_year: o.y, body_class: o.c, drive_group: o.d, v: o.v });
    const set = [
        obs({ y: 2025, c: 'Small SUV', d: 'All Wheel Drive', v: 1 }),
        obs({ y: 2025, c: 'Large Car', d: 'Rear Wheel Drive', v: 2 }),
        obs({ y: 2024, c: 'Small SUV', d: 'All Wheel Drive', v: 3 }),
        obs({ y: 2024, c: 'Small SUV', d: 'Rear Wheel Drive', v: 4 }),
        // 2024 genuinely better-covered than 2025 — three against two — so the
        // assertion below is about coverage and not about the tie-break.
        obs({ y: 2024, c: 'Large Car', d: 'Rear Wheel Drive', v: 5 }),
    ];

    it('narrows by year, class and drive together', () => {
        expect(applyStatsFilters(set, { years: [2024], classes: ['Small SUV'], drives: ['All Wheel Drive'] }))
            .toHaveLength(1);
    });
    it('an empty filter narrows nothing', () => {
        expect(applyStatsFilters(set, {})).toHaveLength(5);
    });
    it('does NOT apply a filter whose control is hidden', () => {
        // A filter the reader cannot see must not remove rows, or they vanish
        // with nothing on screen to explain it.
        expect(applyStatsFilters(set, { classes: ['Small SUV'], showClass: false })).toHaveLength(5);
        expect(applyStatsFilters(set, { drives: ['Rear Wheel Drive'], showDrive: false })).toHaveLength(5);
    });

    it('picks the best-covered year, not the newest', () => {
        // EPA files a year over many months, so the newest is always thinnest.
        expect(bestCoveredYear(set)).toBe(2024);
    });
    it('breaks a tie toward the newer year', () => {
        expect(bestCoveredYear([obs({ y: 2025, v: 1 }), obs({ y: 2024, v: 2 })])).toBe(2025);
    });
    it('lists only the years actually present, newest first', () => {
        // The certification records cover four years where the guide covers
        // six; offering a year with no data is a filter that answers nothing.
        expect(yearsPresent(set)).toEqual([2025, 2024]);
    });
    it('survives an empty set', () => {
        expect(bestCoveredYear([])).toBeNull();
        expect(yearsPresent([])).toEqual([]);
    });
});
