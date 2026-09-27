/**
 * Which spec chart is showing, above the plot: a bar of one column, or a
 * scatter of two (#338).
 *
 * The two were separate sub-tabs, Spec Chart and Spec Scatter. Under Vehicles
 * & Specs they are one item, "Chart", because both draw the table's columns
 * and differ only in how many. Each keeps its own chart mode (`specs`,
 * `specscatter`), so links, pop-outs and help bubbles are unchanged; this
 * switch moves between them.
 */
const KINDS = [
    { mode: 'specs',       label: 'Bar',     title: 'One column across the selected vehicles' },
    { mode: 'specscatter', label: 'Scatter', title: 'Two columns against each other' },
];

export default function SpecChartKind({ mode, onChange }) {
    return (
        <div className="controls-strip">
            <div className="stats-segmented" role="group" aria-label="Chart kind">
                {KINDS.map(k => (
                    <button
                        key={k.mode}
                        type="button"
                        className={mode === k.mode ? 'active' : ''}
                        aria-pressed={mode === k.mode}
                        title={k.title}
                        onClick={() => onChange(k.mode)}
                    >
                        {k.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
