import { useState } from 'react';

/**
 * A pick-one list you narrow by typing.
 *
 * Extracted from EditSpecsForm's "Inherit from" picker so the test-link form's
 * "Source vehicle" picker filters the same way instead of being a bare
 * `<select>` over 35+ vehicles.
 *
 *   options     — [{ id, label, detail?, search? }], already in display order;
 *                 `vehicleOption` (specHelpers) builds them. `label` is the short
 *                 name the chosen chip carries; `detail` is what tells lookalikes
 *                 apart — beside the chip once chosen, under the name in the list.
 *                 `search` is the text matched against; it defaults to label and
 *                 detail. Every word typed must appear in it, in any order, so
 *                 "rivian lr" finds a Rivian whose trim is "LR".
 *   value       — the selected id as a string, '' for none
 *   onChange    — (id: string) => void; '' when "— None —" is chosen
 *   noneLabel   — text for the empty choice, closed and in the list
 */
export default function VehicleCombobox({
    options, value, onChange,
    placeholder = 'Type to filter vehicles…',
    noneLabel = '— None —',
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = words.length
        ? options.filter(o => {
            const hay = (o.search ?? `${o.label} ${o.detail ?? ''}`).toLowerCase();
            return words.every(w => hay.includes(w));
        })
        : options;
    const selected = value ? options.find(o => String(o.id) === String(value)) : null;

    const choose = (id) => {
        onChange(id);
        setOpen(false);
        setSearch('');
    };
    const reopen = () => { setSearch(''); setOpen(true); };

    return (
        <div className="relative flex-1 min-w-0">
            {open ? (
                <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    placeholder={placeholder}
                    className="form-input w-full"
                />
            ) : selected ? (
                <div className="combobox-selected">
                    <span className="combobox-chip">
                        <button
                            type="button"
                            onClick={reopen}
                            className="combobox-chip-label"
                            title="Choose a different vehicle"
                        >
                            {selected.label}
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange('')}
                            className="combobox-chip-clear"
                            aria-label={`Clear ${selected.label}`}
                            title="Clear"
                        >
                            &times;
                        </button>
                    </span>
                    {selected.detail && <span className="combobox-detail">{selected.detail}</span>}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={reopen}
                    className="form-input w-full text-left truncate"
                >
                    <span className="text-meta">{noneLabel}</span>
                </button>
            )}
            {open && (
                <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border shadow-lg bg-[var(--color-surface-input)] border-[var(--color-border)]">
                    <li
                        className="px-3 py-2 text-sm cursor-pointer text-meta hover:bg-[var(--color-surface-sunken)]"
                        onMouseDown={() => choose('')}
                    >
                        {noneLabel}
                    </li>
                    {filtered.map(o => (
                        <li
                            key={o.id}
                            className={`option-row${String(o.id) === String(value) ? ' is-selected' : ''}`}
                            onMouseDown={() => choose(String(o.id))}
                        >
                            {o.label}
                            {o.detail && <span className="option-row-detail">{o.detail}</span>}
                        </li>
                    ))}
                    {filtered.length === 0 && (
                        <li className="px-3 py-2 text-sm text-meta italic">No matches</li>
                    )}
                </ul>
            )}
        </div>
    );
}
