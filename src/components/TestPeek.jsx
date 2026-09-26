/**
 * A test, restated in a peek: which one, why it stands for the vehicle, and the
 * conditions it ran under (testDetails.js TestReference).
 *
 * Shown wherever a figure rests on a test — hovering a tested cell of the
 * vehicle table, and the tested line on a vehicle card. The peek is
 * pointer-transparent, so it cannot hold the link itself. It does not say
 * where the link is either: it shows on hovering the whole cell, and "click to
 * open" would be untrue anywhere but the link — which is plain enough in link
 * colour without being pointed at.
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
        </div>
    );
}
