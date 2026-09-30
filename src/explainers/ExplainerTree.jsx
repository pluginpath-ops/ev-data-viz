import ExplainerLink from './ExplainerLink';

/**
 * A hub's topics as a nested list (outline.js), used on the landing page and
 * as "Where this fits" under a topic. A topic a reader can open is a link,
 * and one not written yet (or a draft on the site) is shown as planned, so
 * the shape of the whole subject is visible before it is all written.
 */
export default function ExplainerTree({ nodes, readable, current = null }) {
    return (
        <ul className="explainer-tree">
            {nodes.map(node => (
                <li key={node.slug}>
                    <TreeRow node={node} topic={readable.get(node.slug)} current={current} />
                    {node.children?.length > 0 && (
                        <ExplainerTree nodes={node.children} readable={readable} current={current} />
                    )}
                </li>
            ))}
        </ul>
    );
}

function TreeRow({ node, topic, current }) {
    const isCurrent = node.slug === current;
    return (
        <div className={`explainer-tree-row${topic ? '' : ' is-planned'}${isCurrent ? ' is-current' : ''}`}
            aria-current={isCurrent ? 'page' : undefined}>
            <span className="explainer-tree-title">
                {topic && !isCurrent
                    ? <ExplainerLink topic={node.slug}>{topic.title}</ExplainerLink>
                    : <span>{topic?.title ?? node.title}</span>}
                {!topic && <span className="explainer-tag">Planned</span>}
                {topic?.isDraft && <span className="explainer-tag is-draft">Draft</span>}
                {topic?.hasLab && <span className="explainer-tag is-lab">Interactive</span>}
            </span>
            {node.blurb && <span className="explainer-tree-blurb">{node.blurb}</span>}
        </div>
    );
}

/** A small drawing for each hub: a charging curve, a block of cells, or a drive-cycle trace. */
export function HubGlyph({ glyph }) {
    if (glyph === 'cycle') {
        return (
            <svg className="explainer-hub-glyph" viewBox="0 0 64 40" aria-hidden="true">
                <path className="explainer-hub-glyph-axis" d="M6 4 V34 H60" />
                <path className="explainer-hub-glyph-line"
                    d="M8 33 L11 22 L14 22 L16 33 L19 33 L22 16 L26 14 L29 33 L32 33 L35 10 L42 8 L47 12 L50 33 L58 33" />
            </svg>
        );
    }
    if (glyph === 'curve') {
        return (
            <svg className="explainer-hub-glyph" viewBox="0 0 64 40" aria-hidden="true">
                <path className="explainer-hub-glyph-axis" d="M6 4 V34 H60" />
                <path className="explainer-hub-glyph-line" d="M8 30 C12 10, 16 8, 24 9 S36 14, 44 22 S54 30, 58 31" />
            </svg>
        );
    }
    return (
        <svg className="explainer-hub-glyph" viewBox="0 0 64 40" aria-hidden="true">
            {[0, 1, 2, 3, 4].map(col => [0, 1, 2].map(row => (
                <rect key={`${col}-${row}`} className="explainer-hub-glyph-cell"
                    x={6 + col * 11} y={4 + row * 11} width="9" height="9" rx="2" />
            )))}
        </svg>
    );
}
