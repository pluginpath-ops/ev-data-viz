import { useMemo, useState } from 'react';
import TraceView from './TraceView';

/**
 * The open body of "Show the math": a picker for what to work through, then
 * one pass of the page's own call with a trace on (utils/calcTrace.js).
 * Mounted only while the section is open.
 *
 * Props:
 *   intro      {node}   one line on what the pass is
 *   options    {Array<{ id, label }>}  what a pass can be run for (a test, a vehicle)
 *   buildTrace {(id) => { trace, summary }}  runs the page's own call with a trace;
 *                        `summary` is the figure the page shows, for checking
 *   initialId  optional first pick
 */
export default function MathPass({ intro, options, buildTrace, initialId = null }) {
    const [picked, setPicked] = useState(initialId);
    const id = options.some(o => o.id === picked) ? picked : options[0]?.id;
    const built = useMemo(() => (id != null ? buildTrace(id) : null), [id, buildTrace]);
    if (!options.length) return <p className="text-note">Nothing here to work through.</p>;
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
