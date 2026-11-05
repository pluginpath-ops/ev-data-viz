import { parseMarkdown, isExternalHref } from '../utils/miniMarkdown';

function Inline({ nodes }) {
    return nodes.map((node, n) => {
        if (typeof node === 'string') return node;
        if (node.t === 'b') return <strong key={n}><Inline nodes={node.c} /></strong>;
        if (node.t === 'i') return <em key={n}><Inline nodes={node.c} /></em>;
        const external = isExternalHref(node.href);
        return (
            <a key={n} href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                <Inline nodes={node.c} />
            </a>
        );
    });
}

/**
 * A curator's text, drawn: basic Markdown (utils/miniMarkdown.js) as React
 * elements. Never sets HTML, so a tag typed into a field is shown as text.
 * Draws nothing for an empty text.
 */
export default function MarkdownText({ text, className = '' }) {
    const blocks = parseMarkdown(text);
    if (blocks.length === 0) return null;
    return (
        <div className={`markdown ${className}`.trim()}>
            {blocks.map((b, i) => {
                if (b.t === 'h') return <h4 key={i} className="markdown-heading"><Inline nodes={b.c} /></h4>;
                if (b.t === 'ul') {
                    return (
                        <ul key={i} className="markdown-list">
                            {b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}
                        </ul>
                    );
                }
                return (
                    <p key={i}>
                        {b.lines.map((line, j) => (
                            <span key={j}>{j > 0 && <br />}<Inline nodes={line} /></span>
                        ))}
                    </p>
                );
            })}
        </div>
    );
}
