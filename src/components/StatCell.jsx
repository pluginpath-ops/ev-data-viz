/**
 * A measured figure with its name above it and its unit beside it.
 *
 * The design brief's third diagnosis, made into a component: this is a
 * measurement tool, but its numbers were set in the same face and weight as its
 * prose — so the labels were the loudest thing on screen and the data was the
 * quietest. Here the value is the loud part and its label is a micro-label.
 *
 * One component rather than four because vehicle cards, run bands, chart
 * legends and the EPA tables all draw this same shape. Wrap a row of them in
 * `.stat-grid` to get the hairline rules between them.
 *
 * A missing value renders a dim em dash, never an empty cell: unrecorded and
 * zero are different answers, and a blank says neither.
 */
/*
 * `basis` names where a figure came from when that changes how it reads — a
 * battery figure that is Gross, a range that is only expected. After the unit,
 * in the unit's voice: it qualifies the number, it is not a second one.
 */
export default function StatCell({ label, value, unit, title, basis }) {
    const missing = value === null || value === undefined || value === '';

    return (
        <div className="stat-cell" title={title}>
            <span className="text-micro">{label}</span>
            {missing ? (
                <span className="stat-cell-empty" aria-label="not recorded">—</span>
            ) : (
                <span className="stat-cell-value">
                    {value}
                    {unit && <span className="stat-cell-unit">{unit}</span>}
                    {basis && <span className="stat-cell-basis">{basis}</span>}
                </span>
            )}
        </div>
    );
}
