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
    const WATCHED = ['conditionCorrection.js', 'testSessions.js', 'seriesLabel.js', 'socAlignment.js'];

    // Deliberately unused, and why. An entry here is a decision, not an oversight.
    const ALLOWED_UNUSED = {
        'testSessions.suggestedPairing':
            'Built and tested; surfacing it is a curation action awaiting its own review (#184).',
        'conditionCorrection.DEFAULT_CORRECTION_MODE':
            'The default value itself, consumed inside the module and by the chartConfig fallback literal.',
        'conditionCorrection.CORRECTION_MODES':
            'Consumed by CorrectionControl to render the picker.',
        'socAlignment.EXTRAPOLATION_SOC_LIMIT':
            'The limit itself, consumed inside the module by overExtrapolated — which the chart does call.',
        'socAlignment.RAMP_PLATEAU_FRACTION':
            'Tuning constant for rampLength, exported to be named and testable rather than to be called.',
        'socAlignment.RAMP_TRIM_MIN_MINUTES':
            'The threshold that decides whether alignSeries trims at all; consumed inside the module and asserted by name.',
        'socAlignment.RAMP_MAX_TRIM':
            'As above — the cap on ramp trimming, asserted by name in the tests.',
        'socAlignment.trimRamp':
            'Called by alignSeries and minimumCommonSoc, both of which the chart calls. Exported so the trim can be asserted on its own.',
        'socAlignment.rampLength':
            'The ramp detector. Called by extrapolationSlope; exported so its behaviour is pinned directly against real R2 data.',
        'socAlignment.extrapolationSlope':
            'Called by alignSeries, which the chart calls. Exported so the slope basis can be asserted without going through alignment.',
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

    it('renders vehicle images through the thumbnail resolver', () => {
        // image_url is the FULL-resolution original — 1600x900, ~210KB each, and
        // 91% of a cold first load when 23 of them render at once. Displaying it
        // directly is the regression: every surface must go through
        // displayImageUrl so it gets the card-sized rendition with a fallback.
        //
        // Presence checks (`vehicle.image_url ? 'Replace' : 'Upload'`) are fine
        // and deliberately not matched here — only uses that put the URL on the
        // wire are.
        const rendersRaw = ALL.filter(({ file, text }) =>
            /\.jsx$/.test(file) && (
                /src=\{[^}]*\.image_url/.test(text) ||
                /url\(\$\{[^}]*\.image_url/.test(text)
            ));
        expect(rendersRaw.map(x => x.file)).toEqual([]);
    });

    it('credits the source on every run-selector row', () => {
        // #205: RunSelector has two row renderers and only one of them carried
        // the ↗ links. Turning on pairMode swapped RunRow for PairRows, and the
        // Charging, Charge Compare and Road Trip selectors quietly stopped
        // crediting anybody — for over a year, in the three most-used views.
        //
        // These links are the attribution owed to the people who collected the
        // data, so a row that names a test must offer that test's source. The
        // count is the assertion a reviewer cannot eyeball: a new row renderer
        // arrives with a name and no link, and this fails.
        const selectors = [
            'src/components/RunSelector.jsx',
            'src/components/performance/PerformanceRunSelector.jsx',
        ];
        for (const f of selectors) {
            const text = read(f);
            expect(text, `${f} does not import the shared source-link component`)
                .toMatch(/import RunSourceLinks/);

            const names = (text.match(/\{run\.name\}/g) ?? []).length;
            const links = (text.match(/<RunSourceLinks/g) ?? []).length;
            expect(names, `${f} renders no run name — has the row renderer moved?`)
                .toBeGreaterThan(0);
            expect(links, `${f} names ${names} test(s) but renders only ${links} source link(s)`)
                .toBeGreaterThanOrEqual(names);
        }
    });

    it('keeps the source-link markup in one component', () => {
        // Four hand-rolled copies of the same <a> is how one of them came to be
        // missing. Anything rendering a run's source URL goes through
        // RunSourceLinks so there is a single place left to omit it.
        const handRolled = ALL.filter(({ file, text }) =>
            /\.jsx$/.test(file)
            && !/RunSourceLinks\.jsx$/.test(file)
            && /href=\{run\.(source_url|sourceUrl)\}/.test(text));
        expect(handRolled.map(x => x.file)).toEqual([]);
    });

    it('loads the startup queries in parallel', () => {
        // Seven independent queries were awaited one after another, six of them
        // returning under 4KB. That was ~900ms of blank screen spent purely on
        // round trips. An eighth query appended below the Promise.all rather
        // than inside it silently restores the waterfall.
        const ctx = read('src/context/AppContext.jsx');
        const init = ctx.slice(ctx.indexOf('async function initializeApp'));
        const body = init.slice(0, init.indexOf('\n    }'));

        expect(body, 'initializeApp no longer batches its startup queries')
            .toMatch(/await Promise\.all\(\[/);

        const serialAwaits = body.match(/(?:const|let)\s+\w+\s*=\s*await\s+dataService\./g) ?? [];
        expect(serialAwaits, 'a startup query is awaited outside the Promise.all')
            .toEqual([]);
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

describe('components import what they use', () => {
    // Twice now a helper has been used in JSX without being imported — a runtime
    // ReferenceError no build step catches, because Vite does not resolve
    // identifiers. ESLint's no-undef is the real answer; this pins the specific
    // module that keeps biting until that exists.
    const RUN_UTIL_NAMES = [
        'runKindFrom', 'isRangeRun', 'isChargingRun', 'filterRangeRuns', 'filterChargingRuns',
        'defaultChargingRun', 'pairedChargingRun', 'applyDefaultRun', 'clearDefaultRuns',
        'linkableRuns', 'linkableCounts',
    ];

    for (const { file, text } of ALL.filter(x => /\.jsx$/.test(x.file))) {
        const used = RUN_UTIL_NAMES.filter(n => new RegExp(`[^.\\w]${n}\\s*\\(`).test(text));
        if (!used.length) continue;

        it(`${file.split('/').pop()} imports the runUtils helpers it calls`, () => {
            const importLines = (text.match(/^import .*runUtils.*$/gm) ?? []).join(' ');
            const missing = used.filter(n => !new RegExp(`\\b${n}\\b`).test(importLines));
            expect(missing).toEqual([]);
        });
    }
});
