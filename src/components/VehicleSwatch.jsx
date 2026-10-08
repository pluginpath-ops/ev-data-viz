import SeriesColorPicker from './SeriesColorPicker';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';
import { useVehicleBase } from '../context/VehicleBaseContext';

/**
 * The control that sets a vehicle's BASE for this session — the color the whole
 * car is drawn from (#317), from wherever the car appears (#308).
 *
 * One component, two looks, because it is one control:
 *
 *   chip   a tiny swatch before the name on a selected-vehicle chip
 *   edge   the invisible hit area over a run group's accent border. The border
 *          itself stays a painted strip, which can fade across several of the
 *          vehicle's colors; this is only what makes it clickable
 *
 * Both open the series color picker WITHOUT a scope control, which is "locked to
 * This vehicle" by construction: a base belongs to the car, so there is no test
 * to choose and no other car to reach. Nothing here writes to the database. The
 * one exception is Save to vehicle, offered to whoever may edit the vehicle, and
 * it is a separate button precisely so Apply stays a session action.
 *
 * Renders nothing without a provider (the pop-out window, the playground).
 *
 * @param {{ id, name, color?, sessionBase? }} vehicle
 * @param {'chip' | 'edge'} [variant]
 */
export default function VehicleSwatch({ vehicle, variant = 'chip' }) {
    const api = useVehicleBase();
    if (!api || !vehicle) return null;

    const base = api.bases[vehicle.id] ?? null;
    // `vehicle` may already be the chart's copy (color replaced by the base), so
    // the curated color is only known when no base is in force.
    const drawn = base || vehicle.color || DEFAULT_RUN_COLOR;
    const edge = variant === 'edge';

    return (
        <SeriesColorPicker
            value={drawn}
            stored={base ? null : vehicle.color || null}
            label={vehicle.name}
            onChange={hex => api.setBase(vehicle.id, hex)}
            onReset={() => api.setBase(vehicle.id, null)}
            isAuto={!base}
            onSave={api.canSave(vehicle) ? hex => api.save(vehicle, hex) : null}
            // Click only: a hover note beside a swatch this small competes with
            // the chip's own "Drag to reorder", and over an edge it has nothing
            // to point at.
            peeks={false}
            triggerClassName={edge ? 'vehicle-edge-button' : 'vehicle-swatch'}
            bare={edge}
            className={edge ? 'vehicle-edge-anchor' : ''}
        />
    );
}
