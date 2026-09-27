import { useAppContext } from '../../context/AppContext';
import { DC_400V_CHARGING, PLATFORM_KINDS, vehiclesOnPlatform } from '../../utils/platforms';
import { vehicleLabel } from '../../utils/specHelpers';

/**
 * One platform, for a reader (#354): what it is, what it provides its
 * vehicles, its notes, and the vehicles built on it — which can be selected
 * to compare in one click. Where "from <platform>" beneath a value leads.
 *
 * What it provides is shown as the PLATFORM's (platforms.js
 * PLATFORM_PROVIDES): a platform provides a vehicle's values and never stands
 * in for them, and a vehicle that sets its own keeps it.
 */
export default function PlatformPage({ platformId, onBack, onOpenExplainers }) {
    const { platformsById, vehicles, selectedVehicles, toggleVehicleSelection, setVehicleSelection } = useAppContext();
    const platform = platformsById.get(Number(platformId));

    if (!platform) {
        return (
            <div>
                <PlatformCrumb onBack={onBack} />
                <div className="empty-state"><p>That platform could not be found.</p></div>
            </div>
        );
    }

    const kind = PLATFORM_KINDS.find(k => k.key === platform.kind);
    const method = DC_400V_CHARGING.find(m => m.key === platform.dc_400v_charging);
    const onIt = vehiclesOnPlatform(platform, vehicles);
    const allSelected = onIt.length > 0 && onIt.every(v => selectedVehicles.includes(v.id));
    const facts = [
        { label: 'Kind', value: kind?.label ?? platform.kind, title: kind?.note },
        platform.maker_group && { label: 'Maker', value: platform.maker_group },
        platform.voltage_class_v && { label: 'Voltage class', value: `${platform.voltage_class_v} V` },
        method && { label: '400 V support', value: method.label, title: method.note },
        platform.chemistries?.length > 0 && { label: 'Chemistries', value: platform.chemistries.join(' · '),
            title: 'The chemistries its packs come in. A vehicle has one of them; this is not any one vehicle’s.' },
        platform.cell_format && { label: 'Cells', value: platform.cell_format },
        platform.aliases?.length > 0 && { label: 'Also called', value: platform.aliases.join(', ') },
    ].filter(Boolean);

    return (
        <div>
            <PlatformCrumb onBack={onBack} current={kind?.label} />
            <h2 className="page-title mb-4">{platform.name}</h2>
            <div className="platform-page-grid">
                <section className="card platform-page-card" aria-labelledby="platform-provides">
                    <h3 id="platform-provides" className="text-micro">What it is and provides</h3>
                    <dl className="platform-facts">
                        {facts.map(f => (
                            <div key={f.label} className="platform-fact" title={f.title}>
                                <dt>{f.label}</dt>
                                <dd>{f.value}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="text-note">
                        {platform.kind === 'electrical'
                            ? 'Its 400 V support is provided to each vehicle on it unless the vehicle sets its own, and is shown there as “from ' + platform.name + '”.'
                            : 'A mechanical platform provides no spec values: vehicles on one structure still differ in every dimension recorded.'}
                    </p>
                    {method && onOpenExplainers && (
                        <button type="button" className="platform-page-more" onClick={onOpenExplainers}>
                            How 400 V support works →
                        </button>
                    )}
                </section>

                <section className="card platform-page-card" aria-labelledby="platform-notes">
                    <h3 id="platform-notes" className="text-micro">Notes</h3>
                    <p className="platform-page-notes">{platform.notes || 'No notes yet.'}</p>
                </section>

                <section className="card platform-page-card" aria-labelledby="platform-vehicles">
                    <div className="flex items-center justify-between gap-2">
                        <h3 id="platform-vehicles" className="text-micro">
                            {onIt.length} {onIt.length === 1 ? 'vehicle' : 'vehicles'} on it
                        </h3>
                        {onIt.length > 0 && (
                            <button
                                type="button"
                                className="btn btn-primary text-sm"
                                disabled={allSelected}
                                onClick={() => setVehicleSelection([...new Set([...selectedVehicles, ...onIt.map(v => v.id)])])}
                            >
                                {allSelected ? 'All selected' : 'Select all to compare'}
                            </button>
                        )}
                    </div>
                    {onIt.length === 0
                        ? <p className="text-note">No vehicle links to it yet.</p>
                        : (
                            <ul className="platform-page-vehicles">
                                {onIt.map(v => (
                                    <li key={v.id}>
                                        <label className="platform-page-vehicle">
                                            <input
                                                type="checkbox"
                                                checked={selectedVehicles.includes(v.id)}
                                                onChange={() => toggleVehicleSelection(v.id)}
                                            />
                                            <span>{vehicleLabel(v)}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                </section>
            </div>
        </div>
    );
}

function PlatformCrumb({ onBack, current }) {
    return (
        <nav aria-label="Breadcrumb" className="page-crumb mb-1">
            <a href="?tab=reference" onClick={e => { e.preventDefault(); onBack?.(); }}>Platforms</a>
            {current && <><span aria-hidden="true"> / </span><span aria-current="page">{current}</span></>}
        </nav>
    );
}
