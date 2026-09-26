/**
 * A test, restated in a peek: which one, why it stands for the vehicle, and the
 * conditions it ran under (testDetails.js TestReference).
 *
 * Shown wherever a figure rests on a test — hovering a tested cell of the
 * vehicle table, and the tested line on a vehicle card. The peek is
 * pointer-transparent, so it cannot hold the link itself; the line it glosses
 * is the link, and the last line says so.
 */
export default function TestPeek({ test, figure = null }) {
    if (!test) return null;
    return (
        <div className="test-peek">
            {figure && <div className="test-peek-figure">{figure}</div>}
            <div className="test-peek-title">{test.title}</div>
            {test.reason && <div className="test-peek-reason">{test.reason}</div>}
            {test.facts.length > 0 && (
                <dl className="test-peek-facts">
                    {test.facts.map(f => (
                        <div key={f.label} className="test-peek-fact">
                            <dt>{f.label}</dt>
                            <dd>{f.value}</dd>
                        </div>
                    ))}
                </dl>
            )}
            {test.caveat && <div className="test-peek-caveat">{test.caveat}</div>}
            <div className="popover-more">
                {test.runId != null ? 'Click to open this test' : 'Click for the vehicle’s performance results'}
            </div>
        </div>
    );
}
