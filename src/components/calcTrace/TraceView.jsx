import { substitute, traceNumber } from '../../utils/calcTrace';
import { constantLayer } from '../../constants/overrides';
import { KNOB_KEYS } from '../../constants/knobs';

/**
 * A calculation trace (utils/calcTrace.js) as readable steps: each line of
 * math as written, then with its values in place, then its result; where each
 * value came from; assumptions marked. Nested chains (a function the pass
 * called) are disclosures, open at the top level. Below, every model constant
 * the pass touched, with its value and its layer.
 */

const SOURCE_TEXT = { setting: 'your setting', data: 'data', assumed: 'assumed' };

/** Where a value came from, as a badge. */
function SourceBadge({ src }) {
    if (!src) return null;
    const m = /^(knob|code):(.+)$/.exec(src);
    if (m?.[1] === 'knob') return <span className="badge-micro" title={m[2]}>knob · {constantLayer(m[2])}</span>;
    if (m?.[1] === 'code') return <span className="badge-micro" title={m[2]}>fixed</span>;
    const cls = src === 'assumed' ? 'badge-micro is-qualified' : src === 'setting' ? 'badge-micro is-accent' : 'badge-micro';
    return <span className={cls}>{SOURCE_TEXT[src] ?? src}</span>;
}

function Step({ step }) {
    const filled = substitute(step.formula, step.values, traceNumber);
    return (
        <li className="calc-trace-step">
            <div className="calc-trace-step-head">
                <span className="calc-trace-label">{step.label}</span>
                {step.assumed && <span className="badge-micro is-qualified">assumption</span>}
                {step.result != null && (
                    <span className="calc-trace-result">= {traceNumber(step.result)}{step.unit ? ` ${step.unit}` : ''}</span>
                )}
            </div>
            {step.formula && <div className="calc-trace-formula">{step.formula}</div>}
            {filled && filled !== step.formula && <div className="calc-trace-formula is-filled">{filled}</div>}
            {step.values.length > 0 && (
                <ul className="calc-trace-values">
                    {step.values.map(v => (
                        <li key={v.name}>
                            <span className="calc-trace-name">{v.name}</span> = {traceNumber(v.v)}{v.unit ? ` ${v.unit}` : ''}
                            {' '}<SourceBadge src={v.src} />
                        </li>
                    ))}
                </ul>
            )}
            {step.note && <div className="text-note">{step.note}</div>}
        </li>
    );
}

function Group({ group, depth }) {
    const body = (
        <ol className="calc-trace-list">
            {group.children.map((c, i) => (
                c.type === 'step' ? <Step key={i} step={c} />
                    : c.type === 'note' ? (
                        <li key={i} className="calc-trace-note">
                            {c.assumed && <span className="badge-micro is-qualified">assumption</span>} {c.text}
                        </li>
                    )
                        : <li key={i}><Group group={c} depth={depth + 1} /></li>
            ))}
        </ol>
    );
    if (depth === 0) return body;
    return (
        <details className="calc-trace-group" open={depth === 1}>
            <summary className="calc-trace-group-title">{group.label}</summary>
            {body}
        </details>
    );
}

/** Every constant the pass touched: its value, unit and layer. */
function ConstantsTable({ constants }) {
    const rows = [...constants.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    if (!rows.length) return null;
    return (
        <table className="calc-trace-constants">
            <thead>
                <tr><th>Constant</th><th>Value</th><th>Where it is set</th></tr>
            </thead>
            <tbody>
                {rows.map(c => (
                    <tr key={c.key}>
                        <td className="calc-trace-name">{c.key}</td>
                        <td>{traceNumber(c.value)}{c.unit ? ` ${c.unit}` : ''}</td>
                        <td>
                            {c.kind === 'knob' && KNOB_KEYS.includes(c.key)
                                ? `Admin knob · ${constantLayer(c.key)}`
                                : 'fixed in code'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function TraceView({ trace }) {
    return (
        <div className="calc-trace">
            <Group group={trace.node} depth={0} />
            {trace.constants.size > 0 && (
                <>
                    <h4 className="subsection-title mt-4">Constants used</h4>
                    <ConstantsTable constants={trace.constants} />
                </>
            )}
        </div>
    );
}
