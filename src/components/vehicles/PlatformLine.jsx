/**
 * What a vehicle is built on (#318), in two sizes.
 *
 *   PlatformLine    one line for a card or a list row: "E-GMP 800 V", or
 *                   "Rivian R1 · Rivian Gen 2" where structure and electrics
 *                   have different names. Its title spells out both.
 *   PlatformFacts   both platforms in full, with the electrical one's
 *                   charging hardware, for View Specs.
 *
 * Both read the vehicle's resolved links, so a variant shows its source's
 * platforms and says so (vehicleInheritance.js).
 */
import { useAppContext } from '../../context/AppContext';
import {
    DC_400V_CHARGING, PLATFORM_KINDS, PLATFORM_COLUMN, electricalSummary, vehiclePlatforms, platformLineText,
} from '../../utils/platforms';

const describe = (label, p) => {
    if (!p) return null;
    const extra = electricalSummary(p);
    return `${label}: ${p.name}${p.maker_group ? ` (${p.maker_group})` : ''}${extra ? ` — ${extra}` : ''}`;
};

export function PlatformLine({ vehicle }) {
    const { platformsById, platformsAvailable } = useAppContext();
    if (!platformsAvailable) return null;
    const both = vehiclePlatforms(vehicle, platformsById);
    const text = platformLineText(both);
    if (!text) return null;
    const title = [describe('Mechanical', both.mechanical), describe('Electrical', both.electrical)].filter(Boolean).join('\n');
    return (
        <div className="platform-line" title={title}>
            <span className="text-micro">Platform</span>
            <span className="platform-line-value">{text}</span>
        </div>
    );
}

export function PlatformFacts({ vehicle }) {
    const { platformsById, platformsAvailable } = useAppContext();
    if (!platformsAvailable) return null;
    const both = vehiclePlatforms(vehicle, platformsById);
    if (!both.mechanical && !both.electrical) return null;
    const e = both.electrical;
    const method = DC_400V_CHARGING.find(m => m.key === e?.dc_400v_charging);
    const rows = [
        ...PLATFORM_KINDS.map(kind => {
            const p = both[kind.key];
            const from = vehicle.inheritedFrom?.[PLATFORM_COLUMN[kind.key]];
            return p && {
                label: kind.label,
                // The maker only where the name does not already say it: "E-GMP ·
                // Hyundai Motor Group", but not "Rivian R1 · Rivian".
                value: `${p.name}${p.maker_group && !p.name.toLowerCase().startsWith(p.maker_group.toLowerCase()) ? ` · ${p.maker_group}` : ''}${from ? ` (inherited from ${from.name})` : ''}`,
            };
        }),
        // What follows is the PLATFORM's, and says so: a platform provides a
        // vehicle's values, it does not stand in for them (the table resolves
        // the vehicle's own voltage class and 400 V charging, with a basis).
        e && (e.voltage_class_v || method || e.chemistries?.length > 0 || e.cell_format)
            && { heading: `${e.name} hardware` },
        e?.voltage_class_v && { label: 'Voltage class', value: `${e.voltage_class_v} V` },
        method && { label: '400 V support', value: method.label, title: method.note },
        e?.chemistries?.length > 0 && { label: 'Chemistries', value: e.chemistries.join(', ') },
        e?.cell_format && { label: 'Cells', value: e.cell_format },
    ].filter(Boolean);
    return (
        <dl className="platform-facts">
            {rows.map(r => (r.heading
                ? <div key={r.heading} className="platform-facts-heading text-nano">{r.heading}</div>
                : (
                    <div key={r.label} className="platform-fact" title={r.title}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                    </div>
                )))}
        </dl>
    );
}
