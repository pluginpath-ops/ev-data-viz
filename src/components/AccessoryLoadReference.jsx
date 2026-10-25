import { DEFAULT_ACCESSORY_W } from '../constants/epa';

/**
 * The accessory-load reference table: what a car draws that is not traction,
 * by ambient temperature. Shared by the correction target's Accessory Load row
 * (CorrectionTargetFields) and Modeled Efficiency's, so the two cannot show
 * different tables for the same load (#449).
 *
 * The figures are a curator's reference, not sourced: the explainer ledger
 * tags them unverified until one is.
 */

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

export default function AccessoryLoadReference() {
    return (
        <div>
            <p className="text-label">Accessory load reference (steady-state, W)</p>
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
            <p className="text-meta">
                *At 0°F, heat pump COP approaches its floor, so most heating duty shifts to the resistive backup element. **Assumes a stabilized cabin; hot-soak or high solar load can push this higher during pull-down. Heat pump/resistive are alternative heating methods, not simultaneous loads. Battery conditioning is steady-state maintenance, not active DC-fast-charge preconditioning. The EPA curves assume {DEFAULT_ACCESSORY_W} W (Admin → Model Constants); a range test is assumed to carry it plus a heater or A/C once the weather leaves about 60–70°F.
            </p>
        </div>
    );
}
