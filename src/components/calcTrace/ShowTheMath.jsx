import { useMemo, useState } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import TraceView from './TraceView';

/**
 * "Show the math" — a closed section under a chart that, opened, runs one
 * pass of the page's own calculation with a trace on and shows it
 * (utils/calcTrace.js). Closed, it builds nothing: CollapsibleSection
 * unmounts its body.
 *
 * PROTOTYPE (2026-11-08): on Range and Cost & Time › Compare.
 *
 * Props:
 *   intro      {node}   one line on what the pass is
 *   options    {Array<{ id, label }>}  what a pass can be run for (a test, a vehicle)
 *   buildTrace {(id) => { trace, summary }}  runs the page's own call with a trace;
 *                        `summary` is the figure the page shows, for checking
 */
function MathBody({ intro, options, buildTrace }) {
    const [picked, setPicked] = useState(null);
    const id = options.some(o => o.id === picked) ? picked : options[0]?.id;
    const built = useMemo(() => (id != null ? buildTrace(id) : null), [id, buildTrace]);
    if (!options.length) return <p className="text-note">Nothing on the chart to work through.</p>;
    return (
        <div className="calc-trace-body">
            <p className="text-secondary">{intro}</p>
            {options.length > 1 && (
                <label className="calc-trace-pick">
                    <span className="text-micro">Work through</span>
                    <select className="form-input w-auto" value={id} onChange={e => setPicked(options.find(o => String(o.id) === e.target.value)?.id ?? null)}>
                        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                </label>
            )}
            {built?.summary && <p className="calc-trace-summary">{built.summary}</p>}
            {built && <TraceView trace={built.trace} />}
        </div>
    );
}

export default function ShowTheMath(props) {
    return (
        <div className="card mt-4">
            <CollapsibleSection title="Show the math" subtitle="one pass, worked from the live code">
                <MathBody {...props} />
            </CollapsibleSection>
        </div>
    );
}
