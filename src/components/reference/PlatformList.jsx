import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { DC_400V_CHARGING, PLATFORM_KINDS, platformListRows } from '../../utils/platforms';
import PlatformLink from './PlatformLink';

const KIND_FILTERS = [
    { key: 'all', label: 'All' },
    ...PLATFORM_KINDS.map(k => ({ key: k.key, label: k.short })),
];

/**
 * Every platform, for a reader (#354): what it is, what it provides, and how
 * many vehicles are built on it. A name opens the platform's page.
 */
export default function PlatformList() {
    const { platforms, platformsAvailable, vehicles } = useAppContext();
    const [kind, setKind] = useState('all');

    if (!platformsAvailable) {
        return <div className="empty-state"><p>Platforms are not available yet.</p></div>;
    }
    const rows = platformListRows(platforms, vehicles, kind);

    return (
        <div className="flex flex-col gap-3">
            <div className="controls-strip">
                <div className="stats-segmented" role="group" aria-label="Kind of platform">
                    {KIND_FILTERS.map(k => (
                        <button
                            key={k.key}
                            type="button"
                            className={kind === k.key ? 'active' : ''}
                            aria-pressed={kind === k.key}
                            title={PLATFORM_KINDS.find(p => p.key === k.key)?.note}
                            onClick={() => setKind(k.key)}
                        >
                            {k.label}
                        </button>
                    ))}
                </div>
                <span className="text-note">
                    A draft list, under curator review: properties are filled only where they are well established.
                </span>
            </div>
            <div className="guide-table-container">
                <table className="guide-table">
                    <thead>
                        <tr>
                            {['Platform', 'Kind', 'Maker', 'Voltage class', '400 V support', 'Chemistries', 'Vehicles'].map(h => (
                                <th key={h} className="guide-th"><span className="guide-th-name">{h}</span></th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ platform: p, vehicleCount }) => (
                            <tr key={p.id}>
                                <td className="guide-td"><PlatformLink platform={p} /></td>
                                <td className="guide-td">{PLATFORM_KINDS.find(k => k.key === p.kind)?.short ?? p.kind}</td>
                                <td className="guide-td">{p.maker_group || '—'}</td>
                                <td className="guide-td numeric">{p.voltage_class_v ? `${p.voltage_class_v} V` : '—'}</td>
                                <td className="guide-td">{DC_400V_CHARGING.find(m => m.key === p.dc_400v_charging)?.label ?? '—'}</td>
                                <td className="guide-td">{p.chemistries?.length ? p.chemistries.join(' · ') : '—'}</td>
                                <td className="guide-td numeric">{vehicleCount}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
