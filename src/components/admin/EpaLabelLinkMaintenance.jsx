import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import TestedViaSummary from '../epa/TestedViaSummary';

/**
 * Admin → Data checks: EPA Label links (migration 095).
 *
 * The one-time move from vehicle → test vehicle links to vehicle → Guide row
 * links (utils/vehicleGuideLinks.js planVehicleGuideLinks). For each vehicle:
 *
 *   • it links the Guide rows its configurations' certifications point at,
 *     where that row's Tested via names the configuration;
 *   • it removes a configuration one of those rows contradicts — the row is
 *     another test vehicle's, and no row of the certification names this one
 *     (owner, 2026-10-31: "only contradicted ones");
 *   • it keeps one behind a sibling row (another wheel or trim of the
 *     certification the vehicle has no row for), and says which;
 *   • it adds a blend's other members, and makes the nearest the vehicle's
 *     primary when the old primary went;
 *   • it leaves every other configuration — unconfirmed, for a curator.
 *
 * Preview first, then apply. Safe to run again: a second plan is empty.
 * Runs in the browser as the signed-in admin, under the same RLS as any
 * other link.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function VehiclePlan({ entry }) {
    const { vehicle, plan, rows } = entry;
    const title = (rowId) => {
        const g = rows[rowId]?.guide;
        return g ? `${g.model_year} ${g.carline}` : `Guide row ${rowId}`;
    };
    return (
        <li className="data-check-finding">
            <div className="font-medium">{vehicle?.name}{vehicle?.year ? ` (${vehicle.year})` : ''}</div>
            {plan.linkRows.map(id => (
                <div key={`r${id}`} className="text-note">
                    Link {title(id)} — <TestedViaSummary via={rows[id]?.via} />
                </div>
            ))}
            {plan.drop.map(d => (
                <div key={`d${d.mappingId}`} className="text-note">
                    Remove <span className="font-mono">{d.test_vehicle_id}</span> — contradicted by {title(d.rowId)}
                </div>
            ))}
            {plan.add.map(a => (
                <div key={`a${a.test_vehicle_id}`} className="text-note">
                    Add <span className="font-mono">{a.test_vehicle_id}</span> ({a.confidence}) through {title(a.rowId)}
                </div>
            ))}
            {plan.primary && (
                <div className="text-note">Primary → <span className="font-mono">{plan.primary}</span></div>
            )}
            {plan.elsewhere.map(e => (
                <div key={`e${e.mappingId}`} className="text-note text-meta">
                    Kept <span className="font-mono">{e.test_vehicle_id}</span> — behind {title(e.rowId)}, which this vehicle does not link
                </div>
            ))}
            {plan.unconfirmed.length > 0 && (
                <div className="text-note text-meta">
                    Unconfirmed, kept: {plan.unconfirmed.map(u => u.test_vehicle_id).join(', ')}
                </div>
            )}
        </li>
    );
}

export default function EpaLabelLinkMaintenance() {
    const { planVehicleGuideLinks, applyVehicleGuideLinkPlan } = useAppContext();
    const [entries, setEntries] = useState(null);
    const [busy, setBusy] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const changing = (entries ?? []).filter(e => e.plan.linkRows.length || e.plan.drop.length || e.plan.add.length || e.plan.primary);
    const shown = (entries ?? []).filter(e => changing.includes(e) || e.plan.elsewhere.length);
    const total = (k) => changing.reduce((n, e) => n + e.plan[k].length, 0);
    const unconfirmed = (entries ?? []).reduce((n, e) => n + e.plan.unconfirmed.length, 0);
    const elsewhere = (entries ?? []).reduce((n, e) => n + e.plan.elsewhere.length, 0);

    async function preview() {
        setBusy('plan'); setError(null); setResult(null);
        try { setEntries(await planVehicleGuideLinks()); }
        catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }

    async function apply() {
        if (!window.confirm(`Apply to ${plural(changing.length, 'vehicle')}? ${plural(total('drop'), 'configuration')} will be removed.`)) return;
        setBusy('apply'); setError(null);
        try {
            setResult(await applyVehicleGuideLinkPlan(changing));
            setEntries(await planVehicleGuideLinks());
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-note">
                Links each vehicle to its EPA Label — the Guide rows its configurations point at, where the row’s
                Tested via names the configuration — and removes a configuration that no Guide row of its
                certification names. One behind another of the certification’s rows stays, as does one the rows
                say nothing about; the vehicle marks both for a curator.
            </p>
            <div className="flex items-center gap-2">
                <button type="button" className="btn btn-secondary text-sm" onClick={preview} disabled={busy != null}>
                    {busy === 'plan' ? 'Working out Tested via…' : entries ? 'Preview again' : 'Preview'}
                </button>
                {changing.length > 0 && (
                    <button type="button" className="btn btn-secondary text-sm" onClick={apply} disabled={busy != null}>
                        {busy === 'apply' ? 'Applying…' : `Apply to ${plural(changing.length, 'vehicle')}`}
                    </button>
                )}
            </div>
            {entries && (
                <p className="text-note">
                    {plural(total('linkRows'), 'Guide row')} to link, {plural(total('drop'), 'configuration')} to remove,{' '}
                    {plural(total('add'), 'configuration')} to add. Kept: {elsewhere} behind another EPA Label of
                    their certification, {unconfirmed} unconfirmed.
                </p>
            )}
            {result && (
                <p className="text-note">
                    Linked {plural(result.rows, 'Guide row')}, removed {result.dropped}, added {result.added},
                    set {plural(result.primaries, 'primary', 'primaries')}
                    {result.failures.length ? `; ${result.failures.length} failed: ${result.failures.map(f => `${f.vehicle} (${f.message})`).join('; ')}` : ''}.
                </p>
            )}
            {error && <p className="note-panel is-danger">{error}</p>}
            {shown.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {shown.map(e => <VehiclePlan key={e.vehicle?.id} entry={e} />)}
                </ul>
            )}
        </div>
    );
}
