/**
 * Admin → Published Results: the one list of sources (#327).
 *
 * Aliases are the other spellings a paste may use; domains let a pasted link
 * name its source; the default rollout basis applies when a block does not say.
 * Each row saves on its own, and a rename carries onto every linked result.
 */
import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ROLLOUT_BASES } from '../../utils/sources';

const listText = (list) => (list ?? []).join(', ');
const splitList = (text) => text.split(',').map(s => s.trim()).filter(Boolean);
const blankDraft = { name: '', aliases: '', domains: '', default_rollout_basis: '' };

const draftOf = (source) => (source ? {
    name: source.name ?? '',
    aliases: listText(source.aliases),
    domains: listText(source.domains),
    default_rollout_basis: source.default_rollout_basis ?? '',
} : blankDraft);

/**
 * One source, or the empty row that adds one. Save is always present and
 * disabled until something changes, so editing never moves a control.
 */
function SourceRow({ source, uses, onSave, onDelete }) {
    const [draft, setDraft] = useState(() => draftOf(source));
    const [busy, setBusy] = useState(false);
    const saved = draftOf(source);
    const dirty = Object.keys(draft).some(k => draft[k] !== saved[k]);
    const set = (key) => (e) => setDraft(d => ({ ...d, [key]: e.target.value }));

    const save = async () => {
        setBusy(true);
        try {
            await onSave({
                ...(source ? { id: source.id } : {}),
                name: draft.name,
                aliases: splitList(draft.aliases),
                domains: splitList(draft.domains),
                default_rollout_basis: draft.default_rollout_basis || null,
            });
            if (!source) setDraft(blankDraft);
        } catch {
            // The context has already said why.
        } finally {
            setBusy(false);
        }
    };

    return (
        <tr className="align-top">
            <td className="p-2">
                <input className="form-input w-full" value={draft.name} onChange={set('name')} placeholder={source ? '' : 'New source'} />
            </td>
            <td className="p-2">
                <input className="form-input w-full" value={draft.aliases} onChange={set('aliases')} placeholder="C&D, CD" />
            </td>
            <td className="p-2">
                <input className="form-input w-full" value={draft.domains} onChange={set('domains')} placeholder="caranddriver.com" />
            </td>
            <td className="p-2">
                <select className="form-input" value={draft.default_rollout_basis} onChange={set('default_rollout_basis')}>
                    <option value="">Not stated</option>
                    {ROLLOUT_BASES.map(b => <option key={b.key} value={b.key} title={b.note}>{b.label}</option>)}
                </select>
            </td>
            <td className="p-2 font-mono text-right">{source ? uses : ''}</td>
            <td className="p-2 whitespace-nowrap">
                <button type="button" className="btn btn-secondary text-sm" disabled={!dirty || busy || !draft.name.trim()} onClick={save}>
                    {source ? 'Save' : 'Add'}
                </button>
                {source && (
                    <button type="button" className="btn btn-danger text-sm ml-2" disabled={busy} onClick={() => onDelete(source)}>
                        Delete
                    </button>
                )}
            </td>
        </tr>
    );
}

export default function SourceList({ sources, available, loading, usage, onChanged }) {
    const { saveSource, deleteSource } = useAppContext();

    const save = async (row) => {
        await saveSource(row);
        onChanged();
    };
    const remove = async (source) => {
        const n = usage.get(source.id) ?? 0;
        if (!window.confirm(`Delete "${source.name}"? Its ${n} result${n === 1 ? '' : 's'} keep the name as text but are no longer linked to it.`)) return;
        try {
            await deleteSource(source.id);
            onChanged();
        } catch {
            // The context has already said why.
        }
    };

    return (
        <div className="card p-4">
            <h3 className="section-title mb-1">Sources</h3>
            <p className="text-note mb-3">
                Who published or recorded a result: a magazine, a channel, EVBench itself. Aliases are
                other spellings a paste may use; domains let a pasted link name its source; the default
                rollout basis applies when a block has no footnote saying. Renaming a source renames it
                on every linked result.
            </p>
            {!available && !loading && (
                <p className="text-note">The source list is unavailable until migration 068 is applied.</p>
            )}
            {available && (
                <div className="import-table-container">
                    <table className="w-full text-meta">
                        <thead>
                            <tr className="text-left text-secondary">
                                <th className="p-2">Name</th>
                                <th className="p-2">Aliases</th>
                                <th className="p-2">Domains</th>
                                <th className="p-2">Default rollout basis</th>
                                <th className="p-2 text-right">Results</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sources.map(s => (
                                <SourceRow
                                    // Keyed by what was saved, so a save elsewhere resets the draft.
                                    key={`${s.id}:${s.updated_at ?? ''}`}
                                    source={s}
                                    uses={usage.get(s.id) ?? 0}
                                    onSave={save}
                                    onDelete={remove}
                                />
                            ))}
                            <SourceRow key="new" source={null} onSave={save} />
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
