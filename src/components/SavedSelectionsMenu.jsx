import { useState } from 'react';
import Popover from './Popover';
import { useAppContext } from '../context/AppContext';
import {
    cleanName, findByName, matchSavedSelection, resolvableIds, SAVED_SELECTION_NAME_MAX,
} from '../utils/savedSelections';

/**
 * The chips row's label, and the menu it opens: the reader's saved
 * selections, and saving the chips as one (utils/savedSelections.js).
 *
 * The label and the menu are one button because both answer "what are these
 * chips?". It reads "Selected ▾", or "☆ Trucks ▾" when the chips are exactly
 * a saved selection. Changed since, "modified" wraps onto a second line rather
 * than widening it: two lines fit inside the chips' two rows. It sits first,
 * not with Clear and ＋ Add: those two stack once the chips wrap, and a third
 * would make the stack taller than the two-row chip cap, growing the header.
 *
 * Top of the panel, by what the chips are:
 *   exactly a saved one     nothing to save; its row carries the ✓
 *   modified from one       Update "name", or Save as new…
 *   anything else           Save selection…
 *   empty                   nothing to save
 * Save opens a name field in place. A name already used asks once more, then
 * replaces that one's vehicles.
 *
 * Below, every saved selection: click to load it (the panel closes; Undo puts
 * the chips back), ✎ to rename in place, × to delete (Undo saves it again).
 * Signed out, a footer says they live in this browser.
 *
 * @param {object}   store      useSavedSelections(), held by App so the list and
 *                              the last loaded one outlive the chips row hiding
 * @param {number[]} selection  the selected vehicle ids
 * @param {Array}    vehicles   the vehicles the reader can see
 * @param {Function} onSelect   (vehicleIds) => void — replaces the selection
 * @param {Function} [onSignIn]
 */
export default function SavedSelectionsMenu({ store, selection, vehicles, onSelect, onSignIn }) {
    const { showUndoable, showError } = useAppContext();
    const { saved, where, loadedId, setLoadedId } = store;
    const { current, modifiedFrom } = matchSavedSelection(selection, saved, loadedId);

    const onLoad = (s) => {
        const before = { selection, loadedId };
        const ids = resolvableIds(s.vehicleIds, vehicles);
        onSelect(ids);
        setLoadedId(s.id);
        const skipped = s.vehicleIds.length - ids.length;
        showUndoable(
            `Selected "${s.name}"${skipped ? ` — ${skipped} vehicle${skipped === 1 ? ' is' : 's are'} no longer listed` : ''}.`,
            'Undo',
            () => { onSelect(before.selection); setLoadedId(before.loadedId); },
        );
    };
    const onSave = async (name) => {
        setLoadedId(await store.add({ name, vehicleIds: selection }));
    };
    const onReplace = async (s) => {
        await store.update(s.id, selection);
        setLoadedId(s.id);
    };
    const onRename = (s, name) => store.rename(s.id, name);
    const onDelete = async (s) => {
        try {
            await store.remove(s.id);
            showUndoable(`Deleted "${s.name}".`, 'Undo', async () => {
                try { await store.add({ name: s.name, vehicleIds: s.vehicleIds }); }
                catch (err) { showError(err.message); }
            });
        } catch (err) {
            showError(err.message);
        }
    };

    // null, or { mode: 'new' } / { mode: 'rename', id } while a name field is open.
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState('');
    const [problem, setProblem] = useState('');
    // The existing selection a save would replace, once the reader has been told.
    const [confirmReplace, setConfirmReplace] = useState(null);

    const startEditing = (next, name = '') => {
        setEditing(next);
        setDraft(name);
        setProblem('');
        setConfirmReplace(null);
    };
    const stopEditing = () => startEditing(null);

    const submit = async () => {
        const name = cleanName(draft);
        if (!name) { setProblem('Enter a name.'); return; }
        const clash = findByName(saved, name);
        try {
            if (editing.mode === 'rename') {
                if (clash && clash.id !== editing.id) { setProblem(`You already have "${clash.name}".`); return; }
                await onRename(saved.find(s => s.id === editing.id), name);
            } else if (clash) {
                if (confirmReplace?.id !== clash.id) {
                    setConfirmReplace(clash);
                    setProblem(`You already have "${clash.name}". Save again to replace its vehicles.`);
                    return;
                }
                await onReplace(clash);
            } else {
                await onSave(name);
            }
            stopEditing();
        } catch (err) {
            setProblem(err.message);
        }
    };

    const nameField = (
        <form
            className="flex flex-col gap-1"
            onSubmit={e => { e.preventDefault(); submit(); }}
        >
            <div className="flex items-center gap-2">
                <input
                    // Opened after the panel is placed, so autoFocus works here;
                    // Popover's data-autofocus only runs as the panel opens.
                    autoFocus
                    type="text"
                    value={draft}
                    maxLength={SAVED_SELECTION_NAME_MAX}
                    onChange={e => { setDraft(e.target.value); setProblem(''); setConfirmReplace(null); }}
                    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); stopEditing(); } }}
                    placeholder="Mid-size SUVs"
                    aria-label="Name"
                    className="form-input flex-1 min-w-0"
                />
                <button type="submit" className="btn btn-primary">
                    {confirmReplace ? 'Replace' : 'Save'}
                </button>
            </div>
            {problem && <p className="saved-selections-problem" role="alert">{problem}</p>}
        </form>
    );

    const hasSelection = selection.length > 0;

    return (
        <Popover
            title="Saved selections"
            width="20rem"
            className="saved-selections"
            onOpenChange={open => { if (!open) stopEditing(); }}
            trigger={(props) => (
                <button
                    {...props}
                    type="button"
                    className="btn btn-secondary saved-selections-trigger"
                    title={current ? `Selected: your saved "${current.name}"`
                        : modifiedFrom ? `Selected: changed since you loaded "${modifiedFrom.name}"`
                            : 'Selected vehicles — save them, or bring back a saved selection'}
                >
                    {current || modifiedFrom ? (
                        <>
                            <span className="btn-symbol" aria-hidden="true">☆</span>
                            <span className="saved-selections-trigger-text">
                                <span className="truncate">{(current ?? modifiedFrom).name}</span>
                                {modifiedFrom && <span className="saved-selections-modified">modified</span>}
                            </span>
                        </>
                    ) : 'Selected'}
                    <span className="disclosure-caret saved-selections-caret" aria-hidden="true">▾</span>
                </button>
            )}
        >
            {({ close }) => (
                <div className="flex flex-col gap-2">
                    {editing?.mode === 'new' ? nameField : hasSelection && !current && (
                        <div className="saved-selections-actions">
                            {modifiedFrom && (
                                <button
                                    type="button"
                                    className="saved-selections-row option-row"
                                    onClick={() => onReplace(modifiedFrom).catch(err => showError(err.message))}
                                    title={`Give "${modifiedFrom.name}" the vehicles now selected`}
                                >
                                    <span className="saved-selections-mark" aria-hidden="true">↻</span>
                                    <span className="truncate">Update "{modifiedFrom.name}"</span>
                                </button>
                            )}
                            <button
                                type="button"
                                className="saved-selections-row option-row"
                                onClick={() => startEditing({ mode: 'new' })}
                            >
                                <span className="saved-selections-mark" aria-hidden="true">＋</span>
                                <span>{modifiedFrom ? 'Save as new…' : 'Save selection…'}</span>
                                <span className="saved-selections-count">{selection.length}</span>
                            </button>
                        </div>
                    )}

                    {saved.length > 0 ? (
                        <ul className="saved-selections-list" aria-label="Saved selections">
                            {saved.map(s => (
                                <li key={s.id}>
                                    {editing?.mode === 'rename' && editing.id === s.id ? nameField : (
                                        <div className={`saved-selections-item${current?.id === s.id ? ' is-current' : ''}`}>
                                            <button
                                                type="button"
                                                className="saved-selections-row option-row"
                                                onClick={() => { onLoad(s); close(); }}
                                                title={current?.id === s.id ? 'Selected now' : `Select these ${s.vehicleIds.length} vehicles`}
                                            >
                                                <span className="saved-selections-mark" aria-hidden="true">{current?.id === s.id ? '✓' : ''}</span>
                                                <span className="truncate">{s.name}</span>
                                                <span className="saved-selections-count">{s.vehicleIds.length}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="saved-selections-tool"
                                                onClick={() => startEditing({ mode: 'rename', id: s.id }, s.name)}
                                                title="Rename"
                                                aria-label={`Rename ${s.name}`}
                                            >
                                                ✎
                                            </button>
                                            <button
                                                type="button"
                                                className="saved-selections-tool btn-icon-danger"
                                                onClick={() => onDelete(s)}
                                                title="Delete"
                                                aria-label={`Delete ${s.name}`}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-meta">
                            {hasSelection
                                ? 'Save the vehicles you keep coming back to, and bring them back in one click.'
                                : 'Select some vehicles, then save them here to bring them back in one click.'}
                        </p>
                    )}

                    {where === 'browser' && (
                        <p className="saved-selections-note text-meta">
                            Kept in this browser.
                            {onSignIn && (
                                <> <button type="button" className="saved-selections-sign-in" onClick={() => { close(); onSignIn(); }}>Sign in</button> to keep them on every device.</>
                            )}
                        </p>
                    )}
                </div>
            )}
        </Popover>
    );
}
