import { describe, it, expect } from 'vitest';
import {
    CERT_MEASURES, certMeasureByKey, certObservation, certObservations,
    coverageFor, derivedUsableKwh, NOT_MEASURED_SOURCES,
} from '../epaCertStats';
import { deriveDrivetrainEta, deriveChargerEfficiency } from '../epaDerivations';

const group = (o = {}) => ({
    test_group_id: o.id ?? 'TG1',
    model_year: o.year ?? 2025,
    useable_kwh: o.useable ?? null,
    epa_coefficient_sets: o.coeffs ?? [{ is_primary: true, target_a: 37, target_b: 0.2, target_c: 0.02, equiv_test_weight_lbs: 5500 }],
    epa_tests: o.tests ?? [],
    // `in`, not `??`: a test passing `guide: null` means "no guide row", and
    // `??` would coalesce it straight back to the default and assert the
    // opposite of what was written.
    epa_fe_guide: 'guide' in o ? o.guide
        : { division: 'Rivian', carline: 'R1S', carline_class: 'Standard SUV 4WD', drive_desc: 'Part-time 4-Wheel Drive', nominal_pack_kwh: 149.7 },
});

describe('dimensions come from the linked guide row', () => {
    it('takes class and drive from the guide, not the certification record', () => {
        // The certification record identifies itself by a manufacturer Vehicle
        // ID and knows nothing about class or drivetrain. That is why #238 had
        // to happen before any of this was groupable.
        const o = certObservation(group(), undefined);
        expect(o.body_class).toBe('Standard SUV');
        expect(o.drive_group).toBe('All Wheel Drive');
    });
    it('leaves them null when the group has no guide row', () => {
        const o = certObservation(group({ guide: null }), undefined);
        expect(o.body_class).toBeNull();
        expect(o.drive_group).toBeNull();
    });
    it('still reports the measures without a guide row', () => {
        expect(certObservation(group({ guide: null }), undefined).aero_c).toBe(0.02);
    });
});

describe('an assumption is not a measurement', () => {
    const noPhases = group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 90 }] });

    it('the source names the derivations use are what this module checks for', () => {
        // The bug this pins: deriveDrivetrainEta calls its fallback
        // 'estimated' and deriveChargerEfficiency calls its 'assumed'. A single
        // check for one of them let every un-derivable η through, and the fleet
        // median came out at exactly DEFAULT_ETA — the constant, reported as a
        // measurement of 181 vehicles.
        expect(NOT_MEASURED_SOURCES.eta).toContain(deriveDrivetrainEta(noPhases).source);
        expect(NOT_MEASURED_SOURCES.charger_eff).toContain(deriveChargerEfficiency(noPhases).source);
    });
    it('drops a fallback η rather than counting the default', () => {
        expect(certObservation(noPhases, undefined).eta).toBeNull();
    });
    it('drops a fallback charger efficiency', () => {
        expect(certObservation(noPhases, undefined).charger_eff).toBeNull();
    });
    it('keeps a derived charger efficiency', () => {
        const derivable = group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 88, ac_recharge_kwh: 100 }] });
        expect(certObservation(derivable, undefined).charger_eff).toBeCloseTo(0.88, 3);
    });
});

describe('usable energy and the pack buffer', () => {
    it('prefers a curator value over the measured discharge', () => {
        expect(derivedUsableKwh(group({ useable: 141, tests: [{ procedure_code: 77, total_dc_energy_kwh: 90 }] }))).toBe(141);
    });
    it('falls back to DC discharged on the derivation test', () => {
        expect(derivedUsableKwh(group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 90 }] }))).toBe(90);
    });
    it('ignores a procedure the derivations do not use', () => {
        // Proc 86 is a short cycle; its DC energy is not a pack capacity.
        expect(derivedUsableKwh(group({ tests: [{ procedure_code: 86, total_dc_energy_kwh: 6 }] }))).toBeNull();
    });
    it('drops a usable-to-gross ratio above 1', () => {
        // Three Teslas report more usable energy than the guide's gross pack,
        // at 1.02 to 1.03. A pack cannot deliver more than it holds, so the two
        // sources contradict and the gross figure is the softer one.
        const impossible = group({
            useable: 82.5,
            guide: { division: 'Tesla', carline_class: 'Small SUV 4WD', nominal_pack_kwh: 79.8 },
        });
        expect(certObservation(impossible, undefined).usable_fraction).toBeNull();
    });
    it('keeps a plausible ratio', () => {
        const ok = group({ useable: 141, guide: { division: 'Rivian', nominal_pack_kwh: 149.7 } });
        expect(certObservation(ok, undefined).usable_fraction).toBeCloseTo(0.942, 3);
    });
});

describe('coverage', () => {
    const obs = certObservations([
        group({ id: 'A', tests: [{ procedure_code: 77, total_dc_energy_kwh: 88, ac_recharge_kwh: 100 }] }),
        group({ id: 'B', tests: [{ procedure_code: 77, total_dc_energy_kwh: 90 }] }),
        group({ id: 'C', tests: [] }),
    ], undefined);

    it('separates what was derived from what fell back', () => {
        const c = coverageFor(obs, 'charger_eff');
        expect(c.usable).toBe(1);
        expect(c.assumed).toBe(2);
        expect(c.total).toBe(3);
    });
    it('counts a plain absence as missing, not as an assumption', () => {
        const c = coverageFor(obs, 'etw_lbs');
        expect(c.usable).toBe(3);
        expect(c.assumed).toBe(0);
    });
});

describe('measures', () => {
    it('has no duplicate keys', () => {
        const keys = CERT_MEASURES.map(m => m.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
    it('every measure resolves', () => {
        CERT_MEASURES.forEach(m => expect(certMeasureByKey(m.key)).not.toBeNull());
    });
});
