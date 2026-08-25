/**
 * Is this EPA record internally possible?
 *
 * Distinct from `epaDerivationCheck`, and the difference is what each one needs.
 * Those checks compare a record against an OUTSIDE source — EPA's published
 * unadjusted MPGe, the label range — so they only run where a Fuel Economy
 * Guide row has been linked, and a disagreement is a question about which side
 * is right. These compare a record against ITSELF. No external source, no
 * judgement: recharging a pack with less energy than was drawn out of it is not
 * a disagreement, it is impossible, and it means an import read a field wrong.
 *
 * Written after a bulk import of every MY2026 BEV certification produced
 * scattered impossibilities — 2-5 kWh traction packs, charger efficiencies near
 * 1% — clustered inside single manufacturers rather than spread evenly, which
 * is the signature of a layout variant in those PDFs rather than a bug in the
 * arithmetic. None of it surfaced anywhere. A record either rendered a
 * plausible-looking figure or a nonsensical one, and both looked equally
 * imported.
 *
 * Pure module: no data access, no React, no network. Runs against a parsed
 * group (`parseEpaCsiText` output, at import) or a stored one (the shape
 * `getEpaTestGroupFull` returns, afterwards) — see `normaliseGroup`.
 */

import {
    CHARGER_EFF_BAND, PACK_KWH_BAND, PHASE_SUM_TOLERANCE_PCT,
    PROC_MCT, PROC_CD_UDDS, PROC_CD_HWY,
} from '../constants/epa';

/** Every procedure that depletes the pack, and so measures something usable. */
const CD_PROCEDURES = [PROC_MCT, PROC_CD_UDDS, PROC_CD_HWY];

// Absent must stay absent. `Number(null)` and `Number('')` are both 0, and 0 is
// finite — so the naive version turned "this record has no pack figure" into
// "this record has a 0.0 kWh pack" and reported an impossibility against a field
// that was simply never filled. A check that invents its own findings is worse
// than no check.
const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);

/**
 * The two shapes this has to read.
 *
 * At import a group carries `tests[].phases[]`; once stored it carries
 * `epa_tests[].epa_test_phases[]` and `epa_coefficient_sets[]`. Same data, two
 * spellings, and the checks are worth running at BOTH ends — at import so a bad
 * parse is refused before it lands, and afterwards because the records that
 * prompted this were already in the database.
 */
function normaliseGroup(group) {
    if (!group) return null;
    const tests = group.epa_tests ?? group.tests ?? [];
    return {
        testGroupId: group.test_group_id ?? null,
        totalVoltage: num(group.total_voltage),
        packKwh: num(group.nominal_pack_kwh) ?? num(group.useable_kwh),
        coefficientSets: group.epa_coefficient_sets ?? group.coefficient_sets ?? [],
        tests: tests.map(t => ({
            testNumber: t.test_number ?? null,
            procedureCode: num(t.procedure_code),
            totalDcKwh: num(t.total_dc_energy_kwh),
            acRechargeKwh: num(t.ac_recharge_kwh),
            phases: (t.epa_test_phases ?? t.phases ?? []).map(p => ({
                index: num(p.phase_index),
                type: p.phase_type ?? null,
                distanceMi: num(p.distance_mi),
                dcKwh: num(p.dc_energy_kwh),
            })),
        })),
    };
}

const finding = (code, severity, label, detail, values = {}) =>
    ({ code, severity, label, detail, values });

/**
 * Every check, in the order a reader wants them: impossible first, then
 * implausible, then incomplete.
 *
 * Severity is about CERTAINTY, not importance. 'error' means the numbers
 * contradict each other and one of them is definitely wrong. 'warning' means a
 * figure is outside what has ever been observed, which is strong evidence and
 * not proof — a band is a curation judgement and every one of them is a knob.
 *
 * @param {Object} group  parsed or stored EPA test group
 * @returns {{ checked: boolean, findings: Array, worst: 'error'|'warning'|null }}
 */
export function checkRecordIntegrity(group) {
    const g = normaliseGroup(group);
    if (!g || !g.tests.length) return { checked: false, findings: [], worst: null };

    const findings = [];

    // ── Pack energy ─────────────────────────────────────────────────────────
    // The 2-5 kWh records. "Battery Energy Capacity" in a CSI is AMP-HOURS, so
    // a pack figure this small usually means an amp-hour count reached a kWh
    // column, or a 12 V auxiliary battery was read as the traction pack.
    if (g.packKwh != null && (g.packKwh < PACK_KWH_BAND[0] || g.packKwh > PACK_KWH_BAND[1])) {
        findings.push(finding(
            'pack-energy-implausible', 'warning', 'Pack energy implausible',
            `${g.packKwh.toFixed(1)} kWh is outside ${PACK_KWH_BAND[0]}–${PACK_KWH_BAND[1]} kWh. `
            + 'CSI battery capacity is amp-hours, not kWh — check which field this came from.',
            { packKwh: g.packKwh, band: PACK_KWH_BAND },
        ));
    }

    for (const t of g.tests) {
        const where = t.testNumber ? `${t.testNumber}: ` : '';

        // ── Recharge below draw ─────────────────────────────────────────────
        // Not a band and not tunable. Putting less energy in at the wall than
        // came out of the pack requires the charger to generate energy.
        if (t.acRechargeKwh != null && t.totalDcKwh != null
            && t.acRechargeKwh > 0 && t.totalDcKwh > 0
            && t.acRechargeKwh < t.totalDcKwh) {
            findings.push(finding(
                'recharge-below-draw', 'error', 'Recharge below discharge',
                `${where}the wall put back ${t.acRechargeKwh.toFixed(2)} kWh after `
                + `${t.totalDcKwh.toFixed(2)} kWh was drawn from the pack. Charging cannot be `
                + 'over 100% efficient, so one of the two was read from the wrong field.',
                { acRechargeKwh: t.acRechargeKwh, totalDcKwh: t.totalDcKwh, testNumber: t.testNumber },
            ));
        }

        // ── Charger efficiency ──────────────────────────────────────────────
        // The 1% records. Computed here rather than read from the derivation
        // layer so this module stays answerable from the record alone.
        //
        if (t.acRechargeKwh > 0 && t.totalDcKwh > 0) {
            const eff = t.totalDcKwh / t.acRechargeKwh;
            if (eff >= 1) {
                // already reported as recharge-below-draw; saying it twice adds nothing
            } else if (eff < CHARGER_EFF_BAND[0] || eff > CHARGER_EFF_BAND[1]) {
                findings.push(finding(
                    'charger-eff-out-of-band', 'warning', 'Charging efficiency out of band',
                    `${where}${(eff * 100).toFixed(1)}% is outside `
                    + `${(CHARGER_EFF_BAND[0] * 100).toFixed(0)}–${(CHARGER_EFF_BAND[1] * 100).toFixed(0)}%. `
                    + 'It is measured, not assumed, so a figure this far out means one of the two '
                    + 'energies is wrong rather than that the charger is unusual.',
                    { efficiency: eff, band: CHARGER_EFF_BAND, testNumber: t.testNumber },
                ));
            }
        }

        // ── Stated total against its own phases ─────────────────────────────
        // The same measurement reported twice. They should agree to rounding,
        // and when they do not the usual cause is a phase that failed to parse
        // — which is invisible otherwise, because the remaining phases still
        // produce a consumption figure of entirely believable magnitude.
        // Multi-cycle only. There the phases span the depletion, so their sum
        // and the stated total are one measurement reported twice. On a
        // single-cycle test the phase is ONE cycle and the total is the whole
        // depletion — 2.446 kWh against 106.227 on BMW's i7 — which is the
        // method working, not a phase gone missing.
        const phaseEnergy = t.phases.reduce((s, p) => s + (p.dcKwh ?? 0), 0);
        if (t.procedureCode === PROC_MCT && t.totalDcKwh > 0 && phaseEnergy > 0) {
            const delta = pct(phaseEnergy, t.totalDcKwh);
            if (Math.abs(delta) > PHASE_SUM_TOLERANCE_PCT) {
                findings.push(finding(
                    'phase-sum-mismatch', 'warning', 'Phases do not sum to the stated total',
                    `${where}the phases add to ${phaseEnergy.toFixed(3)} kWh against a stated `
                    + `${t.totalDcKwh.toFixed(3)} kWh (${delta > 0 ? '+' : ''}${delta.toFixed(2)}%). `
                    + 'A phase is missing, duplicated, or carrying the wrong energy.',
                    { phaseEnergy, totalDcKwh: t.totalDcKwh, deltaPct: delta, testNumber: t.testNumber },
                ));
            }
        }

        // ── Phases with no energy at all ────────────────────────────────────
        const empty = t.phases.filter(p => !(p.dcKwh > 0)).length;
        if (t.phases.length && empty) {
            findings.push(finding(
                'phase-missing-energy', 'warning', 'Phases with no energy',
                `${where}${empty} of ${t.phases.length} phases carry no DC energy. `
                + 'Every figure derived from this test is computed over the phases that do.',
                { empty, total: t.phases.length, testNumber: t.testNumber },
            ));
        }
    }

    // ── Test weight ─────────────────────────────────────────────────────────
    // Not cosmetic: grade energy is mass x height, so without it any elevation
    // term silently evaluates to nothing rather than refusing.
    const primary = g.coefficientSets.find(s => s.is_primary) ?? g.coefficientSets[0];
    if (primary && !(num(primary.equiv_test_weight_lbs) > 0)) {
        findings.push(finding(
            'test-weight-missing', 'warning', 'No equivalent test weight',
            'The CSI states one on the configuration page. Without it the grade term in any '
            + 'road-trip or elevation calculation evaluates to zero instead of declining to answer.',
            {},
        ));
    }

    // A group with NO charge-depleting test of any kind has nothing to derive
    // from. Single-cycle groups are deliberately not flagged: procedures 81 and
    // 84 measure city and highway in separate tests and each states its own
    // depletion energy, so an SCT record is a different method rather than a
    // deficient one. An earlier version reported "no multi-cycle test" on
    // BMW's i7 and claimed the cycles could not be separated, which was false
    // on both counts.
    if (!g.tests.some(t => CD_PROCEDURES.includes(t.procedureCode))) {
        findings.push(finding(
            'no-cd-test', 'warning', 'No charge-depleting test',
            'Nothing in this group ran procedure 77, 81 or 84, so there is no measurement of '
            + 'consumption or of pack capacity to derive anything from.',
            {},
        ));
    }

    const worst = findings.some(f => f.severity === 'error') ? 'error'
        : findings.length ? 'warning' : null;

    return { checked: true, findings, worst };
}

/**
 * The same checks as import-time warning strings.
 *
 * The import modal has no room for a table and the curator has no record to
 * open yet — at that moment the only useful form is a sentence saying which
 * configuration is suspect and why, next to the file it came from.
 */
export function integrityWarnings(group) {
    const { findings } = checkRecordIntegrity(group);
    const id = group?.test_group_id ? `${group.test_group_id}: ` : '';
    return findings.map(f => `${id}${f.label} — ${f.detail}`);
}
