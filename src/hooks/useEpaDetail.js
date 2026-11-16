import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { slimTestVehicles, withEpaDetail } from '../utils/epaDetail';

// Keyed by the slim test vehicle OBJECT, not its id: a refresh after an edit
// returns new objects, so the old detail drops out by itself and is read again.
// Module-level, so two views of the same vehicle share one fetch.
const detailOf = new WeakMap();
const pending = new WeakMap();
// The last detail read for each test vehicle. While a refresh is re-reading it, a
// view keeps drawing from this instead of dropping back to "Loading", which
// would unmount a card a curator is in the middle of editing.
const lastById = new Map();

/**
 * The given vehicles with their EPA coefficient sets and full tests, which the
 * startup read leaves out (#501). `loading` is true until they are first here (a refresh keeps the last ones showing); a view
 * that reads them waits for it rather than drawing from the slim record.
 *
 * Pass only the vehicles the view shows — each one costs a read.
 */
export function useEpaDetail(vehicles) {
    const { getEpaDetail } = useAppContext();
    const [version, setVersion] = useState(0);
    const [failed, setFailed] = useState(false);

    const slim = useMemo(() => slimTestVehicles(vehicles ?? []).filter(t => !detailOf.has(t)), [vehicles, version]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const todo = slim.filter(t => !pending.has(t));
        if (!todo.length) return;
        const request = getEpaDetail(todo.map(t => t.test_vehicle_id));
        todo.forEach(t => pending.set(t, request));
        request.then(byId => {
            todo.forEach(t => {
                const detail = byId[t.test_vehicle_id] ?? { epa_coefficient_sets: [] };
                detailOf.set(t, detail);
                lastById.set(t.test_vehicle_id, detail);
                pending.delete(t);
            });
            setVersion(n => n + 1);
        }).catch(err => {
            console.error('EPA detail failed:', err.message);
            todo.forEach(t => pending.delete(t));
            setFailed(true);
        });
    }, [slim]); // eslint-disable-line react-hooks/exhaustive-deps -- getEpaDetail is a new function each render; `pending` already dedupes

    const merged = useMemo(
        () => withEpaDetail(vehicles ?? [], t => detailOf.get(t) ?? lastById.get(t.test_vehicle_id) ?? null),
        [vehicles, version]); // eslint-disable-line react-hooks/exhaustive-deps
    return { vehicles: merged, loading: !failed && slim.some(t => !lastById.has(t.test_vehicle_id)) };
}
