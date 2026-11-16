import { describe, it, expect } from 'vitest';
import { matchGreenNcapCar, modelKey, makeKey, modelAgreement, driveOf, yearSpan, lineageSpecs } from '../matchGreenNcap';

const v = (id, model, trim, year, specs = {}, extra = {}) => ({ id, make: 'Kia', model, trim, year, specs, ...extra });
const battery = (usable, gross) => ({ charging: { battery_usable_kwh: usable }, powertrain: { battery_gross_kwh: gross } });

const FLEET = [
    v(27, 'EV9', 'GT-Line AWD', '2024-2025', { ...battery(96.4, 99.8), powertrain: { drive_type: 'AWD', battery_gross_kwh: 99.8 } }),
    v(395, 'EV9', 'GT-Line AWD', '2026', {}, { spec_source_vehicle_id: 27 }),
    v(394, 'EV9', 'Light RWD', '2024-2026', { ...battery(76.1, 79.8), powertrain: { drive_type: 'RWD', battery_gross_kwh: 79.8 } }),
    v(207, 'EV6', 'SR RWD', '2022-2024', battery(58, 60)),
];
const EV9 = { make: 'KIA', model: 'EV9', variant: 'GT-line', drive: 'AWD', year: 2024, declaredKwh: 99.8, netKwh: 95.37 };

describe('names', () => {
    it('folds brand, filler words and punctuation', () => {
        expect(makeKey('Mercedes-Benz')).toBe('mercedes');
        expect(makeKey('VW')).toBe('volkswagen');
        expect(modelKey('Model 3', 'Tesla')).toBe(modelKey('3', 'Tesla'));
        expect(modelKey('KONA Electric', 'Hyundai')).toBe('kona');
        expect(modelKey('RENAULT 5 E-TECH ELECTRIC', 'RENAULT')).toBe('5');
        expect(modelKey('Mustang Mach-E', 'Ford')).toBe(modelKey('Mach-E', 'Ford'));
    });

    it('agrees exactly, loosely on a leading name, and not on a short one', () => {
        expect(modelAgreement('ev9', 'ev9')).toBe('exact');
        expect(modelAgreement('eqe350', 'eqe')).toBe('loose');
        expect(modelAgreement('eqe350', 'eqesuv')).toBe(null);
        expect(modelAgreement('x', '7x')).toBe(null);
    });

    it('reads drive and years', () => {
        expect(driveOf('Sportback 50 quattro')).toBe('AWD');
        expect(driveOf('eDrive35')).toBe('RWD');
        expect(driveOf('electric 4x2 automatic')).toBe('2WD');
        expect(yearSpan('2024-2026')).toEqual([2024, 2026]);
        expect(yearSpan(null)).toBe(null);
    });
});

describe('lineageSpecs', () => {
    it('takes each field from the nearest vehicle that has it', () => {
        const byId = new Map(FLEET.map(x => [x.id, x]));
        expect(lineageSpecs(FLEET[1], byId).charging.battery_usable_kwh).toBe(96.4);
    });
});

describe('matchGreenNcapCar', () => {
    it('matches when model, drive, battery and year agree', () => {
        const r = matchGreenNcapCar(EV9, FLEET);
        expect(r.status).toBe('match');
        expect(r.best.vehicle.id).toBe(27);
        expect(r.others.map(o => o.vehicle.id)).toContain(395);
    });

    it('asks for a check on a battery the fleet does not have', () => {
        const r = matchGreenNcapCar({ ...EV9, declaredKwh: 120, netKwh: 118 }, FLEET);
        expect(r.status).toBe('check');
        expect(r.reason).toMatch(/battery 96.4 kWh usable vs 120/);
    });

    it('falls back to the gross figure, saying so', () => {
        const r = matchGreenNcapCar({ make: 'Kia', model: 'EV6', variant: '', drive: 'RWD', year: 2023, declaredKwh: 61, netKwh: null }, FLEET);
        expect(r.best.vehicle.id).toBe(207);
        expect(r.reason).toMatch(/usable 58 kWh vs 61, gross 60 fits/);
    });

    it('says none for a brand or model EVBench lacks', () => {
        expect(matchGreenNcapCar({ ...EV9, make: 'Dacia' }, FLEET)).toMatchObject({ status: 'none', reason: 'no Dacia vehicles in EVBench' });
        expect(matchGreenNcapCar({ ...EV9, model: 'EV4' }, FLEET).status).toBe('none');
    });
});
