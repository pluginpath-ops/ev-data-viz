import { describe, it, expect } from 'vitest';
import { auditGroup, auditGroups, auditSummary, auditFindings, AUDIT_VERDICTS } from '../epaAudit';

/**
 * Mercedes' MY2027 CLA 350 4MATIC (CSI-VMBXV00.0ED7) as the base record — a
 * real, sound multi-cycle group. Each case corrupts one thing.
 *
 * The point of this suite is that the sweep makes NO judgement of its own. It
 * calls the four existing checks unchanged and only decides how to order them,
 * so every expectation below is about ORDERING and NAMING, never about whether
 * a given number is acceptable.
 */
const cla = (over = {}) => ({
    test_group_id: 'C174PSM75f-Z2681',
    make: 'Mercedes-Benz',
    epa_carline_name: 'CLA 350 4MATIC with EQ',
    model_year: 2027,
    fe_guide_row_id: 42,
    cd_range_combined_calc: 461.373,
    cd_range_hwy_calc: 450.544,
    // What OUR derivation produces from the phases below, so the base record is
    // a genuine control. EPA publishes 176.0 / 168.7 for this car and that does
    // NOT reconcile — its label figures are DC-side while ours are wall-side —
    // which is a real finding with its own case further down, not a fixture to
    // build every other expectation on top of.
    unadj_city_mpge: 154.6463,
    unadj_hwy_mpge: 151.0207,
    nominal_pack_kwh: 88.9,
    epa_coefficient_sets: [
        { is_primary: true, category: 'City/Highway', target_a: 40.69, target_b: 0.0723,
          target_c: 0.01437, equiv_test_weight_lbs: 5000 },
    ],
    epa_vehicle_mappings: [{ id: 1, confidence: 'verified', vehicles: { id: 7, name: 'CLA 350', year: 2027 } }],
    epa_tests: [{
        test_number: 'TMBX10091675', test_date: '2025-07-22', procedure_code: 77,
        total_dc_energy_kwh: 90.038, ac_recharge_kwh: 100.556,
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
    ...over,
});

describe('auditGroup — identity and provenance', () => {
    it('carries the facts a curator needs to find the record', () => {
        const r = auditGroup(cla());
        expect(r.testGroupId).toBe('C174PSM75f-Z2681');
        expect(r.make).toBe('Mercedes-Benz');
        expect(r.vehicles.map(v => v.name)).toEqual(['CLA 350']);
        expect(r.linked).toBe(true);
    });

    it('prefers the curator display name over EPA\'s carline', () => {
        expect(auditGroup(cla({ display_name: 'CLA 350 4MATIC' })).carline).toBe('CLA 350 4MATIC');
    });

    it('notes a group nobody has linked, in both directions', () => {
        // 113 of 211 groups have no vehicle, so there is no Tests & Data tab to
        // reach them through — this is the only place their verdict shows.
        const r = auditGroup(cla({ fe_guide_row_id: null, epa_vehicle_mappings: [] }));
        expect(r.notes).toContain('no guide row linked');
        expect(r.notes).toContain('no vehicle linked');
    });

    it('notes a carryover, naming the year the lab work is from', () => {
        const r = auditGroup(cla({ carryover_model_year: 2026 }));
        expect(r.notes.some(n => n.includes('MY2026'))).toBe(true);
    });

    it('names which test the figures came from when there are several', () => {
        const g = cla();
        g.epa_tests.push({ ...g.epa_tests[0], test_number: 'TMBX10092210', test_date: '2025-08-19' });
        const r = auditGroup(g);
        expect(r.notes.some(n => n.includes('TMBX10092210'))).toBe(true);
    });
});

describe('auditGroup — the verdict is the worst thing proven', () => {
    it('calls a self-contradicting record impossible', () => {
        // Recharge below discharge. No outside source can settle it.
        const g = cla();
        g.epa_tests[0].ac_recharge_kwh = 50;
        expect(auditGroup(g).verdict).toBe('impossible');
    });

    it('calls a label its own phases cannot reach impossible too', () => {
        // A maker may label at or below the computed range and never above.
        expect(auditGroup(cla({ label_range_published: 900 })).verdict).toBe('impossible');
    });

    it('ranks a real disagreement below an impossibility', () => {
        const g = cla({ unadj_city_mpge: 300 });   // nothing derived reaches this
        expect(auditGroup(g).verdict).toBe('disagrees');
    });

    it('calls an out-of-band figure suspect rather than wrong', () => {
        // A band is a curation judgement, so it is evidence and not proof.
        expect(auditGroup(cla({ nominal_pack_kwh: 3.2 })).verdict).toBe('suspect');
    });

    it('does not call an underivable record agreeing', () => {
        // The failure mode this exists to avoid: a sweep whose unreadable
        // records are silent reports health it never measured.
        const r = auditGroup(cla({ epa_tests: [] }));
        expect(r.verdict).toBe('unchecked');
        expect(r.reasonText).toBe('No tests imported.');
    });

    it('does not call an unchecked record agreeing either', () => {
        // Nothing to compare against is not the same as comparing and agreeing.
        const r = auditGroup(cla({
            fe_guide_row_id: null, unadj_city_mpge: null, unadj_hwy_mpge: null,
            cd_range_combined_calc: null, cd_range_hwy_calc: null,
        }));
        expect(r.verdict).toBe('unchecked');
    });
});

describe('auditGroups — ordering', () => {
    it('sorts worst first, so the list opens on what matters', () => {
        const impossible = cla({ test_group_id: 'A', label_range_published: 900 });
        const suspect    = cla({ test_group_id: 'B', nominal_pack_kwh: 3.2 });
        const unchecked  = cla({ test_group_id: 'C', epa_tests: [] });
        const rows = auditGroups([unchecked, suspect, impossible]);
        expect(rows.map(r => r.verdict)).toEqual(['impossible', 'suspect', 'unchecked']);
    });

    it('is stable within a verdict, so the list does not shuffle between loads', () => {
        const a = cla({ test_group_id: 'A', make: 'Zeta', epa_carline_name: 'Z' });
        const b = cla({ test_group_id: 'B', make: 'Alpha', epa_carline_name: 'A' });
        expect(auditGroups([a, b]).map(r => r.make)).toEqual(['Alpha', 'Zeta']);
        expect(auditGroups([b, a]).map(r => r.make)).toEqual(['Alpha', 'Zeta']);
    });

    it('counts every row exactly once', () => {
        const rows = auditGroups([cla({ test_group_id: 'A' }), cla({ test_group_id: 'B', epa_tests: [] })]);
        const counts = auditSummary(rows);
        expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(2);
        expect(Object.keys(counts).sort()).toEqual(AUDIT_VERDICTS.map(v => v.key).sort());
    });
});

describe('auditFindings — the four shapes, flattened to sentences', () => {
    it('reports an integrity finding', () => {
        const f = auditFindings(auditGroup(cla({ nominal_pack_kwh: 3.2 })));
        expect(f.some(x => x.text.startsWith('Pack energy implausible'))).toBe(true);
    });

    it('reports the invariant with both figures', () => {
        const f = auditFindings(auditGroup(cla({ label_range_published: 900 })));
        expect(f.some(x => x.text.includes('900 mi exceeds the computed'))).toBe(true);
    });

    it('names the cycle a comparison failed on', () => {
        const f = auditFindings(auditGroup(cla({ unadj_city_mpge: 300 })));
        expect(f.some(x => x.text.startsWith('Unadjusted MPGe, City'))).toBe(true);
    });

    it('says why a record could not be checked', () => {
        const f = auditFindings(auditGroup(cla({ epa_tests: [] })));
        expect(f.some(x => x.severity === 'unchecked' && x.text === 'No tests imported.')).toBe(true);
    });

    it('says nothing about a record that reconciles', () => {
        // The base record is sound, and silence has to be trustworthy for the
        // list to be worth scanning.
        expect(auditFindings(auditGroup(cla()))).toEqual([]);
    });
});

describe('auditGroup — the real CLA 350, whose label is DC-side', () => {
    /**
     * EPA publishes 176.0 / 168.7 unadjusted for this car. Our derivation is
     * wall-side and gives 154.6 / 151.0, and the gap is exactly the charging
     * loss: 151.0 / 0.8954 = 168.6 against EPA's 168.7.
     *
     * So the record is not wrong and neither is ours — Mercedes' label
     * submission omitted charging losses where Volvo's included them. The sweep
     * has no way to know that, and MUST NOT pretend to: it reports the
     * disagreement and leaves which side is right to a curator.
     */
    const real = () => cla({ unadj_city_mpge: 176.0, unadj_hwy_mpge: 168.7 });

    it('reports it as a disagreement rather than an impossibility', () => {
        // Nothing here contradicts itself. Two sources differ, and settling
        // that needs a judgement this module does not make.
        expect(auditGroup(real()).verdict).toBe('disagrees');
    });

    it('names both cycles and the size of each gap', () => {
        const texts = auditFindings(auditGroup(real())).map(f => f.text);
        expect(texts).toContain('Unadjusted MPGe, City: -12.13%');
        expect(texts).toContain('Unadjusted MPGe, Highway: -10.48%');
    });

    it('still finds the phases reconcile against the record\'s own ranges', () => {
        // The distinction that makes the disagreement readable: the bags are
        // sound, so the gap is in the comparison and not in the phase data.
        expect(auditGroup(real()).rangeCheck.worst).toBe('agrees');
    });
});

describe('auditGroup — a group holding two multi-cycle tests (#227)', () => {
    /**
     * Mercedes' CLA 350 was run twice, a month apart, and the two disagree by
     * about 3%: 461.373/450.544 on 2025-07-22 and 475.482/460.354 on 2025-08-19.
     *
     * The derivation uses the most RECENT test. The group's stated ranges were
     * set at import from the FIRST. So the bag check recomputed one test's
     * phases and compared them against the other test's figures, and called the
     * difference a fault — on exactly the records where careful reading matters
     * most, and using the one check that otherwise needs no external source.
     */
    const twoTests = ({ perTest = true } = {}) => {
        const g = cla();
        const first = g.epa_tests[0];
        // The REAL second run, not a copy of the first — its phases are what
        // make the two ranges differ, and a copied fixture would reconcile
        // against either test and prove nothing.
        const second = {
            test_number: 'TMBX10092210', test_date: '2025-08-19', procedure_code: 77,
            total_dc_energy_kwh: 89.595, ac_recharge_kwh: 99.4041,
            cd_range_combined_calc: perTest ? 475.482 : undefined,
            cd_range_hwy_calc: perTest ? 460.354 : undefined,
            epa_test_phases: [
                { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.495,    dc_energy_kwh: 1.5658 },
                { phase_index: 2, phase_type: 'HWY',  distance_mi: 10.257,   dc_energy_kwh: 2.0355 },
                { phase_index: 3, phase_type: 'UDDS', distance_mi: 7.4751,   dc_energy_kwh: 1.4221 },
                { phase_index: 4, phase_type: 'SS',   distance_mi: 303.3528, dc_energy_kwh: 70.9878 },
                { phase_index: 5, phase_type: 'UDDS', distance_mi: 7.5068,   dc_energy_kwh: 1.4092 },
                { phase_index: 6, phase_type: 'HWY',  distance_mi: 10.2669,  dc_energy_kwh: 1.9589 },
                { phase_index: 7, phase_type: 'UDDS', distance_mi: 7.4919,   dc_energy_kwh: 1.3952 },
                { phase_index: 8, phase_type: 'SS',   distance_mi: 38.0074,  dc_energy_kwh: 8.8209 },
            ],
        };
        if (perTest) {
            first.cd_range_combined_calc = 461.373;
            first.cd_range_hwy_calc = 450.544;
        }
        g.epa_tests = [first, second];
        // The group keeps the FIRST test's figures, which is what import writes.
        g.cd_range_combined_calc = 461.373;
        g.cd_range_hwy_calc = 450.544;
        // Both runs are wall-side-checked against the same published pair; the
        // MPGe check is not what this block is about.
        g.unadj_city_mpge = null;
        g.unadj_hwy_mpge = null;
        return g;
    };

    it('compares against the ranges of the test it derived from', () => {
        // The second test's phases against the second test's stated ranges.
        const r = auditGroup(twoTests());
        expect(r.notes.some(n => n.includes('TMBX10092210'))).toBe(true);
        expect(r.rangeCheck.checked).toBe(true);
        for (const c of r.rangeCheck.cycles) {
            expect(Math.abs(c.deltaPct), `${c.label} should reconcile`).toBeLessThan(1);
        }
    });

    it('reported a false disagreement before, on the same data', () => {
        // Without per-test ranges there is nothing to compare like with like:
        // the group's pair belongs to the other laboratory's run.
        const r = auditGroup(twoTests({ perTest: false }));
        const worst = Math.max(...r.rangeCheck.cycles.map(c => Math.abs(c.deltaPct)));
        expect(worst).toBeGreaterThan(1);
    });

    it('says so, rather than letting the old verdict pass as sound', () => {
        // Records imported before migration 060 still cross tests, and the
        // check's verdict is worth less on them. Silence would hide that.
        const r = auditGroup(twoTests({ perTest: false }));
        expect(r.notes.some(n => n.includes('re-import'))).toBe(true);
    });

    it('leaves a group with one test alone', () => {
        // Nothing to cross, so no caveat and no behaviour change.
        const r = auditGroup(cla());
        expect(r.notes.some(n => n.includes('re-import'))).toBe(false);
    });
});

describe('auditGroup — honouring a selected test', () => {
    const twoRuns = (over = {}) => {
        const g = cla();
        const first = g.epa_tests[0];
        first.cd_range_combined_calc = 461.373;
        first.cd_range_hwy_calc = 450.544;
        g.epa_tests = [first, {
            test_number: 'TMBX10092210', test_date: '2025-08-19', procedure_code: 77,
            total_dc_energy_kwh: 89.595, ac_recharge_kwh: 99.4041,
            cd_range_combined_calc: 475.482, cd_range_hwy_calc: 460.354,
            epa_test_phases: first.epa_test_phases.map(p => ({ ...p })),
        }];
        return { ...g, ...over };
    };

    it('derives from the most recent when nothing has been selected', () => {
        const r = auditGroup(twoRuns());
        expect(r.notes.some(n => n.includes('TMBX10092210'))).toBe(true);
    });

    it('derives from the selected test instead, even though it is older', () => {
        // The whole point: EPA used the July run, and the default picks August.
        const r = auditGroup(twoRuns({ preferred_test_number: 'TMBX10091675' }));
        expect(r.notes.some(n => n.includes('TMBX10091675'))).toBe(true);
    });

    it('falls back rather than failing when the selection names a missing test', () => {
        // A re-import can drop a test number. The default is still a reasonable
        // answer, so this degrades instead of refusing to derive at all.
        const r = auditGroup(twoRuns({ preferred_test_number: 'GONE' }));
        expect(r.verdict).not.toBe('unchecked');
        expect(r.notes.some(n => n.includes('TMBX10092210'))).toBe(true);
    });
});
