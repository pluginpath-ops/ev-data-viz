/**
 * Admin → Brands, Platforms & Tags: the platform list (#318).
 *
 * Two lists, one per kind, because a vehicle links one of each and a curator
 * never means "any platform": mechanical (structure, what twins share) and
 * electrical (pack and power electronics, what shapes the charging curve). Only
 * an electrical platform carries the charging properties, so only its rows ask
 * for them.
 *
 * Aliases are the other spellings an import file may use. Each row saves on
 * its own. Deleting a platform unlinks its vehicles; it never deletes them.
 */
import { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ownValues } from '../../utils/vehicleInheritance';
import {
    PLATFORM_KINDS, PLATFORM_COLUMN, VOLTAGE_CLASSES, DC_400V_CHARGING, CHEMISTRIES, CELL_FORMATS,
} from '../../utils/platforms';

const listText = (list) => (list ?? []).join(', ');
const splitList = (text) => text.split(',').map(s => s.trim()).filter(Boolean);

const draftOf = (p, kind) => ({
    kind,
    name: p?.name ?? '',
    maker_group: p?.maker_group ?? '',
    aliases: listText(p?.aliases),
    voltage_class_v: p?.voltage_class_v != null ? String(p.voltage_class_v) : '',
    dc_400v_charging: p?.dc_400v_charging ?? '',
    chemistries: listText(p?.chemistries),
    cell_format: p?.cell_format ?? '',
});

/**
 * One platform, or the empty row that adds one. Save is always present and
 * disabled until something changes, so editing never moves a control.
 */
function PlatformRow({ platform, kind, uses, onSave, onDelete }) {
    const [draft, setDraft] = useState(() => draftOf(platform, kind));
    const [busy, setBusy] = useState(false);
    const saved = draftOf(platform, kind);
    const dirty = Object.keys(draft).some(k => draft[k] !== saved[k]);
    const set = (key) => (e) => setDraft(d => ({ ...d, [key]: e.target.value }));
    const electrical = kind === 'electrical';

    const save = async () => {
        setBusy(true);
        try {
            await onSave({
                ...(platform ? { id: platform.id } : {}),
                kind,
                name: draft.name,
                maker_group: draft.maker_group,
                aliases: splitList(draft.aliases),
                ...(electrical ? {
                    voltage_class_v: draft.voltage_class_v ? Number(draft.voltage_class_v) : null,
                    dc_400v_charging: draft.dc_400v_charging || null,
                    chemistries: splitList(draft.chemistries),
                    cell_format: draft.cell_format || null,
                } : {}),
            });
            if (!platform) setDraft(draftOf(null, kind));
        } catch {
            // The context has already said why.
        } finally {
            setBusy(false);
        }
    };

    return (
        <tr className="align-top">
            <td className="p-2">
                <input className="form-input w-full" value={draft.name} onChange={set('name')}
                    placeholder={platform ? '' : `New ${kind} platform`} aria-label="Platform name" />
            </td>
            <td className="p-2">
                <input className="form-input w-full" value={draft.maker_group} onChange={set('maker_group')}
                    list="platform-maker-options" placeholder="Hyundai Motor Group" aria-label="Maker group" />
            </td>
            <td className="p-2">
                <input className="form-input w-full" value={draft.aliases} onChange={set('aliases')}
                    placeholder="Other spellings" aria-label="Aliases" />
            </td>
            {electrical && (
                <>
                    <td className="p-2">
                        <select className="form-input" value={draft.voltage_class_v} onChange={set('voltage_class_v')} aria-label="Voltage class">
                            <option value="">—</option>
                            {VOLTAGE_CLASSES.map(v => <option key={v} value={v}>{v} V</option>)}
                        </select>
                    </td>
                    <td className="p-2">
                        <select className="form-input" value={draft.dc_400v_charging} onChange={set('dc_400v_charging')} aria-label="On a 400 V charger">
                            <option value="">Not recorded</option>
                            {DC_400V_CHARGING.map(m => <option key={m.key} value={m.key} title={m.note}>{m.label}</option>)}
                        </select>
                    </td>
                    <td className="p-2">
                        <input className="form-input w-full" value={draft.chemistries} onChange={set('chemistries')}
                            placeholder={CHEMISTRIES.slice(0, 3).join(', ')} aria-label="Chemistries" />
                    </td>
                    <td className="p-2">
                        <select className="form-input" value={draft.cell_format} onChange={set('cell_format')} aria-label="Cell format">
                            <option value="">—</option>
                            {CELL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </td>
                </>
            )}
            <td className="p-2 font-mono text-right">{platform ? uses : ''}</td>
            <td className="p-2 whitespace-nowrap">
                <button type="button" className="btn btn-secondary text-sm" disabled={!dirty || busy || !draft.name.trim()} onClick={save}>
                    {platform ? 'Save' : 'Add'}
                </button>
                {platform && (
                    <button type="button" className="btn btn-danger text-sm ml-2" disabled={busy} onClick={() => onDelete(platform, uses)}>
                        Delete
                    </button>
                )}
            </td>
        </tr>
    );
}

export default function PlatformRegistry() {
    const { platforms, platformsAvailable, vehicles, savePlatform, deletePlatform } = useAppContext();

    // Vehicles that link each platform THEMSELVES — a variant inheriting one
    // is not a link a delete would break.
    const usage = useMemo(() => {
        const n = new Map();
        for (const v of vehicles) {
            const own = ownValues(v);
            for (const col of Object.values(PLATFORM_COLUMN)) {
                if (own[col] != null) n.set(Number(own[col]), (n.get(Number(own[col])) ?? 0) + 1);
            }
        }
        return n;
    }, [vehicles]);
    const makers = useMemo(() => [...new Set(platforms.map(p => p.maker_group).filter(Boolean))].sort(), [platforms]);

    const remove = async (platform, uses) => {
        if (!window.confirm(`Delete "${platform.name}"? ${uses} vehicle${uses === 1 ? '' : 's'} will be unlinked from it.`)) return;
        try {
            await deletePlatform(platform.id);
        } catch {
            // The context has already said why.
        }
    };
    const save = async (row) => { await savePlatform(row); };

    return (
        <div className="card p-4">
            <h3 className="section-title mb-1">Platforms</h3>
            <p className="text-note mb-3">
                What a vehicle is built on. A vehicle links one mechanical platform (structure: what twins
                share) and one electrical platform (pack and power electronics: what shapes the charging
                curve). They usually match and differ exactly where a car must not be lumped in with its
                siblings. Aliases are other spellings an import file may use.
            </p>
            {!platformsAvailable && (
                <p className="text-note">The platform list is unavailable until migration 072 is applied.</p>
            )}
            {platformsAvailable && PLATFORM_KINDS.map(kind => {
                const electrical = kind.key === 'electrical';
                const rows = platforms.filter(p => p.kind === kind.key)
                    .sort((a, b) => (a.maker_group ?? '').localeCompare(b.maker_group ?? '') || a.name.localeCompare(b.name));
                return (
                    <div key={kind.key} className="mb-4">
                        <h4 className="text-nano mb-1">{kind.label}s</h4>
                        <p className="text-note mb-2">{kind.note}</p>
                        <div className="import-table-container">
                            <table className="w-full text-meta">
                                <thead>
                                    <tr className="text-left text-secondary">
                                        <th className="p-2">Name</th>
                                        <th className="p-2">Maker group</th>
                                        <th className="p-2">Aliases</th>
                                        {electrical && (
                                            <>
                                                <th className="p-2">Voltage</th>
                                                <th className="p-2">On a 400 V charger</th>
                                                <th className="p-2">Chemistries</th>
                                                <th className="p-2">Cells</th>
                                            </>
                                        )}
                                        <th className="p-2 text-right">Vehicles</th>
                                        <th className="p-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {rows.map(p => (
                                        <PlatformRow
                                            // Keyed by what was saved, so a save elsewhere resets the draft.
                                            key={`${p.id}:${p.updated_at ?? ''}`}
                                            platform={p}
                                            kind={kind.key}
                                            uses={usage.get(Number(p.id)) ?? 0}
                                            onSave={save}
                                            onDelete={remove}
                                        />
                                    ))}
                                    <PlatformRow key={`new-${kind.key}`} platform={null} kind={kind.key} onSave={save} />
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
            <datalist id="platform-maker-options">
                {makers.map(m => <option key={m} value={m} />)}
            </datalist>
        </div>
    );
}
