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
