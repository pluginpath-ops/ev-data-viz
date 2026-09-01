import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
    CHART_HELP_FIELDS, CHART_HELP_SECTIONS, resolveChartHelp,
} from '../utils/chartHelpContent';

/**
 * ChartInfoBubble — a small, non-interactive "ℹ️ About this chart" disclosure
 * pinned near the bottom of each Charts sub-tab. Explains, in plain language,
 * what data a chart shows, why it's relevant, key terms/units, and the
 * high-level math.
 *
 * Copy is admin/contributor-editable and stored in the `chart_help` table
 * (loaded once into AppContext); it falls back to bundled defaults in
 * src/utils/chartHelpContent.js when a row is missing or in localStorage mode.
 * Contributors get an inline ✏️ edit form (the only interactivity beyond
 * show/hide). Hidden entirely in presentation/pop-out mode.
 *
 * Props:
 *   chartKey {'charging'|'range'|'compare'|'epacurves'} — which copy to show
 */
export default function ChartInfoBubble({ chartKey }) {
    const { chartHelp, isContributor, updateChartHelp } = useAppContext();
    const [open, setOpen]       = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft]     = useState(null);
    const [saving, setSaving]   = useState(false);

    const content = resolveChartHelp(chartKey, chartHelp?.[chartKey]);
    const title   = content.title || 'About this chart';

    const startEditing = () => {
        // Seed the draft from the current (resolved) copy so editors start from
        // whatever is shown, even if it's the bundled fallback.
        const seed = {};
        for (const { key } of CHART_HELP_FIELDS) seed[key] = content[key] || '';
        setDraft(seed);
        setEditing(true);
        setOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateChartHelp(chartKey, draft);
            setEditing(false);
            setDraft(null);
        } catch {
            /* error surfaced via context notification; stay in edit mode */
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="chart-info-bubble card mt-4">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="chart-info-toggle"
                    aria-expanded={open}
                >
                    <span
                        aria-hidden="true"
                        style={{ display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >▶</span>
                    <span>ℹ️ {title}</span>
                </button>
                {isContributor && open && !editing && (
                    <button
                        type="button"
                        onClick={startEditing}
                        className="btn btn-secondary ml-auto"
                        title="Edit this explanation"
                    >
                        ✏️ Edit
                    </button>
                )}
            </div>

            {open && !editing && (
                <div className="mt-3 space-y-3">
                    {CHART_HELP_SECTIONS.map(({ key, heading }) => (
                        content[key] ? (
                            <div key={key}>
                                <p className="text-label">{heading}</p>
                                <p className="text-body text-secondary whitespace-pre-line">{content[key]}</p>
                            </div>
                        ) : null
                    ))}
                </div>
            )}

            {open && editing && (
                <div className="mt-3 space-y-3">
                    {CHART_HELP_FIELDS.map(({ key, label, rows }) => (
                        <label key={key} className="block">
                            <span className="text-label">{label}</span>
                            <textarea
                                value={draft[key]}
                                onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                                rows={rows}
                                className="form-input form-input w-full mt-1"
                            />
                        </label>
                    ))}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="btn btn-primary disabled:opacity-50"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setEditing(false); setDraft(null); }}
                            disabled={saving}
                            className="btn btn-secondary"
                        >
                            Cancel
                        </button>
                        <span className="text-note ml-auto">Visible to everyone · editable by contributors</span>
                    </div>
                </div>
            )}
        </div>
    );
}
