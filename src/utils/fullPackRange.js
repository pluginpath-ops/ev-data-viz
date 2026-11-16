/**
 * A range test's range on a FULL pack, as the Range chart bars it.
 *
 * A range test drives some stretch of road, rarely a whole pack. Its "range" is
 * what that stretch implies for the pack, by the best basis the test has:
 *
 *   soc-window    distance × 100 / the SoC it used — a test that logged its
 *                 start and end SoC, which is a measurement of the pack itself.
 *   efficiency    the test's own efficiency × the vehicle's capacity
 *                 (`socWindowKwh`: EPA tested, else Usable, else Gross). For a
 *                 test with energy and distance but no SoC window: 23.3 mi on
 *                 5.8 kWh is 4.02 mi/kWh, and 4.02 × 89 kWh is 358 mi. Worked
 *                 out BEFORE any correction, which then scales it like every
 *                 other range (the correction multiplies distance, and both
 *                 figures are linear in it).
 *   distance      neither: the miles the test covered, which is what the chart
 *                 always fell back to. It is not a range, and the basis says so.
 *
 * The owner's call (2026-10-25): a test with energy but no SoC window was being
 * drawn at its raw 20-odd miles beside tests of 250+, which reads as a car that
 * goes 23 miles.
 *
 * Pure module — no React, no database.
 */
import { SOC_WINDOW_BASIS } from './vehicleFigures';
import { val } from './calcTrace';

const positive = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {Object} run      a range test (distance_miles, energy_kwh, start_soc, end_soc)
 * @param {Object} [vehicle] its vehicle, for the resolved capacity (`socWindowKwh`, `socWindowBasis`)
 * @returns {{ mi: number, basis: 'soc-window'|'efficiency'|'distance',
 *             socUsed?: number, miPerKwh?: number, capacityKwh?: number, capacityLabel?: string } | null}
 *   null when the test has no distance
 */
export function fullPackRange(run, vehicle = null, trace = null) {
    const distance = positive(run?.distance_miles);
    if (!distance) return null;

    if (run.start_soc != null && run.end_soc != null) {
        const socUsed = run.start_soc - run.end_soc;
        trace?.step('SoC used', { formula: 'ΔSoC = SoC_start − SoC_end', values: { SoC_start: val(run.start_soc, '%', 'data'), SoC_end: val(run.end_soc, '%', 'data') }, result: socUsed, unit: '%' });
        if (socUsed > 0) {
            const mi = (distance * 100) / socUsed;
            trace?.step('Full-pack range (SoC window)', { formula: 'R = d × 100 / ΔSoC', values: { d: val(distance, 'mi'), ΔSoC: val(socUsed, '%') }, result: mi, unit: 'mi' });
            return { mi, basis: 'soc-window', socUsed };
        }
    }

    const energy = positive(run.energy_kwh);
    const capacityKwh = positive(vehicle?.socWindowKwh);
    if (energy && capacityKwh) {
        const miPerKwh = distance / energy;
        trace?.step('Full-pack range (own efficiency × capacity)', {
            formula: 'R = d / E × E_pack',
            values: { d: val(distance, 'mi'), E: val(energy, 'kWh', 'data'), E_pack: val(capacityKwh, 'kWh', 'data') },
            result: miPerKwh * capacityKwh, unit: 'mi',
            note: `no SoC window logged; capacity is ${SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label ?? 'the vehicle\'s'}`,
        });
        return {
            mi: miPerKwh * capacityKwh,
            basis: 'efficiency',
            miPerKwh,
            capacityKwh,
            capacityLabel: SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label ?? null,
        };
    }

    trace?.note('Neither an SoC window nor energy and capacity: the bar is the distance driven, not a range', { assumed: true });
    return { mi: distance, basis: 'distance' };
}
