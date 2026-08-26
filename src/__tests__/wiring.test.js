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
    // feGuideMatch earned its place here: `bestFeCandidate` was written with
    // care — it declines a tie because `Ioniq 5` scores identically against two
    // cars 80 miles apart — fully unit-tested, and had ZERO call sites until
    // #238 wired it in. Exactly the "built, tested, never connected" shape this
    // suite exists to catch, and the one module doing that work was not watched.
    const WATCHED = ['conditionCorrection.js', 'testSessions.js', 'seriesLabel.js', 'socAlignment.js',
                     'feGuidePlausibility.js', 'phaseTypes.js', 'epaRecordFromGroup.js',
                     'epaDerivationCheck.js', 'epaSectionLabels.js', 'feGuideMatch.js',
                     'epaLinkSweep.js', 'epaCertStats.js', 'epaCurveSubjects.js',
                     'epaIntegrity.js', 'epaAudit.js', 'epaTestSelection.js',
                     'epaBandEvidence.js'];

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
        'feGuidePlausibility.HWY_CITY_RATIO_MIN':
            'The bound itself, consumed inside the module by rangePlausibility and asserted by name against the observed real spread.',
        'feGuidePlausibility.HWY_CITY_RATIO_MAX':
            'As above — the upper bound, pinned by name so widening it is a deliberate edit.',
        'epaDerivationCheck.RANGE_AGREEMENT_TOLERANCE':
            'The slack allowed when a record is recomputed against its own stated range; consumed inside the module by checkStatedRanges and asserted by name.',
        'epaDerivationCheck.LABEL_INVARIANT_TOLERANCE_MI':
            'Rounding slack for a whole-number label; consumed inside the module by checkLabelInvariant and asserted by name.',
        'epaDerivationCheck.AGREEMENT_TOLERANCE':
            'The band itself, consumed inside the module by statusFor and asserted by name so moving it is a deliberate edit.',
        'epaDerivationCheck.DIVERGENCE_TOLERANCE':
            'As above — the boundary beyond which a difference is larger than any plausible rounding.',
        'phaseTypes.SS_NEIGHBOUR_MULTIPLE':
            'The multiple itself, consumed inside the module by suggestPhaseType and asserted by name so changing it is deliberate.',
        'socAlignment.extrapolationSlope':
            'Called by alignSeries, which the chart calls. Exported so the slope basis can be asserted without going through alignment.',
        'feGuideMatch.normaliseMake':
            'The make comparison, consumed inside the module by sameMake. Exported so the abbreviation and punctuation rules can be asserted directly.',
        'feGuideMatch.sameMake':
            'The candidate filter, consumed inside the module by rankFeCandidates. Exported so "same manufacturer" is testable without ranking.',
        'feGuideMatch.carlineScore':
            'The similarity metric, consumed inside the module by rankFeCandidates. Exported so a score can be pinned against real carline pairs.',
        'epaLinkSweep.hasDerivableEnergy':
            'Consumed inside the module by tierOf. Exported so the procedure-code rule — 77 and 84 only, never 86 — is asserted on its own.',
        'epaLinkSweep.hasCoefficients':
            'As above, consumed by tierOf and exported so the target-set check is testable without tiering.',
        'epaLinkSweep.tierOf':
            'Consumed inside the module by classifyGroup. Exported so the priority order is asserted directly rather than inferred from a sorted sweep.',
        'epaCurveSubjects.curveSubject':
            'Consumed inside the module by curveSubjects, which the explorer calls. Exported so one record\'s tier and energy source are assertable without building a whole list.',
        'epaCurveSubjects.resolveCurveEnergy':
            'Consumed inside the module by curveSubject. Exported so the precedence — curator value, then DC on procedure 77 or 84, then the guide\'s gross pack — is pinned on its own.',
        'epaCurveSubjects.tierByKey':
            'The tier lookup, used by the picker for its hints and asserted here so every tier a subject can be given has a declared entry.',
        'epaCertStats.derivedUsableKwh':
            'Consumed inside the module by certObservation. Exported so the precedence — a curator value first, then DC discharged on procedure 77 or 84, never 86 — is asserted directly rather than inferred from a ratio.',
        'epaCertStats.certObservation':
            'Consumed inside the module by certObservations, which the statistics view calls. Exported so one group\'s flattening — dimensions from the guide row, a fallback derivation dropped — is asserted without building a whole set.',
        'epaBandEvidence.BAND_EVIDENCE':
            'The band-to-measure mapping. Consumed inside the module by bandEvidence and allBandEvidence, and exported so a test can assert every band points at a measure that exists — a band shown against the wrong distribution is worse than none, because it looks like evidence.',
        'epaBandEvidence.SCALAR_ON_MEDIAN':
            'How close a scalar knob must sit to the corpus median to read as being on it. Consumed inside the module by bandVerdict and asserted by name, so a measured default rounded for the constants file does not read as disagreement with the value it came from.',
        'epaBandEvidence.bandEvidence':
            'Consumed inside the module by allBandEvidence, which the knob panel calls. Exported so one band\'s summary — and its refusal to describe a handful of records — is assertable without building the whole set.',
        'epaBandEvidence.BAND_EVIDENCE_MIN_N':
            'The floor below which quantiles describe a handful of cars rather than a corpus. Consumed inside the module and asserted by name so lowering it is a deliberate edit.',
        'epaTestSelection.scoreAgainstGuideRanges':
            'The range fallback\'s scorer, consumed inside the module by selectTestForGuide. Exported so the implied-factor consistency rule is asserted directly rather than inferred from a selection.',
        'epaTestSelection.SELECTION_MAX_SCORE':
            'The credibility floor, consumed inside the module by decide and asserted by name so moving it is a deliberate edit.',
        'epaTestSelection.SELECTION_MIN_MARGIN':
            'How much better the winner must be than the runner-up before a selection is persisted. Consumed inside the module by selectTestForGuide, and exported so a threshold that decides whether a choice is recorded at all is named rather than a literal.',
        'epaTestSelection.RANGE_SELECTION_MIN_MARGIN':
            'The same guard for the range fallback, deliberately stricter because published ranges are whole miles. Exported alongside its sibling so the two can be asserted against each other.',
        'epaAudit.auditGroup':
            'Consumed inside the module by auditGroups, which the sweep calls. Exported so one record\'s verdict is assertable without building a whole list.',
        'epaIntegrity.integrityWarnings':
            'The import-time form of checkRecordIntegrity, called by EpaPdfImportModal. Listed because the checks it wraps are also read directly by the curator card, and only this spelling reaches the import path.',
        'epaCertStats.NOT_MEASURED_SOURCES':
            'The source names that mean "not derived", consumed inside the module and asserted BY NAME against what epaDerivations actually returns — deriveDrivetrainEta says "estimated" where deriveChargerEfficiency says "assumed", and a single check for one of them published DEFAULT_ETA as a fleet measurement.',
        'epaLinkSweep.wheelMentions':
            'Called by the sweep view to distil a manufacturer note, and inside the module by coveredWheelSizes. Exported so the four real notations — inch, in, doubled quote, and Lucid\'s 20F21R pair — are pinned by name.',
        'epaLinkSweep.coveredModelMatches':
            'Consumed inside the module by classifyGroup. Exported so the certificate-covers-this-carline match, and its refusal when a certificate covers several candidates, are asserted directly.',
        'epaLinkSweep.exactTestGroupMatches':
            'Consumed inside the module by classifyGroup. Exported so the identifier match — and its refusal to fire when several rows share the id — is asserted directly.',
        'epaLinkSweep.sharedCertification':
            'Consumed inside the module by classifyGroup. Exported so the one-certification-several-wheels case is pinned against the real Lucid data on its own.',
        'epaLinkSweep.classifyGroup':
            'Consumed inside the module by buildSweep, which the sweep view calls. Exported so one group\'s proposal and decline reason can be asserted without building a whole sweep.',
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

    it('keeps the "About this chart" bubble last on every page', () => {
        // A convention all eight chart views already followed, and which held
        // only because nobody had appended anything after it. The first thing
        // added below the bubble (the EPA methodology card) broke it silently —
        // the help text ended up mid-page with a card after it.
        //
        // Anchored on JSX, not on line count: what matters is that no element
        // is rendered after the bubble in the returned tree.
        const views = ALL.filter(({ file, text }) =>
            /\.jsx$/.test(file) && /<ChartInfoBubble/.test(text));
        expect(views.length).toBeGreaterThan(5);

        for (const { file, text } of views) {
            const after = text.slice(text.lastIndexOf('<ChartInfoBubble'));
            // Only closing tags, braces and whitespace may follow it.
            const stray = after
                .replace(/<ChartInfoBubble[^/]*\/>/, '')
                .match(/<[A-Za-z][^>]*>/g) ?? [];
            expect(stray, `${file} renders ${stray[0]} after the info bubble`).toEqual([]);
        }
    });

    it('sends only columns the FE guide migration actually creates', () => {
        // The importer builds its payload in JS and the table is defined in SQL,
        // and nothing checks that the two agree. A mistyped column does not
        // throw at build or lint: Postgres rejects the row, or the value simply
        // never lands and the import reports success.
        //
        // Reading both and comparing is the only place that mismatch is visible
        // before it reaches a curator with a file to import.
        const svc = read('src/services/DataService.js');
        const body = svc.slice(svc.indexOf('export function feGuidePayload'));
        const payloadKeys = [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s{4}([a-z_]+):/gm)]
            .map(m => m[1]);
        expect(payloadKeys.length).toBeGreaterThan(20);

        const sql = read('supabase/migrations/053_epa_fe_guide.sql');
        const create = sql.slice(sql.indexOf('CREATE TABLE epa_fe_guide'));
        const columns = new Set(
            [...create.slice(0, create.indexOf(');')).matchAll(/^\s{4}([a-z_]+)\s+[a-z]/gm)].map(m => m[1]),
        );

        const unknown = payloadKeys.filter(k => !columns.has(k));
        expect(unknown, `columns sent by the importer but absent from migration 053: ${unknown.join(', ')}`)
            .toEqual([]);
    });

    it('links a batch through the batch path, not a loop over the single-link one', () => {
        // AppContext.linkFeGuideRow refreshes every vehicle in the app after
        // each call — correct for one link, since the promoted figures reach a
        // vehicle card through epa_vehicle_mappings. Looping it over 98 groups
        // ran the app's largest query 98 times, so the sweep appeared to hang
        // and only the last of 98 toasts survived. The batch path refreshes
        // once. Nothing about that is visible from either file alone.
        const sweep = read('src/components/admin/FeGuideLinkSweep.jsx');
        const batchFn = sweep.slice(sweep.indexOf('const linkBatch'));
        const body = batchFn.slice(0, batchFn.indexOf('\n    };'));

        expect(body, 'linkBatch must call linkFeGuideRows, the batch path')
            .toMatch(/linkFeGuideRows\(/);
        expect(body, 'linkBatch must not loop the single-link call')
            .not.toMatch(/await\s+linkFeGuideRow\(/);

        // And the batch path must refresh once rather than per link.
        const ctx = read('src/context/AppContext.jsx');
        const plural = ctx.slice(ctx.indexOf('const linkFeGuideRows'));
        const pluralBody = plural.slice(0, plural.indexOf('\n    };'));
        expect((pluralBody.match(/softRefreshVehicles\(/g) ?? []).length,
            'the batch wrapper should refresh exactly once').toBe(1);
    });

    it('lets the FE guide ranker see every year, and fetches what it ranks on', () => {
        // rankFeCandidates treats the model year as a SORT key and
        // bestFeCandidate has a dedicated wrong-year path — both written for
        // candidates spanning years. The query filtered to the group's exact
        // year, so neither could ever fire, and a 2027 ID. Buzz reported no
        // staged rows while its 2025 and 2026 rows sat in the table. Two modules
        // disagreeing about whether year filters or sorts is invisible unless
        // something reads them together.
        const svc = read('src/services/DataService.js');
        const body = svc.slice(svc.indexOf('async getFeGuideCandidates'));
        const fn = body.slice(0, body.indexOf('\n  }'));

        expect(fn, 'getFeGuideCandidates must not pre-filter the year the ranker sorts on')
            .not.toMatch(/eq\(\s*['"]model_year['"]/);

        // The select is narrowed, so anything the ranker or picker reads off a
        // candidate has to be named in it or it arrives undefined.
        const selected = new Set(
            (fn.match(/\.select\(\s*['"]([^'"]+)['"]/)?.[1] ?? '').split(',').map(s => s.trim()),
        );
        const match = read('src/utils/feGuideMatch.js');
        const picker = read('src/components/epa/FeGuidePicker.jsx');
        const needed = new Set([
            ...[...match.matchAll(/\br(?:ow)?\.([a-z_]{3,})/g)].map(m => m[1]),
            // `\brow\.` rather than `best.row.` / `c.row.`, so columns read
            // inside CandidateFacts count too. It does not catch `linkedRow.`,
            // which is a different, fully-fetched row.
            ...[...picker.matchAll(/\brow\.([a-z_]+)/g)].map(m => m[1]),
        ]);

        const missing = [...needed].filter(k => !selected.has(k));
        expect(missing, `candidate columns read but not selected: ${missing.join(', ')}`).toEqual([]);
    });

    it('reaches the reconciliation sweep from the Admin view', () => {
        // The sweep's whole value is being somewhere a curator lands. It is a
        // read-only view built on modules that already existed, so nothing else
        // in the codebase would break if it were never mounted — which is the
        // exact shape this suite exists for.
        const admin = read('src/components/AdminView.jsx');
        expect(admin, 'AdminView must mount the sweep').toMatch(/<EpaAuditSweep\s*\/>/);

        // And it must reach real data. The query is deliberately unfiltered:
        // a group with no guide row still has phases that can contradict its
        // own stated ranges, and those are the ones nobody has looked at.
        const svc = read('src/services/DataService.js');
        const body = svc.slice(svc.indexOf('async getEpaGroupsForAudit'));
        const fn = body.slice(0, body.indexOf('\n  }'));
        expect(fn, 'the audit query must not filter to linked groups')
            .not.toMatch(/\.not\(\s*['"]fe_guide_row_id['"]/);

        // Every column the checks read has to be selected or it arrives
        // undefined and the check silently reports "not checked".
        for (const col of ['cd_range_combined_calc', 'cd_range_hwy_calc',
                           'unadj_city_mpge', 'unadj_hwy_mpge', 'label_range_published',
                           'epa_test_phases', 'equiv_test_weight_lbs', 'total_dc_energy_kwh',
                           'ac_recharge_kwh']) {
            expect(fn, `the audit query must select ${col}`).toMatch(new RegExp(col));
        }

        // The per-test ranges specifically (#227). They fall back to the
        // group's when absent, so forgetting them in a query does not error —
        // it silently reinstates the cross-test comparison the fix removed.
        const testsSelect = fn.slice(fn.indexOf('epa_tests('));
        expect(testsSelect.slice(0, testsSelect.indexOf(')')),
            'the audit query must select the per-test cd ranges')
            .toMatch(/cd_range_combined_calc/);
    });

    it('sets the preferred test when a guide row is linked, and clears it on unlink', () => {
        // The selection is evidence from the guide row. Linking without setting
        // it leaves every figure on an unsettled default; unlinking without
        // clearing it keeps steering from a source the record no longer has.
        const svc = read('src/services/DataService.js');
        const link = svc.slice(svc.indexOf('async linkFeGuideRow('));
        expect(link.slice(0, link.indexOf('\n  }')), 'linkFeGuideRow must select a test')
            .toMatch(/selectTestForGuide\(/);
        const unlink = svc.slice(svc.indexOf('async unlinkFeGuideRow('));
        expect(unlink.slice(0, unlink.indexOf('\n  }')), 'unlinkFeGuideRow must clear it')
            .toMatch(/preferred_test_number\s*=\s*null/);

        // And it has to be READ back. The derivation falls back to most-recent
        // when the column is absent, so a query that forgets it silently
        // reinstates the default with nothing to show anything went wrong.
        for (const marker of ['async getEpaGroupsForAudit', 'async getVehicles']) {
            const q = svc.slice(svc.indexOf(marker));
            expect(q.slice(0, q.indexOf('\n  }')), `${marker} must select preferred_test_number`)
                .toMatch(/preferred_test_number/);
        }
        expect(read('src/utils/epaRecordFromGroup.js'),
            'the derivation must honour the selection')
            .toMatch(/preferred_test_number/);
    });

    it('shows a band its own evidence, and pays for it only on the admin panel', () => {
        // These bounds decide whether a figure is flagged on every EPA card and
        // all of them were set by hand. The corpus can say what the real spread
        // is — but only where that costs nothing: the knob panel, on the same
        // fetch the statistics view already makes. A vehicle card must never
        // pull the corpus to decorate a row.
        const knobs = read('src/components/admin/ConstantsKnobs.jsx');
        expect(knobs, 'the knob panel must show each band its evidence')
            .toMatch(/allBandEvidence\(/);
        expect(knobs, 'and judge the live value, not the default')
            .toMatch(/bandVerdict/);

        for (const f of ['src/components/EpaVehicleSection.jsx',
                         'src/components/epa/DerivedValues.jsx']) {
            expect(read(f), `${f} must not pull the corpus`)
                .not.toMatch(/BandEvidence|getCertGroupsForStats/);
        }
    });

    it('lets a curator pick the test, through the path that persists it', () => {
        // #228's own words: the warning "tells you a choice was made without
        // letting you make it". The control has to be mounted, and it has to
        // write through saveGroup — which is what tags the field `manual` and
        // appends the audit entry. A direct write would skip both, and unlink
        // would then wipe the choice, because isCuratorOwned looks for that tag.
        const editor = read('src/components/epa/EpaCuratorEditor.jsx');
        expect(editor, 'the curator editor must mount the picker')
            .toMatch(/<PreferredTestPicker/);
        expect(editor, 'the picker must write through the buffered save path')
            .toMatch(/saveGroup\('preferred_test_number'/);

        // One copy of the default's rule. The picker labels a row "Automatic";
        // if that label and the derivation disagreed the control would be
        // describing behaviour it does not have.
        const picker = read('src/components/epa/PreferredTestPicker.jsx');
        expect(picker, 'the picker must use the shared default, not its own copy')
            .toMatch(/defaultMctTest/);
        expect(read('src/utils/epaRecordFromGroup.js'),
            'the derivation must use the same one').toMatch(/defaultMctTest\(/);
        expect(picker, 'the picker must not re-implement the tie-break')
            .not.toMatch(/localeCompare/);
    });

    it('builds speed curves on the steady-state η, and statistics on the raw one', () => {
        // Two directions, and both matter.
        //
        // The curve predicts steady cruise, so it must resolve a cruise η —
        // reverting it to deriveDrivetrainEta would silently drop every range
        // figure ~13% with nothing to show for it.
        const deriv = read('src/utils/epaDerivations.js');
        const builder = deriv.slice(deriv.indexOf('export function buildEpaCurveFromModel'));
        expect(builder.slice(0, builder.indexOf('\n}')), 'the curve builder must use the cruise η')
            .toMatch(/resolveCurveEta\(/);
        expect(read('src/utils/epaCurveSubjects.js'), 'so must the subject model')
            .toMatch(/resolveCurveEta\(/);

        // And the statistics must NOT. ETA_BAND is calibrated on HWFET values,
        // and ss_eta_ratio divides the steady-state η by this one — correcting
        // it there would make the ratio circular and drift the very constant
        // the correction is derived from.
        const stats = read('src/utils/epaCertStats.js');
        expect(stats, 'cert statistics must measure the raw HWFET η')
            .toMatch(/deriveDrivetrainEta\(/);
        expect(stats, 'and must not correct it').not.toMatch(/resolveCurveEta/);
    });

    it('checks a recomputed range against the test it derived from', () => {
        // The group's cd_range_* is set at import from the FIRST procedure-77
        // test while the derivation uses the most RECENT, so reading the group
        // compared one laboratory's phases against another's stated figures.
        // On the real CLA 350 that was a 3.06% disagreement that was really two
        // runs a month apart. Both readers must go through statedRanges.
        for (const f of ['src/utils/epaAudit.js', 'src/components/EpaVehicleSection.jsx']) {
            const text = read(f);
            expect(text, `${f} must not read cd_range off the group`)
                .not.toMatch(/cityMi:\s*g(roup)?\??\.cd_range_combined_calc/);
            expect(text, `${f} must compare against the derivation test's ranges`)
                .toMatch(/statedRanges/);
        }
    });

    it('makes no judgement the per-vehicle card does not', () => {
        // A finding shown in the sweep and not on the vehicle's own card would
        // mean the sweep had grown a second opinion. It calls the four checks
        // and must not define thresholds of its own.
        const audit = read('src/utils/epaAudit.js');
        for (const fn of ['checkStatedRanges', 'checkUnadjustedMpge',
                          'checkLabelInvariant', 'checkRecordIntegrity']) {
            expect(audit, `epaAudit must call ${fn}`).toMatch(new RegExp(`${fn}\\(`));
        }
        expect(audit, 'epaAudit must not carry thresholds of its own')
            .not.toMatch(/TOLERANCE|_BAND\s*=/);
    });

    it('refreshes the vehicle after every FE guide mutation', () => {
        // All three write to epa_test_groups, which reaches the page only through
        // the vehicle's epa_vehicle_mappings. Without a refetch the card keeps
        // rendering pre-link values, so the curator cannot see whether the row
        // they picked was right without reloading — which defeats the point of a
        // picker whose whole job is making the link checkable.
        //
        // FeGuidePicker does fire an onChanged callback, but EpaVehicleSection's
        // onGroupChanged prop is never supplied by RunsView, so that path is
        // inert. Asserting on the context is asserting on the one that runs.
        const ctx = read('src/context/AppContext.jsx');
        for (const fn of ['linkFeGuideRow', 'unlinkFeGuideRow', 'acceptFeGuideValues']) {
            const body = ctx.slice(ctx.indexOf(`const ${fn} = async`));
            expect(body.slice(0, body.indexOf('\n    };')), `${fn} must refresh the vehicle`)
                .toMatch(/softRefreshVehicles\(\)/);
        }
    });

    it('puts the derivation checks with the data, not on the public chart', () => {
        // They started on the Charts tab, which was the wrong home: that diagram
        // answers a reader's question about the CAR, and "the bags do not
        // reconcile" is a fact about our RECORD of it — useful to a curator and
        // noise to everyone else.
        //
        // Both halves asserted, because either alone passes while broken: the
        // curator view must run and render them, and the chart must not.
        const curator = read('src/components/EpaVehicleSection.jsx');
        const checks  = read('src/components/epa/EpaDerivationChecks.jsx');
        const chart   = read('src/components/EpaCurvesView.jsx');
        const diagram = read('src/components/epa/EpaMethodologyDiagram.jsx');

        expect(curator, 'the curator view must run all three checks').toMatch(/checkStatedRanges\(/);
        expect(curator, 'the curator view must test the label invariant').toMatch(/checkLabelInvariant\(/);
        expect(curator, 'the checks must be rendered').toMatch(/<EpaDerivationChecks/);
        expect(checks, 'the verdicts must reach the page').toMatch(/rangeCheck\?\.checked/);
        expect(checks, 'an impossible label must be shown').toMatch(/invariant\?\.violated/);

        for (const [name, text] of [['EpaCurvesView', chart], ['EpaMethodologyDiagram', diagram]]) {
            expect(text, `${name} must not carry curator diagnostics`)
                .not.toMatch(/checkStatedRanges|checkLabelInvariant|checkUnadjustedMpge/);
        }
    });

    it('builds the methodology diagram from selected vehicles, not sample records', () => {
        // The diagram ran on two transcribed fixtures for three phases while
        // reading as though it described the car on screen. It was correct and
        // it was not about your vehicle, and nothing in the code said so except
        // a banner that had to be remembered.
        //
        // Both halves are asserted because either alone passes while broken:
        // importing the adapter proves nothing if the render still maps
        // fixtures, and dropping the fixtures proves nothing if no real group
        // reaches the model.
        const view = read('src/components/EpaCurvesView.jsx');

        expect(view, 'the diagram must go through the group adapter')
            .toMatch(/epaRecordFromGroup\(/);
        expect(view, 'sample records must not feed the rendered diagram')
            .not.toMatch(/METHODOLOGY_FIXTURES/);
        // The adapter's reasons exist to be shown; computing them and dropping
        // them on the floor is the same silence in a different place.
        expect(view, 'a configuration with no derivation must say why')
            .toMatch(/NO_RECORD_REASONS/);
    });

    it('fetches every EPA column the vehicle card reads', () => {
        // getVehicles names its columns explicitly, and migration 053 added
        // eleven more that nothing widened the list for. Promotion wrote them
        // correctly and the card read them as null: six label figures blank on
        // screen while sitting in the database, and `fe_guide_row_id` missing
        // meant a linked group still rendered the "link me" picker.
        //
        // Nothing fails loudly when a column is absent from a Supabase select —
        // the field is simply undefined — so this is the only place the two
        // lists can be held together.
        const svc = read('src/services/DataService.js');
        const select = svc.slice(svc.indexOf('epa_test_groups('));
        const columns = select.slice(0, select.indexOf('epa_coefficient_sets'));

        const promo = read('src/utils/feGuidePromotion.js');
        const targets = [...promo.matchAll(/^\s+\w+:\s+'(\w+)',/gm)].map(m => m[1]);
        expect(targets.length).toBeGreaterThan(10);

        // Everything promotion writes, plus the two the UI needs to interpret it.
        const needed = [...new Set([...targets, 'fe_guide_row_id', 'overrides'])];
        const missing = needed.filter(c => !new RegExp(`\\b${c}\\b`).test(columns));
        expect(missing, `getVehicles does not fetch: ${missing.join(', ')}`).toEqual([]);
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

describe('published model constants reach the math (#261)', () => {
    // The constants decide what OTHER PEOPLE see — the bands flag records on
    // every EPA card, DEFAULT_ETA is an input to the physics, and the EPA
    // section is public. Publishing them is only real if three seams hold, and
    // each one fails silently: no error, just everyone quietly computing from
    // the compiled defaults.

    it('seeds the site values before anything that reads a constant is loaded', () => {
        // constants/epa.js resolves every tunable at MODULE LOAD, deliberately,
        // so the math modules stay plain static imports. That makes the entry
        // point's import list load-bearing: one static import of a component,
        // the context or DataService evaluates epa.js before the seed and pins
        // the whole site to its defaults.
        const main = read('src/main.jsx');
        expect(main, 'main.jsx must seed the published constants')
            .toMatch(/seedSiteConstants\(/);
        expect(main, 'and load the app dynamically, after the seed')
            .toMatch(/import\(['"]\.\/renderApp['"]\)/);

        const statics = [...main.matchAll(/^import .*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
        for (const spec of statics) {
            expect(['./App', './context/AppContext', './services/DataService', './renderApp'],
                `main.jsx statically imports ${spec}, which loads constants/epa.js before the seed`)
                .not.toContain(spec);
        }
    });

    it('still preloads the app chunk the bootstrap defers', () => {
        // Loading the app dynamically is what lets the seed happen first, and
        // it costs discovery: nothing tells the browser about ~1.2MB of app and
        // vendor code until a few-hundred-byte settings query comes back. The
        // build injects a modulepreload to cover it, matched on the module path
        // — so renaming renderApp.jsx silently un-preloads the whole app.
        const cfg = read('vite.config.js');
        expect(cfg, 'the preload must name the module main.jsx defers')
            .toContain('/src/renderApp.jsx');
        expect(cfg, 'and preload it').toMatch(/modulepreload/);
    });

    it('resolves a constant through the site layer, not only the local one', () => {
        const overrides = read('src/constants/overrides.js');
        expect(overrides, 'resolve() must consult the published values')
            .toMatch(/site\[key\]/);
        expect(read('src/constants/epa.js'), 'the math must read through the same resolver')
            .toMatch(/resolve\(/);
    });

    it('offers an admin a way to publish, and a way back', () => {
        const panel = read('src/components/admin/ConstantsKnobs.jsx');
        expect(panel, 'the knob panel must be able to publish a value')
            .toMatch(/publishModelConstant/);
        expect(panel, 'and to revert the published set')
            .toMatch(/clearPublishedConstants/);
        expect(panel, 'and must say which layer a value came from')
            .toMatch(/SourceBadge/);

        const ctx = read('src/context/AppContext.jsx');
        for (const fn of ['publishModelConstant', 'clearPublishedConstants']) {
            expect(ctx, `${fn} must be exposed on the context`).toContain(fn);
        }

        const svc = read('src/services/DataService.js');
        for (const rpc of ['set_model_constant', 'clear_model_constants']) {
            expect(svc, `DataService must call the ${rpc} RPC`).toContain(rpc);
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
