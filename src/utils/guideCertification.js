import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, PROC_FTP75 } from '../constants/epa';
import { testHref } from './testDetails';

/**
 * What the Fuel Economy Guide detail modal says about the certification behind
 * a label (#337). Pure, so the modal stays a rearrangement of figures.
 */

const PROCEDURE_LABEL = {
    [PROC_MCT]:     'Multi-cycle test',
    [PROC_CD_HWY]:  'Charge-depleting highway',
    [PROC_CD_UDDS]: 'Charge-depleting city (UDDS)',
    [PROC_FTP75]:   'CVS 75 (procedure 2)',
};

export const procedureLabel = (code) => {
    if (code == null || code === '') return 'Unknown procedure';
    return PROCEDURE_LABEL[Number(code)] ?? `Procedure ${code}`;
};

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * A test vehicle's tests as display rows. The multi-cycle test leads: it is what the
 * app calls EPA tested, so it is the one a reader came for. The rest keep test
 * number order, and phases keep their own.
 */
export function certificationTests(testVehicle) {
    const rows = (testVehicle?.epa_tests ?? []).map((t, i) => ({
        id: t.id ?? `t${i}`,
        number: t.test_number ?? null,
        date: t.test_date ?? null,
        procedureCode: num(t.procedure_code),
        procedure: procedureLabel(t.procedure_code),
        isEpaTested: num(t.procedure_code) === PROC_MCT,
        dcKwh: num(t.total_dc_energy_kwh),
        phases: [...(t.epa_test_phases ?? [])]
            .sort((a, b) => (num(a.phase_index) ?? 0) - (num(b.phase_index) ?? 0))
            .map(p => ({
                index: num(p.phase_index),
                type: p.phase_type ?? null,
                distanceMi: num(p.distance_mi),
                dcKwh: num(p.dc_energy_kwh),
            })),
    }));
    return rows.sort((a, b) =>
        (b.isEpaTested - a.isEpaTested) || String(a.number ?? '').localeCompare(String(b.number ?? '')));
}

/** Coefficient sets, primary first. */
export function certificationCoefficients(testVehicle) {
    return [...(testVehicle?.epa_coefficient_sets ?? [])]
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
            || String(a.category ?? '').localeCompare(String(b.category ?? '')))
        .map(c => {
            const target = [c.target_a, c.target_b, c.target_c].map(num);
            const set = [c.set_a, c.set_b, c.set_c].map(num);
            const complete = (v) => v.every(x => x != null);
            return {
                id: c.id, category: c.category ?? null, primary: Boolean(c.is_primary),
                target, set,
                // The set the app computes with: the target when it is whole, the
                // set only as its fallback — see resolvePrimaryCoeffs.
                used: complete(target) ? 'target' : complete(set) ? 'set' : null,
                weightLbs: num(c.equiv_test_weight_lbs),
            };
        });
}

/**
 * How many guide configurations were certified under this row's Test Group in
 * its model year — 1 when it has no Test Group, or stands alone in it. EPA
 * certifies a Test Group once and rates each configuration in it, so a lab
 * result is not specific to one of them (both 2027 R2 rows share one while
 * reading 307 and 330 miles).
 */
export function configurationsInTestGroup(rows, row) {
    if (!row?.smog_test_group) return 1;
    const n = (rows ?? []).filter(r =>
        r.smog_test_group === row.smog_test_group && r.model_year === row.model_year).length;
    return Math.max(1, n);
}

/** Each linked vehicle once, with the link to its Tests & Data → EPA section. */
export function linkedVehicleLinks(vehicles) {
    const seen = new Set();
    const out = [];
    for (const v of vehicles ?? []) {
        if (v?.id == null || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push({ id: v.id, label: [v.year, v.name].filter(Boolean).join(' '), href: testHref({ vehicleId: v.id, sub: 'epa' }) });
    }
    return out;
}
