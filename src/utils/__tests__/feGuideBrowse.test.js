import { describe, it, expect } from 'vitest';
import {
    wheelSizeIn, splitCarlineClass, bodyClassLabel, cityHwyRatio, isCollapsedRow,
    decorateRow, GUIDE_COLUMNS, DEFAULT_COLUMNS, columnByKey, formatCell,
    buildFacets, filterRows, sortRows, EMPTY_FILTERS,
    encodeGuideParams, decodeGuideParams, computeBarMaxima, barPercent,
    buildBrandIndex, resolveBrand, driveGroup,
} from '../feGuideBrowse';

describe('wheelSizeIn', () => {
    // The two conventions actually present in the corpus.
    it('reads BMW’s double-apostrophe form', () => {
        expect(wheelSizeIn("i4 eDrive40 Gran Coupe (19'' Wheels)")).toBe(19);
    });
    it('reads Rivian’s "20in" form', () => {
        expect(wheelSizeIn('R1S All-Terrain Dual Max (20in)')).toBe(20);
    });
    it('reads Porsche’s unbracketed form', () => {
        expect(wheelSizeIn('Taycan 4S Perf Battery Plus 19in All-Season (M+S)')).toBe(19);
    });
    it('is null when the maker does not state it — 57% of the corpus', () => {
        expect(wheelSizeIn('Model 3 Performance AWD')).toBeNull();
        expect(wheelSizeIn('Electrified GV70')).toBeNull();
    });
    // A trim number that happens to be two digits must not become a wheel.
    it('rejects two-digit numbers outside any plausible wheel band', () => {
        expect(wheelSizeIn('EQS 680 4MATIC Maybach 99in')).toBeNull();
    });
});

describe('splitCarlineClass', () => {
    // The reason this exists: the drivetrain suffix splits one body in two.
    it('groups a class across its drivetrain variants', () => {
        expect(bodyClassLabel('Standard Pick-up Trucks 4WD')).toBe('Standard Pickup');
        expect(bodyClassLabel('Standard Pick-up Trucks 2WD')).toBe('Standard Pickup');
    });
    it('splits size from body', () => {
        expect(splitCarlineClass('Small SUV 4WD')).toEqual({ body: 'SUV', size: 'Small' });
        expect(splitCarlineClass('Large Cars')).toEqual({ body: 'Car', size: 'Large' });
    });
    it('handles the classes with no size word', () => {
        expect(bodyClassLabel('Two Seaters')).toBe('Two Seater');
    });
    it('passes an unrecognised class through rather than bucketing it', () => {
        // A value EPA adds later must not be silently folded into "SUV".
        expect(bodyClassLabel('Hovercraft 4WD')).toBe('Hovercraft');
    });
    it('is null for a blank class', () => {
        expect(bodyClassLabel(null)).toBeNull();
    });
});

describe('cityHwyRatio', () => {
    it('divides city by highway', () => {
        expect(cityHwyRatio({ label_city_mpge: 110, label_hwy_mpge: 95 })).toBeCloseTo(1.158, 3);
    });
    it('is null when either side is missing or highway is zero', () => {
        expect(cityHwyRatio({ label_city_mpge: 110 })).toBeNull();
        expect(cityHwyRatio({ label_city_mpge: 110, label_hwy_mpge: 0 })).toBeNull();
    });
});

describe('isCollapsedRow', () => {
    // parseFeGuide warns that `# Drive Motor Gen` is a union when EPA folds
    // several configurations into one row. The Taycan reads 9.
    it('flags a motor count no EV has', () => {
        expect(isCollapsedRow({ motor_count: 9 })).toBe(true);
        expect(isCollapsedRow({ motor_count: 6 })).toBe(true);
    });
    it('leaves real counts alone', () => {
        expect(isCollapsedRow({ motor_count: 4 })).toBe(false);
        expect(isCollapsedRow({ motor_count: 1 })).toBe(false);
        expect(isCollapsedRow({ motor_count: null })).toBe(false);
    });
});

describe('columns', () => {
    it('has no duplicate keys', () => {
        const keys = GUIDE_COLUMNS.map(c => c.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
    it('every default column is a real column', () => {
        DEFAULT_COLUMNS.forEach(k => expect(columnByKey(k)).not.toBeNull());
    });
    it('renders an absent value as an em dash, never as zero', () => {
        const col = columnByKey('label_comb_mpge');
        expect(formatCell({ label_comb_mpge: null }, col)).toBe('—');
        expect(formatCell({ label_comb_mpge: 0 }, col)).toBe('0');
    });
    it('keeps EPA’s three-decimal precision on the unadjusted figures', () => {
        // 154.214 vs 154.2 is the difference that makes the derivation check
        // meaningful — see #226.
        expect(formatCell({ unadj_city_mpge: 154.214 }, columnByKey('unadj_city_mpge'))).toBe('154.214');
    });
});

describe('facets', () => {
    const rows = [
        { model_year: 2026, division: 'BMW', motor_count: 2, carline: 'iX (20in)', carline_class: 'Standard SUV 4WD', drive_desc: 'All Wheel Drive' },
        { model_year: 2025, division: 'Porsche', motor_count: 9, carline: 'Taycan GTS', carline_class: 'Large Cars', drive_desc: 'All Wheel Drive' },
    ].map(decorateRow);

    it('lists years newest first', () => {
        expect(buildFacets(rows).years).toEqual([2026, 2025]);
    });
    it('omits a collapsed row’s motor count, which describes no real car', () => {
        expect(buildFacets(rows).motorCounts).toEqual([2]);
    });
    it('offers only wheel sizes that were actually stated', () => {
        expect(buildFacets(rows).wheelSizes).toEqual([20]);
    });
});

describe('filterRows', () => {
    const rows = [
        { model_year: 2026, division: 'BMW', carline: 'iX xDrive45', label_comb_range_mi: 312, label_comb_mpge: 94, carline_class: 'Standard SUV 4WD' },
        { model_year: 2025, division: 'Rivian', carline: 'R1S Dual Max (20in)', label_comb_range_mi: 380, label_comb_mpge: 80, carline_class: 'Standard SUV 4WD' },
    ].map(decorateRow);

    it('an empty filter returns everything', () => {
        expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(2);
    });
    it('filters by year and by make', () => {
        expect(filterRows(rows, { years: [2026] })).toHaveLength(1);
        expect(filterRows(rows, { makes: ['Rivian'] })[0].division).toBe('Rivian');
    });
    it('filters by a numeric range', () => {
        expect(filterRows(rows, { minRange: 350 })).toHaveLength(1);
        expect(filterRows(rows, { maxMpge: 85 })[0].division).toBe('Rivian');
    });
    it('searches make, carline and test group', () => {
        expect(filterRows(rows, { search: 'r1s' })).toHaveLength(1);
        expect(filterRows(rows, { search: 'xdrive' })).toHaveLength(1);
    });
    it('combines filters conjunctively', () => {
        expect(filterRows(rows, { years: [2026], makes: ['Rivian'] })).toHaveLength(0);
    });
});

describe('sortRows', () => {
    const rows = [
        { model_year: 2026, label_comb_range_mi: 312, division: 'BMW' },
        { model_year: 2025, label_comb_range_mi: null, division: 'Audi' },
        { model_year: 2024, label_comb_range_mi: 380, division: 'Rivian' },
    ];
    it('sorts numerically, not lexically', () => {
        expect(sortRows(rows, 'label_comb_range_mi', 'asc').map(r => r.label_comb_range_mi))
            .toEqual([312, 380, null]);
    });
    it('keeps nulls last in BOTH directions — an absence is not a low value', () => {
        expect(sortRows(rows, 'label_comb_range_mi', 'desc').map(r => r.label_comb_range_mi))
            .toEqual([380, 312, null]);
    });
    it('sorts text case-insensitively by locale', () => {
        expect(sortRows(rows, 'division', 'asc').map(r => r.division)).toEqual(['Audi', 'BMW', 'Rivian']);
    });
    it('returns the input unchanged for an unknown column', () => {
        expect(sortRows(rows, 'nope')).toBe(rows);
    });
});

describe('URL round-trip', () => {
    it('writes nothing for a default state', () => {
        const p = encodeGuideParams({ filters: EMPTY_FILTERS, sortKey: null, sortDir: 'desc', page: 0 });
        expect(p.toString()).toBe('');
    });
    it('round-trips filters, sort and page', () => {
        const state = {
            filters: { ...EMPTY_FILTERS, years: [2026], makes: ['BMW', 'Rivian'], wheelSizes: [20, 22], minRange: 300, search: 'r1s' },
            sortKey: 'label_comb_mpge', sortDir: 'asc', page: 2,
        };
        const decoded = decodeGuideParams(encodeGuideParams(state).toString());
        expect(decoded.filters.years).toEqual([2026]);
        expect(decoded.filters.makes).toEqual(['BMW', 'Rivian']);
        expect(decoded.filters.wheelSizes).toEqual([20, 22]);
        expect(decoded.filters.minRange).toBe(300);
        expect(decoded.filters.search).toBe('r1s');
        expect(decoded.sortKey).toBe('label_comb_mpge');
        expect(decoded.sortDir).toBe('asc');
        expect(decoded.page).toBe(2);
    });
    it('keeps numeric facets numeric, so they match the row values', () => {
        // Years arrive from the URL as text; a string 2026 would match nothing.
        const { filters } = decodeGuideParams('y=2026&mo=2');
        expect(filters.years).toEqual([2026]);
        expect(filters.motorCounts).toEqual([2]);
    });
    it('falls back rather than throwing on junk', () => {
        const d = decodeGuideParams('sort=drop%20table&dir=sideways&pg=-4&y=abc');
        expect(d.sortKey).toBe('label_comb_range_mi');
        expect(d.sortDir).toBe('desc');
        expect(d.page).toBe(0);
        expect(d.filters.years).toEqual([]);
    });
});

describe('magnitude bars', () => {
    const rows = [
        { label_comb_range_mi: 520, label_city_range_mi: 545, nominal_pack_kwh: 120 },
        { label_comb_range_mi: 330, label_city_range_mi: 340, nominal_pack_kwh: null },
        { label_comb_range_mi: null, label_city_range_mi: null, nominal_pack_kwh: 60 },
    ];
    const maxima = computeBarMaxima(rows);

    it('shares one scale across columns measured in the same unit', () => {
        // Range columns are the same physical quantity: 545 is the longest
        // range anywhere in the set, so it — and nothing shorter — fills a cell.
        expect(maxima.mi).toBe(545);
        expect(barPercent(rows[0], columnByKey('label_city_range_mi'), maxima)).toBe(100);
        expect(barPercent(rows[0], columnByKey('label_comb_range_mi'), maxima)).toBeCloseTo(95.4, 1);
    });
    it('keeps unlike units on separate scales', () => {
        expect(maxima.kWh).toBe(120);
        expect(barPercent(rows[2], columnByKey('nominal_pack_kwh'), maxima)).toBe(50);
    });
    it('scales zero-based, so 330 of 545 reads as about 60%', () => {
        expect(barPercent(rows[1], columnByKey('label_comb_range_mi'), maxima)).toBeCloseTo(60.6, 1);
    });
    it('draws no bar where there is no value — an absence is not a zero', () => {
        // Number(null) is 0 and 0 is finite, so this is the guard that stops a
        // missing range rendering as an empty bar implying a measured zero.
        expect(barPercent(rows[2], columnByKey('label_comb_range_mi'), maxima)).toBeNull();
    });
    it('is null for a column that carries no bar', () => {
        expect(barPercent(rows[0], columnByKey('label_comb_mpge'), maxima)).toBeNull();
    });
    it('rescales when the filter narrows', () => {
        const narrowed = computeBarMaxima([rows[1]]);
        expect(barPercent(rows[1], columnByKey('label_city_range_mi'), narrowed)).toBe(100);
    });
});

describe('shareable comparison', () => {
    it('carries the checked rows in the URL', () => {
        const p = encodeGuideParams({ filters: EMPTY_FILTERS, sortKey: null, sortDir: 'desc', page: 0, selectedIds: [12, 47] });
        expect(p.get('sel')).toBe('12,47');
        expect(decodeGuideParams(p.toString()).selectedIds).toEqual([12, 47]);
    });
    it('decodes ids as numbers, so they match the row ids they are compared to', () => {
        const ids = decodeGuideParams('sel=12,47').selectedIds;
        expect(ids.every(id => typeof id === 'number')).toBe(true);
    });
    it('writes nothing when nothing is selected', () => {
        expect(encodeGuideParams({ filters: EMPTY_FILTERS, sortKey: null, sortDir: 'desc', page: 0, selectedIds: [] }).has('sel')).toBe(false);
        expect(decodeGuideParams('').selectedIds).toEqual([]);
    });
    it('drops junk ids rather than carrying them into a lookup', () => {
        expect(decodeGuideParams('sel=12,abc,,47').selectedIds).toEqual([12, 47]);
    });

describe('the column list round-trips through the URL', () => {
    const base = { filters: EMPTY_FILTERS, sortKey: null, sortDir: 'desc', page: 0 };

    it('carries the order, not just the set', () => {
        // Order is half of what is stored: two people ticking the same ten
        // columns should still be able to arrange them differently.
        const columns = ['carline', 'label_comb_range_mi', 'brand', 'model_year'];
        const p = encodeGuideParams({ ...base, columns });
        expect(decodeGuideParams(p.toString()).columns).toEqual(columns);
    });

    it('says nothing when the columns are the default', () => {
        // An ordinary link should not carry ten keys nobody changed.
        expect(encodeGuideParams({ ...base, columns: DEFAULT_COLUMNS }).has('cols')).toBe(false);
        expect(decodeGuideParams('').columns).toEqual(DEFAULT_COLUMNS);
    });

    it('drops a key that no longer exists rather than rendering a dead column', () => {
        const d = decodeGuideParams('cols=carline,not_a_column,brand');
        expect(d.columns).toEqual(['carline', 'brand']);
    });

    it('falls back to the default when nothing survives', () => {
        // A table with no columns is worse than the wrong columns.
        expect(decodeGuideParams('cols=gone,also_gone').columns).toEqual(DEFAULT_COLUMNS);
    });
});
});

describe('brand resolution', () => {
    const aliases = [
        { alias: 'Lucid USA Inc.', alias_key: 'lucid usa inc.', manufacturers: { name: 'Lucid', parent_name: null } },
        { alias: 'KIA MOTORS CORPORATION', alias_key: 'kia motors corporation', manufacturers: { name: 'Kia', parent_name: 'Hyundai Motor Group' } },
        { alias: 'Chevrolet', alias_key: 'chevrolet', manufacturers: { name: 'Chevrolet', parent_name: 'General Motors' } },
    ];
    const index = buildBrandIndex(aliases);

    it('folds EPA’s filing spellings onto one brand', () => {
        expect(resolveBrand('Lucid USA Inc.', index).brand).toBe('Lucid');
        expect(resolveBrand('KIA MOTORS CORPORATION', index).brand).toBe('Kia');
    });
    it('matches case- and whitespace-insensitively, because EPA shouts', () => {
        expect(resolveBrand('  kia motors corporation  ', index).brand).toBe('Kia');
    });
    it('carries the corporate parent through', () => {
        expect(resolveBrand('Chevrolet', index).parent).toBe('General Motors');
    });
    it('falls back to EPA’s own text when nothing claims it, and says so', () => {
        const r = resolveBrand('Bugatti Rimac', index);
        expect(r.brand).toBe('Bugatti Rimac');
        expect(r.mapped).toBe(false);
    });
    it('survives being handed something that is not an index', () => {
        // rows.map(decorateRow) passes the array index as the second argument.
        // A cosmetic feature must not take the table down over it.
        expect(resolveBrand('Rivian', 3).brand).toBe('Rivian');
        expect(resolveBrand('Rivian', undefined).brand).toBe('Rivian');
        expect(() => decorateRow({ carline: 'R1S', division: 'Rivian' }, 0)).not.toThrow();
    });
    it('decorates a row with brand, parent and mapped-ness', () => {
        const d = decorateRow({ carline: 'Air', division: 'Lucid USA Inc.' }, index);
        expect(d.brand).toBe('Lucid');
        expect(d.brand_mapped).toBe(true);
        expect(d.division).toBe('Lucid USA Inc.');   // the source is never rewritten
    });
});

describe('driveGroup', () => {
    // EPA's three all-wheel labels describe hardware distinctions that do not
    // exist on an EV. The data proves it: `Part-time 4-Wheel Drive` is used by
    // exactly one manufacturer (Rivian, 80 rows), and 82 of the 118 plain
    // `4-Wheel Drive` rows are ALSO Rivian — the same clutch-disconnect
    // mechanism split across two labels by the same maker.
    it('collapses every all-wheel variant into one', () => {
        expect(driveGroup('All Wheel Drive')).toBe('All Wheel Drive');
        expect(driveGroup('4-Wheel Drive')).toBe('All Wheel Drive');
        expect(driveGroup('Part-time 4-Wheel Drive')).toBe('All Wheel Drive');
    });
    it('keeps front and rear apart, which is a real distinction', () => {
        expect(driveGroup('2-Wheel Drive, Rear')).toBe('Rear Wheel Drive');
        expect(driveGroup('2-Wheel Drive, Front')).toBe('Front Wheel Drive');
    });
    it('passes an unrecognised description through rather than guessing', () => {
        expect(driveGroup('Six Wheel Drive')).toBe('Six Wheel Drive');
    });
    it('is null when EPA said nothing', () => {
        expect(driveGroup(null)).toBeNull();
        expect(driveGroup('  ')).toBeNull();
    });
    it('never loses EPA’s own wording', () => {
        const d = decorateRow({ carline: 'R1S', drive_desc: 'Part-time 4-Wheel Drive' }, undefined);
        expect(d.drive_group).toBe('All Wheel Drive');
        expect(d.drive_desc).toBe('Part-time 4-Wheel Drive');
    });
});
