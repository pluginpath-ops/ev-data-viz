import { useState } from 'react';

/**
 * A pick-one list you narrow by typing.
 *
 * Extracted from EditSpecsForm's "Inherit from" picker so the test-link form's
 * "Source vehicle" picker filters the same way instead of being a bare
 * `<select>` over 35+ vehicles.
 *
 *   options     — [{ id, label, search? }], already in display order. `search`
 *                 is the text matched against; it defaults to the label. Every
 *                 word typed must appear in it, in any order, so "rivian lr"
 *                 finds a Rivian whose trim is "LR".
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
            const hay = (o.search ?? o.label).toLowerCase();
            return words.every(w => hay.includes(w));
        })
        : options;
    const selectedLabel = value
        ? options.find(o => String(o.id) === String(value))?.label ?? ''
        : '';

    const choose = (id) => {
        onChange(id);
        setOpen(false);
        setSearch('');
    };

    return (
        <div className="relative flex-1">
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
            ) : (
                <button
                    type="button"
                    onClick={() => { setSearch(''); setOpen(true); }}
                    className="form-input w-full text-left truncate"
                >
                    {selectedLabel || <span className="text-meta">{noneLabel}</span>}
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
