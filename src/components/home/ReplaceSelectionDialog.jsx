import { useEffect } from 'react';

/**
 * Asks before a featured comparison replaces a selection the reader built.
 *
 * Only shown at two or more selected vehicles (featuredComparisons.
 * replacesSelection): with none or one the reader is not yet comparing
 * anything, and a confirmation would be friction for nothing. There is no
 * "back to my selection" yet — the warning is the safeguard, so it says plainly
 * what will be lost.
 */
export default function ReplaceSelectionDialog({ count, incoming, action, onConfirm, onCancel }) {
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className="modal-panel rounded-xl shadow-2xl mx-4 flex flex-col"
                style={{ maxWidth: 'min(92vw, 460px)' }}
                role="alertdialog"
                aria-labelledby="replace-selection-title"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <h3 id="replace-selection-title" className="section-title">Replace your selection?</h3>
                </div>
                <div className="modal-body">
                    <p className="text-body">
                        You have {plural(count, 'vehicle')} selected. {action === 'reset' ? 'Resetting' : 'Opening this chart'} selects this
                        comparison's {plural(incoming, 'vehicle')} instead.
                    </p>
                    <p className="text-note mt-2">Your selection is not kept.</p>
                </div>
                <div className="modal-footer">
                    <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
                    <button type="button" onClick={onConfirm} className="btn btn-primary" autoFocus>Replace my selection</button>
                </div>
            </div>
        </div>
    );
}
