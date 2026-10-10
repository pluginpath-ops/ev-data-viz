/**
 * Which of our EPA records do not reconcile? (#229)
 *
 * The four checks already exist and each one runs for the single vehicle whose
 * card you happen to be looking at. There has never been a way to ask the
 * question across the fleet — so after any change to the derivation, confirming
 * nothing regressed meant opening records one at a time. When #226 corrected the
 * treatment of incomplete bags, that is exactly what it took.
 *
 * NOTHING IS JUDGED HERE. `checkStatedRanges`, `checkUnadjustedMpge`,
 * `checkLabelInvariant` and `checkRecordIntegrity` are called unchanged, and
 * this only decides how to ORDER their verdicts and what to call the result.
 * A finding that appears here and not on the vehicle's own card would mean the
 * sweep had grown a second opinion, which is the one thing it must not do.
 *
 * Not a recalculation, either. Derivations are computed at read time and nothing
 * is stored, so a change to the method takes effect on reload for every vehicle
 * — there is nothing to re-run. What was missing is the ability to SEE it.
 *
 * Pure module: no data access, no React.
 */

import { epaRecordFromTestVehicle } from './epaRecordFromTestVehicle';
import { buildMethodologyModel } from './epaMethodology';
import { checkUnadjustedMpge, checkStatedRanges, checkLabelInvariant } from './epaDerivationCheck';
import { checkRecordIntegrity } from './epaIntegrity';

/**
 * The verdicts, worst first.
 *
 * Ordered by HOW MUCH IS PROVEN, not by how large the number is:
 *
 *   impossible   the record contradicts itself, or claims a label its own
 *                phases cannot reach. No outside source can settle either, and
 *                nothing derived from the record is trustworthy until it is.
 *   disagrees    a comparison against EPA's published figures is outside any
 *                plausible rounding. Real, but it takes a curator to say which
 *                side is wrong.
 *   suspect      a figure sits outside the observed band, or the record carries
 *                a caveat that changes how much its numbers are worth.
 *   close        inside the divergence tolerance but outside agreement.
 *   agrees       everything that could be checked, was, and reconciled.
 *   unchecked    the record could not be derived at all. NOT the same as
 *                agreeing, and kept distinct for that reason — a sweep whose
 *                unreadable records are silent is a sweep that reports health
 *                it never measured.
 */
export const AUDIT_VERDICTS = [
    { key: 'impossible', label: 'Impossible',  tone: 'disagrees',
      blurb: 'Contradicts itself or its own label. Settle these first — nothing derived from them holds.' },
    { key: 'disagrees',  label: 'Disagrees',   tone: 'disagrees',
      blurb: 'Outside rounding against EPA’s published figures.' },
    { key: 'suspect',    label: 'Suspect',     tone: 'close',
      blurb: 'A figure outside its band, or a caveat that changes what the numbers are worth.' },
    { key: 'close',      label: 'Close',       tone: 'close',
      blurb: 'Off, but within the tolerance that plausible rounding explains.' },
    { key: 'agrees',     label: 'Reconciles',  tone: 'agrees',
      blurb: 'Everything checkable was checked and agreed.' },
    { key: 'unchecked',  label: 'Not checked', tone: 'unchecked',
      blurb: 'Could not be derived — no tests, no phases, or no cycle to work from. Not the same as agreeing.' },
];

const VERDICT_RANK = Object.fromEntries(AUDIT_VERDICTS.map((v, i) => [v.key, i]));

/** Why a record could not be derived, in words a curator can act on. */
const REASON_TEXT = {
    'no-test-vehicle':       'No record.',
    'no-tests':       'No tests imported.',
    'no-energy':      'No DC energy on the test the model would use.',
    'no-phases':      'The test has no phases.',
    'phases-untyped': 'No phase carries a cycle, so nothing can be attributed to city or highway.',
    'missing-cycle':  'Only one of city and highway was driven.',
    'sct-no-ranges':  'A single-cycle record with no stated ranges to work from.',
};

/**
 * One test vehicle, audited.
 *
 * The vehicle names come from the mappings and there may be none: 113 of 211
 * test vehicles are linked to no vehicle at all, and those have no Tests & Data tab to
 * reach — which makes this the only place their verdict is visible.
 */
export function auditTestVehicle(testVehicle) {
    const { record, reason, inferredPhaseTypes, competingMctTests, derivedFrom, statedRanges }
        = epaRecordFromTestVehicle(testVehicle);

    // Runs on the raw record, so it answers even when nothing can be derived —
    // and an undrivable record is exactly where a contradiction tends to be.
    const integrity = checkRecordIntegrity(testVehicle);

    const model = record ? buildMethodologyModel(record) : null;
    // From the test the phases came from (#227). Reading the test vehicle's pair
    // compared one laboratory's phases against another's stated figures.
    const rangeCheck = checkStatedRanges(model, {
        cityMi: statedRanges?.cityMi,
        hwyMi:  statedRanges?.hwyMi,
    });
    const mpgeCheck = checkUnadjustedMpge(model, {
        city: testVehicle?.unadj_city_mpge,
        hwy:  testVehicle?.unadj_hwy_mpge,
    });
    const invariant = checkLabelInvariant(model, {
        bagsReconcile: rangeCheck.checked ? rangeCheck.worst === 'agrees' : null,
    });

    const vehicles = (testVehicle?.epa_vehicle_mappings ?? [])
        .map(m => m.vehicles).filter(Boolean);

    const notes = [];
    if (competingMctTests > 1) {
        // Whether a choice was MADE or merely defaulted to. A test vehicle deriving
        // from an unsettled default is a different thing to review than one
        // whose guide row identified the run.
        const how = derivedFrom?.basis === 'selected' ? 'selected' : 'default';
        notes.push(`${competingMctTests} multi-cycle tests; derived from `
            + `${derivedFrom?.testNumber ?? 'the most recent'} (${how})`);
    }
    if (statedRanges?.source === 'test-vehicle' && competingMctTests > 1) {
        // The pre-060 shape: no per-test ranges to compare against, so the
        // check is still crossing tests and its verdict is worth less.
        notes.push('stated ranges are the test vehicle\'s, not this test\'s — re-import to compare like with like');
    }
    if (inferredPhaseTypes > 0) {
        notes.push(`${inferredPhaseTypes} phase${inferredPhaseTypes === 1 ? '' : 's'} typed by distance`);
    }
    if (testVehicle?.carryover_model_year != null && testVehicle.carryover_model_year !== testVehicle.model_year) {
        notes.push(`carryover from MY${testVehicle.carryover_model_year}`);
    }
    if (!testVehicle?.fe_guide_row_id) {
        // Not a fault, but it bounds the verdict: two of the four checks need a
        // published figure, so an unlinked test vehicle can only ever be checked
        // against itself and 'agrees' means less than it looks.
        notes.push('no guide row linked');
    }
    if (!vehicles.length) notes.push('no vehicle linked');

    return {
        testVehicleId: testVehicle?.test_vehicle_id ?? null,
        make:        testVehicle?.make ?? null,
        carline:     testVehicle?.display_name || testVehicle?.epa_carline_name || null,
        modelYear:   testVehicle?.model_year ?? null,
        sourceFile:  testVehicle?.source_file ?? null,
        linked:      Boolean(testVehicle?.fe_guide_row_id),
        vehicles,
        reason,
        reasonText:  reason ? (REASON_TEXT[reason] ?? reason) : null,
        integrity,
        rangeCheck,
        mpgeCheck,
        invariant,
        notes,
        verdict: verdictFor({ record, integrity, rangeCheck, mpgeCheck, invariant, notes }),
    };
}

/**
 * The single worst thing true of this record.
 *
 * A row gets one verdict because the list is sorted by it, and a row that could
 * sort under two places sorts under neither usefully. The order below is the
 * order of the AUDIT_VERDICTS list and is the whole judgement this module makes.
 */
function verdictFor({ record, integrity, rangeCheck, mpgeCheck, invariant, notes }) {
    if (integrity.worst === 'error' || invariant?.violated) return 'impossible';
    if (!record) return 'unchecked';

    const worstOf = [rangeCheck, mpgeCheck]
        .filter(c => c?.checked)
        .map(c => c.worst);
    if (worstOf.includes('disagrees')) return 'disagrees';

    if (integrity.worst === 'warning') return 'suspect';
    if (worstOf.includes('close')) return 'close';

    // Nothing compared and nothing wrong is not the same as agreement: an
    // unlinked test vehicle with no stated ranges has simply not been tested by
    // anything. Saying 'reconciles' there would be reporting a result that was
    // never measured.
    if (!worstOf.length) return 'unchecked';

    // A caveat does not make a record wrong, but it does mean its figures were
    // derived from one of several possible readings.
    return notes.some(n => n.includes('multi-cycle') || n.includes('typed by distance'))
        ? 'suspect' : 'agrees';
}

/** Audit every test vehicle, worst first. */
export function auditTestVehicles(testVehicles = []) {
    return testVehicles
        .map(auditTestVehicle)
        .sort((a, b) => (VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
            || String(a.make ?? '').localeCompare(String(b.make ?? ''))
            || String(a.carline ?? '').localeCompare(String(b.carline ?? '')));
}

/** How many rows landed on each verdict, for the summary strip. */
export function auditSummary(rows = []) {
    const counts = Object.fromEntries(AUDIT_VERDICTS.map(v => [v.key, 0]));
    for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    return counts;
}

/**
 * Every finding on a row, flattened for display.
 *
 * The four checks report in four shapes — a findings array, a cycles array, a
 * violated flag. A reader scanning a table wants sentences.
 */
export function auditFindings(row) {
    const out = [];
    for (const f of row.integrity?.findings ?? []) {
        out.push({ severity: f.severity === 'error' ? 'disagrees' : 'close', text: `${f.label}: ${f.detail}` });
    }
    if (row.invariant?.violated) {
        out.push({
            severity: 'disagrees',
            text: `Label ${row.invariant.labeledMi?.toFixed(0)} mi exceeds the computed `
                + `${row.invariant.computedMi?.toFixed(1)} mi by ${row.invariant.shortfallMi?.toFixed(1)}.`,
        });
    }
    for (const [name, check] of [['Stated range', row.rangeCheck], ['Unadjusted MPGe', row.mpgeCheck]]) {
        if (!check?.checked || check.worst === 'agrees') continue;
        for (const c of check.cycles ?? []) {
            if (c.status === 'agrees') continue;
            out.push({
                severity: c.status,
                text: `${name}, ${c.label}: ${c.deltaPct >= 0 ? '+' : ''}${c.deltaPct.toFixed(2)}%`,
            });
        }
    }
    if (row.reasonText) out.push({ severity: 'unchecked', text: row.reasonText });
    return out;
}
