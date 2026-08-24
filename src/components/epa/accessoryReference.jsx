import { DEFAULT_ACCESSORY_W } from '../../utils/epaDerivations';

/**
 * Shared pieces of the EPA viewing-condition controls.
 *
 * Split out of EpaCurvesView so ViewingConditions can be used by both the
 * vehicle-driven curves and the certification-anchored ones without either
 * importing from the other's view.
 */

// Sane bounds for the ambient-temperature viewing condition; far outside this
// the ideal-gas density approximation isn't meaningful anyway.
export const MIN_TEMP_F = -100;
export const MAX_TEMP_F = 150;

// ── Accessory-load reference table (for the Accessory Load info tooltip) ─────

// Steady-state auxiliary draw by ambient temperature, in watts. Heat-pump and
// resistive rows are alternative heating methods for the same job, not
// simultaneous loads. Battery conditioning here is steady-state pack-temperature
// maintenance, not the much higher, short-duration draw of active DC-fast-charge
// preconditioning.
const ACCESSORY_LOAD_REFERENCE_W = [
    { ambient: '0°F',   heatPump: '2500–4000*',  resistive: '4000–6000', ac: '—',         battery: '1000–3000', lighting: '100–300' },
    { ambient: '32°F',  heatPump: '1000–1500',   resistive: '2000–3000', ac: '—',         battery: '500–1500',  lighting: '100–300' },
    { ambient: '50°F',  heatPump: '400–700',     resistive: '1000–1500', ac: '—',         battery: '0–500',     lighting: '100–300' },
    { ambient: '68°F',  heatPump: '~0',          resistive: '~0',        ac: '~0',        battery: '~0',        lighting: '100–300' },
    { ambient: '80°F',  heatPump: '—',           resistive: '—',         ac: '1000–1500',  battery: '~0',        lighting: '100–300' },
    { ambient: '90°F',  heatPump: '—',           resistive: '—',         ac: '1500–2500',  battery: '0–500',     lighting: '100–300' },
    { ambient: '105°F', heatPump: '—',           resistive: '—',         ac: '3000–5000**', battery: '1000–3000', lighting: '100–300' },
];

export function AccessoryLoadReferenceTable() {
    return (
        <div>
            <p className="font-semibold mb-1">EV Auxiliary Load Reference (steady-state, W)</p>
            <table className="accessory-load-table">
                <thead>
                    <tr>
                        <th>Ambient</th>
                        <th>Heat Pump</th>
                        <th>Resistive</th>
                        <th>A/C</th>
                        <th>Batt. Cond.</th>
                        <th>Lighting</th>
                    </tr>
                </thead>
                <tbody>
                    {ACCESSORY_LOAD_REFERENCE_W.map(row => (
                        <tr key={row.ambient}>
                            <td>{row.ambient}</td>
                            <td>{row.heatPump}</td>
                            <td>{row.resistive}</td>
                            <td>{row.ac}</td>
                            <td>{row.battery}</td>
                            <td>{row.lighting}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-1.5 text-[10px] leading-snug opacity-80">
                *At 0°F, heat pump COP approaches its floor, so most heating duty shifts to the resistive backup element. **Assumes a stabilized cabin; hot-soak or high solar load can push this higher during pull-down. Heat pump/resistive are alternative heating methods, not simultaneous loads. Battery conditioning is steady-state maintenance, not active DC-fast-charge preconditioning. Curve default is {DEFAULT_ACCESSORY_W}W.
            </p>
        </div>
    );
}
