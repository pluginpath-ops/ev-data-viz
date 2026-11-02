/**
 * How each test vehicle of a Guide row's certification matches the row — the
 * list a curator reads under a vehicle's EPA Label (EPA identity, layer 3).
 *
 * The row's Tested via names the test vehicles behind it; this places every
 * other one of its pool too, so a curator sees why the named ones were named
 * and what the rest are: behind a sibling row, possibly part of a blend, or
 * nowhere near it.
 *
 *   exact        reproduces the row (Tested via exact)
 *   near         reproduces it, just past rounding
 *   blend        one of the two or three the row lies between; `nearest`
 *                marks the one that stands for the vehicle
 *   other-label  another row of the certification names it (`otherRowId`)
 *   alternative  Tested via found another explanation that uses it, as good
 *                as the one it named (an ambiguous row)
 *   possible     no row names it, but it could be one end of a blend
 *   no-match     it could not stand behind this row
 *   no-lab-data  its tests cannot give both cycles
 *
 * Pure: the caller supplies the row's Tested via, its pool, and the other
 * rows of its certification.
 */
import { couldStandBehind, guidePoint, testVehiclePoint } from './guideTestedVia';
import { configurationsFromTestedVia, namesTestVehicle } from './vehicleGuideLinks';
import { isNoLabelSkip } from './epaBehindNoLabel';

const ORDER = ['exact', 'near', 'blend', 'alternative', 'possible', 'other-label', 'no-match', 'no-lab-data'];

/**
 * @param {Object} row  { guide, via, pool }
 * @param {Array<{ rowId, via }>} [others]  the other rows of its certification,
 *        the vehicle's own linked ones included
 * @param {Set<string>} [linked]  test vehicles the vehicle links
 * @returns {Array<{
 *   test_vehicle_id, carline, match, nearest: boolean, otherRowId: number|null,
 *   delta: { city: number, hwy: number } | null, linked: boolean, behindNoLabel: boolean,
 * }>}  best match first; delta is the test vehicle's kWh/100mi against the
 *      row's, as a share (+0.03 uses 3% more)
 */
export function guideRowMatches({ guide, via, pool = [] } = {}, others = [], linked = new Set()) {
    const g = guidePoint(guide);
    const nearestId = configurationsFromTestedVia(via).find(c => c.primary)?.test_vehicle_id ?? null;
    const out = pool.map(tv => {
        const p = testVehiclePoint(tv);
        const sibling = others.find(o => namesTestVehicle(o.via, tv));
        let match;
        if (namesTestVehicle(via, tv)) match = via.verdict;
        else if (!p) match = 'no-lab-data';
        else if (sibling) match = 'other-label';
        else if ((via?.alternatives ?? []).includes(tv.test_vehicle_id)) match = 'alternative';
        else if (couldStandBehind(guide, tv, pool, via)) match = 'possible';
        else match = 'no-match';
        return {
            test_vehicle_id: tv.test_vehicle_id,
            carline: tv.epa_carline_name ?? null,
            match,
            nearest: match === 'blend' && tv.test_vehicle_id === nearestId,
            otherRowId: match === 'other-label' ? sibling.rowId : null,
            delta: g && p ? { city: p.city / g.city - 1, hwy: p.hwy / g.hwy - 1 } : null,
            linked: linked.has(tv.test_vehicle_id),
            behindNoLabel: isNoLabelSkip(tv),
        };
    });
    const size = (d) => (d ? Math.hypot(d.city, d.hwy) : Infinity);
    return out.sort((a, b) =>
        ORDER.indexOf(a.match) - ORDER.indexOf(b.match)
        || Number(b.nearest) - Number(a.nearest)
        || size(a.delta) - size(b.delta));
}

/** A delta share as the match lists print it: "+3.4%", "−0.2%". */
export const formatShare = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
