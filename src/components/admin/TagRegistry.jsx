import { useState, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';

/**
 * Tag maintenance (#149).
 *
 * Tags were creatable but never editable: `getTags`, `createTag` and
 * `syncVehicleTags` existed, and there was no way to rename a typo or remove a
 * tag that stopped being useful without editing SQL.
 *
 * Usage counts come from the vehicles already in context rather than a query —
 * every vehicle carries its tags for the cards, so the count is a reduce over
 * data that is present, not a round trip.
 */
export default function TagRegistry() {
    const { tags, vehicles, updateTag, deleteTag, mergeTags } = useAppContext();
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState({});
    const [mergeInto, setMergeInto] = useState({});
    const [confirmDelete, setConfirmDelete] = useState(null);

    const usage = useMemo(() => {
        const by = {};
        for (const v of vehicles ?? []) {
            for (const t of v.tags ?? []) by[t.id] = (by[t.id] ?? 0) + 1;
        }
        return by;
    }, [vehicles]);

    const run = async (fn) => {
        setBusy(true);
        try { await fn(); }
        catch { /* AppContext surfaces the message */ }
        finally { setBusy(false); }
    };

    return (
        <section>
            <div className="section-header">
                <div className="section-header-title">Tags</div>
                <div className="section-header-actions text-caption text-secondary">
                    {(tags ?? []).length} tags
                </div>
            </div>

            <div className="brand-list">
                {(tags ?? []).map(tag => {
                    const count = usage[tag.id] ?? 0;
                    const draft = editing[tag.id] ?? tag.name;
                    const target = mergeInto[tag.id] ?? '';
                    return (
                        <div key={tag.id} className="brand-row">
                            <div className="brand-row-main">
                                <input
                                    className="brand-input"
                                    value={draft}
                                    onChange={e => setEditing(s => ({ ...s, [tag.id]: e.target.value }))}
                                    aria-label="Tag name"
                                />
                                <div className="brand-counts text-caption text-secondary">
                                    {count} vehicle{count === 1 ? '' : 's'}
                                </div>
                                <div className="brand-row-actions">
                                    {draft !== tag.name && (
                                        <button className="btn btn-primary" disabled={busy || !draft.trim()}
                                            onClick={() => run(() => updateTag(tag.id, draft.trim()))}>
                                            Save
                                        </button>
                                    )}
                                    <div className="brand-merge">
                                        <select
                                            className="brand-select"
                                            value={target}
                                            aria-label={`Merge ${tag.name} into`}
                                            onChange={e => setMergeInto(s => ({ ...s, [tag.id]: e.target.value }))}
                                        >
                                            <option value="">Merge into…</option>
                                            {(tags ?? []).filter(t => t.id !== tag.id)
                                                .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                        <button className="btn btn-secondary" disabled={!target || busy}
                                            onClick={() => run(async () => {
                                                await mergeTags(tag.id, Number(target));
                                                setMergeInto(s => ({ ...s, [tag.id]: '' }));
                                            })}>
                                            Merge
                                        </button>
                                    </div>
                                    <button className="btn btn-danger" disabled={busy}
                                        onClick={() => setConfirmDelete(tag.id)}>
                                        Delete
                                    </button>
                                </div>
                            </div>

                            {confirmDelete === tag.id && (
                                <div className="brand-merge-confirm">
                                    {/* Deleting a tag in use is allowed, unlike a brand: a tag
                                        carries no other data and removing it from vehicles loses
                                        nothing but the label. The count is shown so the choice is
                                        informed rather than blocked. */}
                                    <div className="text-caption">
                                        Delete <strong>{tag.name}</strong>
                                        {count > 0 && <> and remove it from {count} vehicle{count === 1 ? '' : 's'}</>}?
                                        {count > 0 && <> Merging keeps them tagged.</>}
                                    </div>
                                    <div className="flex gap-2 mt-1">
                                        <button className="btn btn-danger" disabled={busy}
                                            onClick={() => run(async () => { await deleteTag(tag.id); setConfirmDelete(null); })}>
                                            Yes, delete
                                        </button>
                                        <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
