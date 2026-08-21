import { useState, useRef, useEffect } from 'react';
import { GUIDE_COLUMNS, COLUMN_GROUPS, DEFAULT_COLUMNS } from '../../../utils/feGuideBrowse';

/**
 * Column visibility for the guide table (#235).
 *
 * The guide holds 30-odd fields per configuration and a table showing all of
 * them is unreadable, but which ten matter depends entirely on the question —
 * someone comparing label methods wants the adjustment factor and signature,
 * someone shopping wants range and MPGe. So the default is a shopping view and
 * everything else is one click away, grouped exactly as the detail view groups
 * it so the two read as one vocabulary.
 */
export default function GuideColumnPicker({ visible, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    // Close on an outside click. Pointerdown rather than click so the menu does
    // not survive a drag that starts inside it and ends outside.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [open]);

    const toggle = (key) => {
        onChange(visible.includes(key) ? visible.filter(k => k !== key) : [...visible, key]);
    };

    return (
        <div className="guide-column-picker" ref={ref}>
            <button type="button" onClick={() => setOpen(o => !o)} className="btn btn-secondary">
                Select Columns ({visible.length})
            </button>
            {open && (
                <div className="guide-column-menu">
                    <div className="guide-column-menu-head">
                        <span className="text-label">Columns</span>
                        <button type="button" className="section-action" onClick={() => onChange(DEFAULT_COLUMNS)}>
                            Reset
                        </button>
                    </div>
                    {COLUMN_GROUPS.map(group => (
                        <div key={group} className="guide-column-group">
                            <div className="text-label guide-column-group-title">{group}</div>
                            {GUIDE_COLUMNS.filter(c => c.group === group).map(col => (
                                <label key={col.key} className="guide-column-option" title={col.hint || ''}>
                                    <input
                                        type="checkbox"
                                        checked={visible.includes(col.key)}
                                        onChange={() => toggle(col.key)}
                                    />
                                    <span>{col.label}</span>
                                    {col.unit && <span className="text-faint">{col.unit}</span>}
                                </label>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
