import { describe, it, expect } from 'vitest';
import { checkRecordIntegrity, integrityWarnings } from '../epaIntegrity';

/**
 * The numbers are Mercedes' MY2027 CLA 350 4MATIC (CSI-VMBXV00.0ED7), which is
 * a clean record — it exists here as the control. Every failing case is that
 * record with one field corrupted the way a real import corrupted it: a bulk
 * load of every MY2026 BEV certification produced 2-5 kWh traction packs and
 * charger efficiencies near 1%, clustered within single manufacturers.
 */
const clean = () => ({
    test_group_id: 'C174PSM75f-Z2681',
    total_voltage: 700,
    nominal_pack_kwh: 88.9,
    epa_coefficient_sets: [
        { is_primary: true, target_a: 40.69, target_b: 0.0723, target_c: 0.01437,
          equiv_test_weight_lbs: 5000 },
    ],
    epa_tests: [{
        test_number: 'TMBX10091675',
        procedure_code: 77,
        total_dc_energy_kwh: 90.038,
        ac_recharge_kwh: 100.556,
        epa_test_phases: [
            { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.5228021, dc_energy_kwh: 1.6416218 },
            { phase_index: 2, phase_type: 'HWY',  distance_mi: 10.2743406, dc_energy_kwh: 2.0807097 },
            { phase_index: 3, phase_type: 'UDDS', distance_mi: 7.49133,   dc_energy_kwh: 1.4915767 },
            { phase_index: 4, phase_type: 'SS',   distance_mi: 281.313556, dc_energy_kwh: 66.0184098 },
            { phase_index: 5, phase_type: 'UDDS', distance_mi: 7.4980355, dc_energy_kwh: 1.4341407 },
            { phase_index: 6, phase_type: 'HWY',  distance_mi: 10.2624932, dc_energy_kwh: 2.0233391 },
            { phase_index: 7, phase_type: 'UDDS', distance_mi: 7.4798542, dc_energy_kwh: 1.4495551 },
            { phase_index: 8, phase_type: 'SS',   distance_mi: 59.723748, dc_energy_kwh: 13.8985443 },
        ],
    }],
});

const codes = (g) => checkRecordIntegrity(g).findings.map(f => f.code);

describe('checkRecordIntegrity — a sound record', () => {
    it('finds nothing wrong with the real CLA 350', () => {
        const { checked, findings, worst } = checkRecordIntegrity(clean());
        expect(checked).toBe(true);
        expect(findings).toEqual([]);
        expect(worst).toBeNull();
    });

    it('treats an absent figure as absent, not as zero', () => {
        // Caught by running the real CLA PDF through it. A parsed group carries
        // useable_kwh: null and gets nominal_pack_kwh only once a guide row is
        // linked — and Number(null) is 0, which is finite, so the check invented
        // a 0.0 kWh pack and reported it as an impossibility.
        const g = clean();
        g.nominal_pack_kwh = null;
        g.useable_kwh = null;
        expect(codes(g)).not.toContain('pack-energy-implausible');
    });

    it('declines rather than passing when there is nothing to check', () => {
        // Silence has to mean "checked and sound", never "could not look".
        expect(checkRecordIntegrity(null).checked).toBe(false);
        expect(checkRecordIntegrity({ epa_tests: [] }).checked).toBe(false);
    });
});

describe('checkRecordIntegrity — the impossibilities', () => {
    it('catches a recharge smaller than the discharge', () => {
        const g = clean();
        g.epa_tests[0].ac_recharge_kwh = 80;   // less in than came out
        const f = checkRecordIntegrity(g);
        expect(f.findings.map(x => x.code)).toContain('recharge-below-draw');
        expect(f.worst).toBe('error');
    });

    it('does not also report that as an out-of-band efficiency', () => {
        // One cause, one finding. Saying it twice reads as two problems.
        const g = clean();
        g.epa_tests[0].ac_recharge_kwh = 80;
        expect(codes(g).filter(c => c === 'charger-eff-out-of-band')).toHaveLength(0);
    });

    it('catches the 1% charging efficiency', () => {
        const g = clean();
        g.epa_tests[0].total_dc_energy_kwh = 0.9;  // a factor-of-100 misread
        expect(codes(g)).toContain('charger-eff-out-of-band');
    });
});

describe('checkRecordIntegrity — the implausibilities', () => {
    it('catches the 2-5 kWh traction pack', () => {
        const g = clean();
        g.nominal_pack_kwh = 3.2;
        const f = checkRecordIntegrity(g);
        expect(f.findings.map(x => x.code)).toContain('pack-energy-implausible');
        // A band is a judgement, so this is evidence rather than proof.
        expect(f.worst).toBe('warning');
    });

    it('catches a phase that failed to parse', () => {
        // The dangerous shape: drop one phase and the remaining seven still
        // produce a consumption figure of entirely believable magnitude.
        const g = clean();
        g.epa_tests[0].epa_test_phases.splice(3, 1);   // the 66 kWh SS phase
        expect(codes(g)).toContain('phase-sum-mismatch');
    });

    it('catches a phase carrying no energy', () => {
        const g = clean();
        g.epa_tests[0].epa_test_phases[2].dc_energy_kwh = null;
        expect(codes(g)).toContain('phase-missing-energy');
    });

    it('catches a missing test weight', () => {
        // Not cosmetic: grade energy is mass x height, so without it the
        // elevation term evaluates to zero instead of declining to answer.
        const g = clean();
        delete g.epa_coefficient_sets[0].equiv_test_weight_lbs;
        expect(codes(g)).toContain('test-weight-missing');
    });

    it('catches a group with no charge-depleting test', () => {
        const g = clean();
        g.epa_tests[0].procedure_code = 2;
        expect(codes(g)).toContain('no-cd-test');
    });
});

describe('checkRecordIntegrity — single-cycle tests measure a rate and a capacity', () => {
    /**
     * BMW's MY2026 i7 eDrive50 (CSI-TBMXV00.0G7A). No procedure 77 — only 81
     * (CD-UDDS) and 84 (CD-Highway). A single-cycle test drives ONE cycle and
     * repeats it until the pack is empty, so the phase is the RATE (2.446 kWh
     * over one 10.25-mile HWFET) and "System End State of Charge Watt-hours" is
     * the CAPACITY (106.227 kWh over the 445.14-mile depletion).
     *
     * The parser stored the phase sum as the total, which is where the 2-5 kWh
     * packs came from, and made charging efficiency 2.446/119.873 = 2%.
     */
    const bmw = () => ({
        test_group_id: 'CL34779-0',
        total_voltage: 376,
        epa_coefficient_sets: [
            { is_primary: true, target_a: 35, target_b: 0.2, target_c: 0.018,
              equiv_test_weight_lbs: 6000 },
        ],
        epa_tests: [
            { test_number: 'RBMX10080457', procedure_code: 81,
              total_dc_energy_kwh: 106.227, ac_recharge_kwh: 119.873,
              epa_test_phases: [{ phase_index: 1, phase_type: 'UDDS', distance_mi: 7.45, dc_energy_kwh: 1.931 }] },
            { test_number: 'RBMX10080458', procedure_code: 84,
              total_dc_energy_kwh: 106.227, ac_recharge_kwh: 119.873,
              epa_test_phases: [{ phase_index: 1, phase_type: 'HWY', distance_mi: 10.25, dc_energy_kwh: 2.446 }] },
        ],
    });

    it('reads a sound single-cycle record as sound', () => {
        // 106.227/119.873 is 88.6%, which is an ordinary charger. The record
        // reconciles every way it can be checked: 106.227 / (2.446/10.25) is
        // 445.15 miles against a stated 445.14.
        expect(checkRecordIntegrity(bmw()).findings).toEqual([]);
    });

    it('does not read the per-cycle phase as a missing phase', () => {
        // The phase is one cycle and the total is the depletion, so they are
        // not the same quantity and never agree. Comparing them reported a
        // -97.7% shortfall on a correct record.
        expect(codes(bmw())).not.toContain('phase-sum-mismatch');
    });

    it('does not call a single-cycle group deficient', () => {
        // 81 and 84 measure city and highway in separate tests, so this is a
        // different method rather than a missing one. An earlier version said
        // the cycles could not be separated, which was false.
        expect(codes(bmw())).not.toContain('no-cd-test');
    });

    it('still catches a genuinely bad single-cycle record', () => {
        // The restriction removed above must not have removed the check: if the
        // depletion total really is a per-cycle figure, say so.
        const g = bmw();
        g.epa_tests[0].total_dc_energy_kwh = 2.446;
        expect(codes(g)).toContain('charger-eff-out-of-band');
    });

    it('flags a group with no charge-depleting test at all', () => {
        const g = bmw();
        g.epa_tests.forEach(t => { t.procedure_code = 2; });
        expect(codes(g)).toContain('no-cd-test');
    });
});

describe('checkRecordIntegrity — reading both group shapes', () => {
    it('reads a parsed group as well as a stored one', () => {
        // At import a group carries tests[].phases[]; once stored it carries
        // epa_tests[].epa_test_phases[]. The checks are worth running at both
        // ends, so neither spelling may be the only one understood.
        const stored = clean();
        const parsed = {
            test_group_id: stored.test_group_id,
            nominal_pack_kwh: 3.2,
            coefficient_sets: stored.epa_coefficient_sets,
            tests: stored.epa_tests.map(t => ({ ...t, phases: t.epa_test_phases })),
        };
        expect(checkRecordIntegrity(parsed).checked).toBe(true);
        expect(codes(parsed)).toContain('pack-energy-implausible');
    });
});

describe('integrityWarnings', () => {
    it('names the configuration, so a bulk import says which file is suspect', () => {
        const g = clean();
        g.nominal_pack_kwh = 3.2;
        const [w] = integrityWarnings(g);
        expect(w).toContain('C174PSM75f-Z2681');
        expect(w).toContain('Pack energy implausible');
    });

    it('says nothing about a sound record', () => {
        expect(integrityWarnings(clean())).toEqual([]);
    });
});
