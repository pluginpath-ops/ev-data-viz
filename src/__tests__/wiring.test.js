import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Does anything actually CALL the thing?
 *
 * Every other suite here checks that a function returns the right answer. None
 * of them can tell us nobody calls it — and that is the failure mode this
 * project keeps hitting. Three defects found by hand in one week were all
 * "built, unit-tested, never connected":
 *
 *   • the mixed-cycle badge, correct in the DOM and absent from the canvas
 *   • condition correction, wired into a fetch effect the dropdown never re-ran
 *   • the correction note, written to every run object and read by nothing
 *
 * Each passed its own tests. These check the seams instead.
 */

const read = (p) => readFileSync(p, 'utf8');

function sourceFiles(dir = 'src', out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') sourceFiles(p, out);
        } else if (/\.(js|jsx)$/.test(entry.name)) {
            out.push(p);
        }
    }
    return out;
}

const ALL = sourceFiles().map(f => ({ file: f, text: read(f) }));
const consumersOf = (name, exclude) =>
    ALL.filter(x => !exclude.some(e => x.file.endsWith(e)) && new RegExp(`\\b${name}\\b`).test(x.text))
       .map(x => x.file);

describe('utilities built for the UI are reached by the UI', () => {
    // Scoped to the modules built recently rather than the whole codebase: 48
    // exports are unused project-wide, nearly all pre-existing in the EPA and
    // parser modules. Widening this wants a cleanup first, not an allowlist.
    const WATCHED = ['conditionCorrection.js', 'testSessions.js', 'seriesLabel.js'];

    // Deliberately unused, and why. An entry here is a decision, not an oversight.
    const ALLOWED_UNUSED = {
        'testSessions.suggestedPairing':
            'Built and tested; surfacing it is a curation action awaiting its own review (#184).',
        'conditionCorrection.DEFAULT_CORRECTION_MODE':
            'The default value itself, consumed inside the module and by the chartConfig fallback literal.',
        'conditionCorrection.CORRECTION_MODES':
            'Consumed by CorrectionControl to render the picker.',
    };

    for (const mod of WATCHED) {
        const text = read(join('src/utils', mod));
        const exported = [...text.matchAll(/export (?:function|const) (\w+)/g)].map(m => m[1]);

        it(`every export of ${mod} has a consumer`, () => {
            const orphans = exported.filter(name => {
                const key = `${mod.replace('.js', '')}.${name}`;
                if (key in ALLOWED_UNUSED) return false;
                return consumersOf(name, [mod]).length === 0;
            });
            expect(orphans).toEqual([]);
        });
    }
});

describe('the seams that broke before', () => {
    it('reads the correction note it writes', () => {
        // It was written to every corrected run and read by nothing, so a
        // corrected bar looked exactly like a measured one.
        const writers = consumersOf('_correction', []).filter(f => /RangeChartView/.test(f));
        expect(writers.length).toBeGreaterThan(0);
        const view = read('src/components/RangeChartView.jsx');
        expect(view).toMatch(/_correction\?\.note/);
    });

    it('marks a mixed cycle wherever a test speed is shown', () => {
        // The marker existed in Tests & Data and not on the charts, so a
        // mixed-cycle bar sat unmarked beside steady-state ones.
        const speedDisplays = ALL.filter(x =>
            /\.jsx$/.test(x.file) && /fmtSpeed\(run\.speed_mph/.test(x.text));
        expect(speedDisplays.length).toBeGreaterThan(0);
        for (const { file, text } of speedDisplays) {
            expect(text, `${file} shows a test speed without the mixed-cycle marker`)
                .toMatch(/speedBasisNote/);
        }
    });

    it('routes every chart that resolves a range basis through the correction', () => {
        const resolvers = ALL.filter(x => /resolveRangeSource\(/.test(x.text) && /\.jsx$/.test(x.file));
        expect(resolvers.length).toBeGreaterThan(0);
        for (const { file, text } of resolvers) {
            expect(text, `${file} resolves a range basis but never corrects it`)
                .toMatch(/correction[:\s]|correctionFactor/);
        }
    });

    it('composes labels on every chart rather than hand-rolling them', () => {
        const charts = [
            'src/components/ChargingView.jsx',
            'src/components/RangeChartView.jsx',
            'src/components/ChargeCompareView.jsx',
            'src/components/RoadTripView.jsx',
            'src/components/PerformanceCurveView.jsx',
            'src/components/PerformanceCompareView.jsx',
        ];
        for (const f of charts) {
            expect(read(f), `${f} does not use the shared label composer`).toMatch(/buildSeriesLabels/);
        }
    });

    it('keeps vehicleLabel out of graph labelling', () => {
        // The vehicle's free-text name is a SELECTION label. Charts must compose
        // from atoms instead — see #170.
        const roadTrip = read('src/components/RoadTripView.jsx');
        const labelCalls = roadTrip.match(/label:\s*vehicleLabel\(/g) ?? [];
        expect(labelCalls).toEqual([]);
    });
});

describe('constants exposed for tuning are reachable in the Admin panel', () => {
    it('offers every correction constant as a knob', () => {
        // AERO_FRACTION drives every correction magnitude. It was made
        // overridable and left out of the panel, so nobody could tune it.
        const knobs = read('src/constants/knobs.js');
        for (const key of ['AERO_FRACTION', 'TOWING_AERO_FRACTION', 'REFERENCE_SPEED_MPH',
                           'STD_SPEED_MPH', 'STD_ALTITUDE_FT', 'STD_TEMP_F']) {
            expect(knobs, `${key} is tunable but absent from the Admin knobs`).toContain(key);
        }
    });

    it('defines every knob it advertises', () => {
        const knobs = read('src/constants/knobs.js');
        const epa = read('src/constants/epa.js');
        for (const key of [...knobs.matchAll(/key: '(\w+)'/g)].map(m => m[1])) {
            expect(epa, `knob ${key} has no default in EPA_DEFAULTS`).toContain(key);
        }
    });
});
