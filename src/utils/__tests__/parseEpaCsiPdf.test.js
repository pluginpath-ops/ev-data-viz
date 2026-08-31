import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseEpaCsiText, parseCoveredModels } from '../parseEpaCsiPdf';

/**
 * The fixture is the real pdf.js item stream from Volvo's CSI-VVVXT00.0ZVG,
 * trimmed to the identity fields plus the two items that make reading them
 * hard. The PDF lives in LocalDev and is gitignored, so the slice is committed
 * instead — real strings, real order.
 *
 * It is a CARRYOVER certification, which is the only shape where the bug in
 * migration 056 is visible: a MY2027 certificate whose emission data vehicles
 * were tested a year earlier under a different test group. On a normal
 * certification the two agree and nothing distinguishes right from wrong.
 *
 * It deliberately contains, in stream order:
 *   • the page-1 "Test Group" field and "Model Year" field
 *   • the "Official Test Numbers" column header, which is ALSO the bare string
 *     "Test Group" but whose next item is "Fuel", not an ID
 *   • one page footer, which repeats "Test Group" a third time
 *   • both configurations, each carrying the "Original …" pair
 *   • each configuration's equivalent test weight and City/Highway coefficient
 *     row, so the two configs differ where the real document differs — the 20"
 *     set reads A=40.75 and the 21" set A=35.74
 */
const ITEMS = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/csiCarryoverItems.json'),
    'utf8',
));

describe('parseEpaCsiText — certification identity vs carryover source', () => {
    const { groups } = parseEpaCsiText(ITEMS);

    it('finds both configurations', () => {
        expect(groups).toHaveLength(2);
        expect(groups.map(g => g.test_group_id)).toEqual(['202625-2', '202625-3']);
    });

    it('takes the model year from page 1, not from the carryover source', () => {
        // The failure this exists for: every config states 2026 as its
        // "Original Test Vehicle Model Year", and the certificate is 2027.
        expect(groups.map(g => g.model_year)).toEqual([2027, 2027]);
    });

    it('takes the test group from page 1, not from the carryover source', () => {
        // VVVXT00.0ZVG is what the Fuel Economy Guide carries as
        // "#1 Smog Rating Test Group"; TVVXT00.0ZVG joins to nothing.
        expect(groups.map(g => g.epa_test_family_id))
            .toEqual(['VVVXT00.0ZVG', 'VVVXT00.0ZVG']);
    });

    it('keeps the carryover source rather than discarding it', () => {
        for (const g of groups) {
            expect(g.carryover_test_group_id).toBe('TVVXT00.0ZVG');
            expect(g.carryover_model_year).toBe(2026);
        }
    });

    it('is not fooled by the "Official Test Numbers" column header', () => {
        // That header is the bare string "Test Group" followed by "Fuel". Taking
        // it would put a fuel name in the test group column.
        expect(groups.map(g => g.epa_test_family_id)).not.toContain('Fuel');
    });

    it('reads the equivalent test weight onto every coefficient set', () => {
        // Stated once per configuration, above the coefficient table, and shared
        // by every category on it. It was never parsed at all, so the only mass
        // in the record was absent and the grade term of any elevation
        // calculation multiplied by nothing.
        for (const g of groups) {
            expect(g.coefficient_sets.length).toBeGreaterThan(0);
            for (const set of g.coefficient_sets) {
                expect(set.equiv_test_weight_lbs).toBe(6000);
            }
        }
    });

    it('keeps the two configurations distinct', () => {
        // Same test weight, different road load: config 2 is the 20"/22" set and
        // config 3 the 21". A fixture where both configs were identical could
        // not tell a per-config read from a first-occurrence read.
        expect(groups.map(g => g.coefficient_sets[0].target_a)).toEqual([40.75, 35.74]);
    });

    it('still reads the per-config fields', () => {
        expect(groups[0].make).toBe('Volvo');
        expect(groups[0].epa_carline_name).toBe('EX90 Twin Motor');
        expect(groups.map(g => g.vehicle_config_number)).toEqual(['2', '3']);
    });
});

describe('parseEpaCsiText — warnings', () => {
    it('says out loud that the results are an earlier year\'s lab work', () => {
        const { warnings } = parseEpaCsiText(ITEMS);
        const carryover = warnings.find(w => w.startsWith('Carryover certification:'));
        expect(carryover).toBeDefined();
        expect(carryover).toContain('MY2027');
        expect(carryover).toContain('MY2026');
        expect(carryover).toContain('TVVXT00.0ZVG');
    });

    it('warns once, not once per configuration', () => {
        const { warnings } = parseEpaCsiText(ITEMS);
        expect(warnings.filter(w => w.startsWith('Carryover certification:'))).toHaveLength(1);
    });

    it('stays quiet when the certification did not carry anything over', () => {
        // Same document with the two years agreeing.
        const same = ITEMS.map((s, i) => (ITEMS[i - 1] === 'Original Test Vehicle Model Year' ? '2027' : s));
        const { groups, warnings } = parseEpaCsiText(same);
        expect(groups[0].model_year).toBe(2027);
        expect(warnings.filter(w => w.startsWith('Carryover certification:'))).toHaveLength(0);
    });
});

describe('parseEpaCsiText — falling back when page 1 is unreadable', () => {
    // Drop the entire page-1 preamble, leaving only the "Official Test Numbers"
    // column header and one page footer. This is the shape of a report whose
    // first page did not extract.
    const noPage1 = ITEMS.slice(34);

    it('recovers the test group from a footer', () => {
        // The first "Test Group" left in the stream is the column header, whose
        // value is "Fuel". Scanning past it reaches the footer's real ID.
        expect(parseEpaCsiText(noPage1).groups[0].epa_test_family_id).toBe('VVVXT00.0ZVG');
    });

    it('falls back to the carryover model year and says so', () => {
        // Nothing repeats the model year, so it genuinely cannot be recovered.
        const { groups, warnings } = parseEpaCsiText(noPage1);
        expect(groups[0].model_year).toBe(2026);
        expect(warnings.some(w => w.includes('No model year on page 1'))).toBe(true);
    });

    it('falls back to the carryover test group when nothing states one', () => {
        const noGroup = noPage1.filter(s => s !== 'VVVXT00.0ZVG');
        const { groups, warnings } = parseEpaCsiText(noGroup);
        expect(groups[0].epa_test_family_id).toBe('TVVXT00.0ZVG');
        expect(warnings.some(w => w.includes('No test group on page 1'))).toBe(true);
    });
});

describe('models covered by this certificate (#250)', () => {
    // Cells WRAP: EPA emits "296 - EX90 Twin" and "Motor" as separate items,
    // and "California + CAA" then "Section 177 states".
    const volvo = [
        'Models Covered by this Certificate', 'Carline Manufacturer', 'Division', 'Carline',
        'Certification Region', 'Code(s)', 'Drive System', 'Trans - Type', '- # of Gears', 'Trans - Lockup',
        'Volvo Car USA,  LLC', '1 - Volvo Cars of North', 'America, LLC', '296 - EX90 Twin', 'Motor',
        'California + CAA', 'Section 177 states', 'All Wheel Drive', 'Automatic', '1', 'No',
        'Volvo Car USA,  LLC', '1 - Volvo Cars of North', 'America, LLC', '297 - EX90 Twin',
        'Motor (21 inch Wheels)', 'Federal', 'All Wheel Drive', 'Automatic', '1', 'No',
        'Engine Description',
    ];

    it('rejoins a carline split across items, wheels and all', () => {
        const rows = parseCoveredModels(volvo);
        expect(rows.map(r => r.carline_name))
            .toEqual(['EX90 Twin Motor', 'EX90 Twin Motor (21 inch Wheels)']);
    });
    it('rejoins a region split across items', () => {
        expect(parseCoveredModels(volvo)[0].certification_region)
            .toBe('California + CAA Section 177 states');
    });
    it('keeps the carline number and the other columns', () => {
        const [first] = parseCoveredModels(volvo);
        expect(first).toMatchObject({
            carline_number: '296', drive_system: 'All Wheel Drive',
            transmission_type: 'Automatic', gears: 1,
        });
    });
    it('tells the division from the carline by position, not shape', () => {
        // Both look like "N - Name", and Lucid numbers carlines in single
        // digits: `2 - Lucid USA Inc.` is a division, `4 - Gravity GT` is not.
        const lucid = [
            'Models Covered by this Certificate',
            'Lucid USA, Inc.', '2 - Lucid USA Inc.', '4 - Gravity GT', 'w/20F21R wheels (3R)',
            'California + CAA', 'Section 177 states', 'All Wheel Drive', 'Automatic', '1', 'No',
            'Engine Description',
        ];
        const rows = parseCoveredModels(lucid);
        expect(rows).toHaveLength(1);
        expect(rows[0].carline_number).toBe('4');
        expect(rows[0].carline_name).toBe('Gravity GT w/20F21R wheels (3R)');
        expect(rows[0].division).toBe('Lucid USA Inc.');
    });
    it('stops at the next section rather than eating it', () => {
        // A scan without bounds swallowed "Multi-Cycle Test (MCT) Exhaust
        // Test #…" out of a later section as a carline.
        const withTail = [...volvo, '77 - Multi-Cycle Test (MCT) Exhaust Test # for this configuration'];
        expect(parseCoveredModels(withTail)).toHaveLength(2);
    });
    it('is empty when the certificate has no such table', () => {
        expect(parseCoveredModels(['Emission Data Vehicle Information', 'Vehicle ID'])).toEqual([]);
    });
});

describe('the certification\'s own model year', () => {
    /** pdf.js emits a separator between a label and its value. */
    const header = (year) => [
        'Manufacturer', ' ', 'Volvo', '',
        'Test Group', ' ', 'VVVXT00.0ZVG', '',
        'Model Year', ' ', String(year), '',
        'Test Group Information', '',
    ];
    const config = (carryYear) => [
        'Vehicle ID / Configuration', ' ', '202625-2', '',
        'Represented Test Vehicle Model', ' ', 'EX90 Twin Motor', '',
        'Original Test Group Name', ' ', 'TVVXT00.0ZVG', '',
        'Original Test Vehicle Model Year', ' ', String(carryYear), '',
    ];

    it('reads past the blank between label and value', () => {
        // valAfter returns the separator, parseNum makes that null, and every
        // certificate silently fell back to the carryover year.
        const { groups, warnings } = parseEpaCsiText([...header(2027), ...config(2026)]);
        expect(groups[0].model_year).toBe(2027);
        expect(warnings.some(w => w.includes('No model year'))).toBe(false);
    });

    it('keeps the certification year and the carryover year apart', () => {
        // The whole point of migration 056: a 2027 certificate carrying 2026
        // lab work is a 2027 record. Storing 2026 makes the guide-linking sweep
        // reject its own correct same-year candidate as a borrowed year.
        const { groups } = parseEpaCsiText([...header(2027), ...config(2026)]);
        expect(groups[0].model_year).toBe(2027);
        expect(groups[0].carryover_model_year).toBe(2026);
    });

    it('still falls back when page 1 genuinely has no year', () => {
        const noYear = ['Test Group', ' ', 'VVVXT00.0ZVG', '', 'Test Group Information', ''];
        const { groups, warnings } = parseEpaCsiText([...noYear, ...config(2026)]);
        expect(groups[0].model_year).toBe(2026);
        expect(warnings.some(w => w.includes('No model year'))).toBe(true);
    });

    it('does not read a non-year that follows the label', () => {
        const odd = ['Model Year', ' ', 'Fuel', '', 'Test Group', ' ', 'VVVXT00.0ZVG', ''];
        const { groups } = parseEpaCsiText([...odd, ...config(2026)]);
        expect(groups[0].model_year).toBe(2026);
    });
});

/**
 * A multi-cycle test's eight bags, as an item stream.
 *
 * Every proc-77 test in the corpus has exactly this shape — UDDS, HWY, UDDS,
 * constant speed, UDDS, HWY, UDDS, and then the rest of the constant-speed run
 * — so the distances are the real ones and only the last bag varies.
 */
const mctItems = (lastBagMi) => [
    'Vehicle ID / Configuration', 'SYNTH01 / 0',
    'Represented Test Vehicle Make', 'Synthetic',
    'Test #', 'T1', 'Test Procedure', '77 - Multi-Cycle Test (MCT)',
    ...[7.45, 10.26, 7.45, 281.31, 7.45, 10.26, 7.45, lastBagMi]
        .flatMap((mi, i) => [
            `Charge Depleting Bag/Phase #${i + 1}`,
            'Actual Distance Driven (miles)', String(mi),
            'Integrated DC KW-HRS', String((mi * 0.23).toFixed(4)),
        ]),
];

const phasesOf = (items) => parseEpaCsiText(items).groups[0].tests[0].phases;

describe('phase typing on import', () => {
    it('types the eight bags of a multi-cycle test', () => {
        expect(phasesOf(mctItems(59.72)).map(p => p.phase_type))
            .toEqual(['UDDS', 'HWY', 'UDDS', 'SS', 'UDDS', 'HWY', 'UDDS', 'SS']);
    });

    it('does not file the last bag as a highway cycle when it lands on 10.26 mi', () => {
        // Six records in the corpus have a last bag between 9.6 and 10.9 miles,
        // and every one of them was imported as HWY — a coincidence of where
        // the pack gave out, consuming 27% more than the same test's real HWFET
        // bags. That energy went into the cycle average (#264).
        expect(phasesOf(mctItems(10.72)).at(-1).phase_type).toBe('SS');
    });

    it('files a cold test\'s city bags under their own type', () => {
        // A property of the TEST, not of a bag's distance, so it stays here
        // rather than inside the shared inference.
        const cold = mctItems(59.72)
            .map(s => (s === '77 - Multi-Cycle Test (MCT)' ? '77 - Multi-Cycle Test (MCT) Cold' : s));
        expect(phasesOf(cold).map(p => p.phase_type))
            .toEqual(['Cold-UDDS', 'HWY', 'Cold-UDDS', 'SS', 'Cold-UDDS', 'HWY', 'Cold-UDDS', 'SS']);
    });

    it('carries the bag number and its measurements through', () => {
        const p = phasesOf(mctItems(59.72)).at(-1);
        expect(p).toMatchObject({ phase_index: 8, distance_mi: 59.72 });
        expect(p.dc_energy_kwh).toBeCloseTo(59.72 * 0.23, 3);
    });
});

/**
 * A single-cycle charge-depleting test with a real bag, which is the shape both
 * placeholder records in the corpus actually have: one
 * `Charge Depleting Bag/Phase #1` carrying the whole depletion.
 */
const cdItems = ({ dc, miles, ac }) => [
    'Vehicle ID / Configuration', 'SYNTH02 / 0',
    'Test #', 'T2', 'Test Procedure', '84 - Charge Depleting Highway',
    'Charge Depleting Range (Actual miles)', String(miles),
    'Recharge Event Energy (kiloWatt-hours)', String(ac),
    'Charge Depleting Bag/Phase #1',
    'Actual Distance Driven (miles)', String(miles),
    'Integrated DC KW-HRS', String(dc),
];
const testOf = (items) => parseEpaCsiText(items).groups[0].tests[0];

describe('a placeholder is not a measurement', () => {
    it('nulls a test whose energy, distance and recharge are all one number', () => {
        // Zoox filed 999.0 in all three; stored as written it became the
        // largest battery pack in the corpus.
        const t = testOf(cdItems({ dc: 999, miles: 999, ac: 999 }));
        expect(t.total_dc_energy_kwh).toBeNull();
        expect(t.total_distance_mi).toBeNull();
        expect(t.ac_recharge_kwh).toBeNull();
    });

    it('nulls the bag with it', () => {
        // Left behind, the sentinel would wait for someone to give that phase a
        // type and then reach the η back-solve as a 1,000 Wh/mi cycle.
        const [p] = testOf(cdItems({ dc: 1, miles: 1, ac: 1 })).phases;
        expect(p.distance_mi).toBeNull();
        expect(p.dc_energy_kwh).toBeNull();
    });

    it('keeps the test itself — it was conducted, it just reports nothing', () => {
        const t = testOf(cdItems({ dc: 999, miles: 999, ac: 999 }));
        expect(t.procedure_code).toBe(84);
        expect(t.test_number).toBe('T2');
        expect(t.phases).toHaveLength(1);
    });

    it('needs all three to agree, not two', () => {
        // Two can legitimately coincide — a test that drives as many miles as
        // it spends kWh is unremarkable. Three unrelated quantities in
        // different units landing on one value is a filled-in form. Across 360
        // stored tests exactly two match.
        const t = testOf(cdItems({ dc: 78.9, miles: 78.9, ac: 92.4 }));
        expect(t.total_dc_energy_kwh).toBe(78.9);
        expect(t.ac_recharge_kwh).toBe(92.4);
    });

    it('leaves a sound test alone', () => {
        // Tesla's Model Y CD-Highway: 78.946 kWh over 369 miles.
        const t = testOf(cdItems({ dc: 78.946, miles: 369, ac: 88.2 }));
        expect(t.total_dc_energy_kwh).toBe(78.946);
        expect(t.total_distance_mi).toBe(369);
        expect(t.phases[0].dc_energy_kwh).toBe(78.946);
    });
});
