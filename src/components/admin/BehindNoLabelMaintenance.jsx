import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';

/**
 * Admin → Data checks: test vehicles behind no EPA Label (EPA identity,
 * layer 4; utils/epaBehindNoLabel.js).
 *
 * A certification's retests and unsold variants: every Guide row of their
 * certification is reproduced by other test vehicles, and they could stand
 * behind none of them, not even as one end of a blend. Applying marks them
 * with the Guide link sweep's skip — never deletes — clears any Guide link
 * they hold (one car's lab data paired with another's label), and removes
 * their vehicle links. A test vehicle a row now names loses the mark.
 *
 * Preview first, then apply. Safe to run again: a second plan is empty.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function MarkLine({ entry, name }) {
    const { test_vehicle_id, clearLinks, skip, unlink } = entry;
    const changes = [
        clearLinks.length > 0 && `clear ${plural(clearLinks.length, 'Guide link')}`,
        skip && 'skip in the Guide link sweep',
        unlink.length > 0 && `unlink from ${unlink.map(u => u.vehicle?.name ?? `vehicle ${u.vehicle?.id}`).join(', ')}`,
    ].filter(Boolean);
    return (
        <li className="data-check-finding">
            <span className="font-mono">{test_vehicle_id}</span>
            {name && <span className="text-meta"> · {name}</span>}
            <div className="text-note">{changes.join('; ')}</div>
        </li>
    );
}

export default function BehindNoLabelMaintenance() {
    const { planBehindNoLabel, applyBehindNoLabel } = useAppContext();
    const [state, setState] = useState(null);   // { plan, names }
    const [busy, setBusy] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const plan = state?.plan;
    const pending = plan ? plan.mark.length + plan.unmark.length : 0;
    const unlinking = plan ? plan.mark.reduce((n, m) => n + m.unlink.length, 0) : 0;

    async function preview() {
        setBusy('plan'); setError(null); setResult(null);
        try { setState(await planBehindNoLabel()); }
        catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }

    async function apply() {
        const also = unlinking ? ` ${plural(unlinking, 'vehicle link')} will be removed.` : '';
        if (!window.confirm(`Mark ${plural(plan.mark.length, 'test vehicle')} behind no EPA Label?${also}`)) return;
        setBusy('apply'); setError(null);
        try {
            setResult(await applyBehindNoLabel(plan));
            setState(await planBehindNoLabel());
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-note">
                Marks the test vehicles that stand behind no EPA Label: every Guide row of their certification is
                reproduced by other test vehicles, and they could not be behind any of them, even as part of a
                blend. They are skipped in the Guide link sweep and hidden from the EPA list, never deleted; their
                Guide links and vehicle links are removed.
            </p>
            <div className="flex items-center gap-2">
                <button type="button" className="btn btn-secondary text-sm" onClick={preview} disabled={busy != null}>
                    {busy === 'plan' ? 'Working out Tested via…' : plan ? 'Preview again' : 'Preview'}
                </button>
                {pending > 0 && (
                    <button type="button" className="btn btn-secondary text-sm" onClick={apply} disabled={busy != null}>
                        {busy === 'apply' ? 'Applying…' : `Apply to ${plural(pending, 'test vehicle')}`}
                    </button>
                )}
            </div>
            {plan && (
                <p className="text-note">
                    {plan.counts.none} behind no EPA Label ({plan.counts.marked} already marked, {plan.mark.length} to
                    mark), {plan.counts.behind} behind one, {plan.counts.unknown} that cannot be judged
                    {plan.unmark.length > 0 && `; ${plural(plan.unmark.length, 'mark')} to lift`}.
                </p>
            )}
            {result && (
                <p className="text-note">
                    Marked {plural(result.skipped, 'test vehicle')}, cleared {plural(result.cleared, 'Guide link')},
                    removed {plural(result.unlinked, 'vehicle link')}, lifted {plural(result.unmarked, 'mark')}
                    {result.failures.length ? `; ${result.failures.length} failed: ${result.failures.map(f => `${f.test_vehicle_id} (${f.message})`).join('; ')}` : ''}.
                </p>
            )}
            {error && <p className="note-panel is-danger">{error}</p>}
            {plan?.mark.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {plan.mark.map(m => <MarkLine key={m.test_vehicle_id} entry={m} name={state.names[m.test_vehicle_id]} />)}
                </ul>
            )}
            {plan?.unmark.length > 0 && (
                <p className="text-note text-meta">Mark lifted: {plan.unmark.join(', ')}</p>
            )}
        </div>
    );
}
