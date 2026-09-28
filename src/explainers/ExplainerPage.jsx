import { Fragment } from 'react';
import ExplainerLink from './ExplainerLink';
import { isTopicHref } from './parseExplainer';
import { FACTS } from './topics';
import SplitPackLab from './labs/SplitPackLab';
import ExplainerToc from './ExplainerToc';
import { chargingTestsHref } from './evbenchLinks';
import ChargingPreview from './ChargingPreview';
import { useChargingTests } from '../hooks/useChargingTests';

/**
 * One explainer, rendered from its parsed flat file (parseExplainer.js).
 *
 * Citations are numbered in order of first use and listed under Sources with
 * their rank, title, link and access date. In a draft, a citation of an
 * unverified fact is marked on the spot, so the gap is visible where it is.
 * A widely accepted fact (no source cited, by decision) is marked more
 * quietly, on any page: it is a disclosure, not a gap.
 */
const LABS = { 'split-pack': SplitPackLab };

/**
 * The two ways a fact may publish without a published source, each said
 * plainly: the field agrees on it, or EVBench has seen it first-hand.
 */
const UNSOURCED_TAG = {
    accepted: 'widely accepted · no source cited',
    observed: 'observed by EVBench · no published record',
};

const RANK_NAMES = {
    A: 'Manufacturer primary',
    B: 'Independent measurement',
    C: 'Standards and physics',
    D: 'Secondary press',
};

/**
 * `afterNotes` goes between the notes and the sources: where the section puts
 * "Where this fits", so the next thing to read comes before the references.
 */
export default function ExplainerPage({ topic, afterNotes = null }) {
    const { doc, isDraft, unverified } = topic;
    const citeNo = new Map(doc.citations.map((id, n) => [id, n + 1]));
    const ctx = { citeNo, isDraft };
    const flagged = doc.citations.filter(id => UNSOURCED_TAG[FACTS.get(id)?.status]).length;
    const headingIds = sectionIds(doc.blocks);
    ctx.headingIds = headingIds;
    const hasNotes = Object.keys(doc.footnotes).length > 0;
    const tocItems = [
        ...doc.blocks.filter(b => b.type === 'heading').map(b => ({ id: headingIds.get(b), text: inlineText(b.inline), level: b.level })),
        hasNotes && { id: 'explainer-notes', text: 'Notes', level: 2 },
        afterNotes && { id: 'explainer-fits', text: 'Where this fits', level: 2 },
        doc.citations.length > 0 && { id: 'explainer-sources', text: 'Sources', level: 2 },
    ].filter(Boolean);

    return (
        <div className="explainer-layout">
            <article className="explainer">
                {isDraft && (
                    <p className="explainer-draft-note">
                        A draft, written in public.{' '}
                        {unverified.length > 0
                            ? `${unverified.length} cited fact${unverified.length === 1 ? ' is' : 's are'} still waiting on a primary source, marked where ${unverified.length === 1 ? 'it is' : 'they are'} cited.`
                            : flagged > 0
                                ? `Nothing it cites is waiting on a source; ${flagged} ${flagged === 1 ? 'figure is' : 'figures are'} flagged as widely accepted or observed by EVBench.`
                                : 'Every figure it cites is sourced.'}
                    </p>
                )}
                <h2 className="page-title">{topic.title}</h2>
                <Blocks blocks={doc.blocks} ctx={ctx} />

                {hasNotes && (
                    <section className="explainer-notes" aria-labelledby="explainer-notes">
                        <h3 id="explainer-notes" className="text-micro">Notes</h3>
                        <ol>
                            {Object.entries(doc.footnotes).map(([n, inline]) => (
                                <li key={n} id={`fn-${n}`}><Inline nodes={inline} ctx={ctx} /></li>
                            ))}
                        </ol>
                    </section>
                )}

                {afterNotes}

                {doc.citations.length > 0 && (
                    <section className="explainer-sources" aria-labelledby="explainer-sources">
                        <h3 id="explainer-sources" className="text-micro">Sources</h3>
                        <ol>
                            {doc.citations.map(id => <SourceItem key={id} id={id} />)}
                        </ol>
                    </section>
                )}
            </article>
            <ExplainerToc items={tocItems} />
        </div>
    );
}

function SourceItem({ id }) {
    const fact = FACTS.get(id);
    if (!fact) return <li id={`src-${id}`} className="is-unverified">Unknown fact: {id}</li>;
    return (
        <li id={`src-${id}`} className={`is-${fact.status}`}>
            <span className="explainer-source-claim">{fact.claim}</span>
            {fact.status === 'unverified' && <span className="explainer-unverified-tag">unverified</span>}
            {UNSOURCED_TAG[fact.status] && (
                <span className="explainer-source">
                    <span className="explainer-accepted-tag">{UNSOURCED_TAG[fact.status]}</span>
                    <span className="text-note">{fact.rationale}</span>
                </span>
            )}
            {fact.sources.map((s, n) => (
                <span key={n} className="explainer-source">
                    <span className="explainer-rank" title={RANK_NAMES[s.rank]}>{s.rank}</span>
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                    <span className="text-meta"> · accessed {s.accessed}</span>
                </span>
            ))}
        </li>
    );
}

/** Plain text of inline nodes, for the contents list and heading ids. */
function inlineText(nodes) {
    return nodes.map(n => (typeof n === 'string' ? n : n.c ? inlineText(n.c) : n.v ?? '')).join('').trim();
}

/** A stable, unique id for each top-level heading, from its text. */
function sectionIds(blocks) {
    const ids = new Map();
    const used = new Set();
    for (const b of blocks.filter(b => b.type === 'heading')) {
        const base = 'sec-' + (inlineText(b.inline).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section');
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        ids.set(b, id);
    }
    return ids;
}

function Blocks({ blocks, ctx }) {
    return blocks.map((b, n) => <Block key={n} block={b} ctx={ctx} />);
}

function Block({ block, ctx }) {
    switch (block.type) {
        case 'heading': {
            const H = block.level === 2 ? 'h3' : 'h4';
            return <H id={ctx.headingIds?.get(block)}
                className={block.level === 2 ? 'section-title explainer-heading' : 'subsection-title explainer-subheading'}>
                <Inline nodes={block.inline} ctx={ctx} />
            </H>;
        }
        case 'para':
            return <p className="explainer-para"><Inline nodes={block.inline} ctx={ctx} /></p>;
        case 'list':
            return <ul className="explainer-list">
                {block.items.map((item, n) => <li key={n}><Inline nodes={item} ctx={ctx} /></li>)}
            </ul>;
        case 'quote':
            return <blockquote className="explainer-quote"><Inline nodes={block.inline} ctx={ctx} /></blockquote>;
        case 'table':
            return (
                <div className="explainer-table-wrap">
                    <table className="explainer-table">
                        <thead><tr>{block.head.map((c, n) => <th key={n}><Inline nodes={c} ctx={ctx} /></th>)}</tr></thead>
                        <tbody>
                            {block.rows.map((r, n) => (
                                <tr key={n}>{r.map((c, m) => <td key={m}><Inline nodes={c} ctx={ctx} /></td>)}</tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case 'container':
            if (block.name === 'engineers') {
                return (
                    <details className="explainer-engineers">
                        <summary>For engineers</summary>
                        <Blocks blocks={block.blocks} ctx={ctx} />
                    </details>
                );
            }
            if (block.name === 'held') {
                // Editorial notes (what is held back and why, records to fix):
                // for whoever writes the page, not for its readers.
                if (!import.meta.env.DEV) return null;
                return (
                    <aside className="explainer-held">
                        <h3 className="text-micro">Held back: not on the published page</h3>
                        <Blocks blocks={block.blocks} ctx={ctx} />
                    </aside>
                );
            }
            return null;
        case 'directive': {
            if (block.name === 'tests') {
                return <TestsCard runIds={block.id.split(',').filter(Boolean).map(Number)} caption={block.caption}
                    axes={block.options ?? {}} />;
            }
            const Lab = block.name === 'lab' ? LABS[block.id] : null;
            if (Lab) return <Lab />;
            return (
                <figure className="explainer-placeholder">
                    <span className="text-micro">{block.name} · {block.id}</span>
                    {block.caption && <figcaption className="text-note">{block.caption}</figcaption>}
                </figure>
            );
        }
        default:
            return null;
    }
}

/**
 * Real data behind a claim: EVBench charging tests, previewed, and opened in
 * Charging Curves by a link built from the same data (runs, their vehicles,
 * the axes).
 */
function TestsCard({ runIds, caption, axes }) {
    const tests = useChargingTests(runIds);
    const href = chargingTestsHref({
        runIds,
        vehicleIds: (tests.data ?? []).map(t => t.vehicleId),
        ...(axes.x && { x: axes.x }),
        ...(axes.y && { y: axes.y }),
    });
    return (
        <figure className="explainer-tests">
            <span className="explainer-tests-badge">EVBench data</span>
            {caption && <figcaption className="explainer-para">{caption}</figcaption>}
            <ChargingPreview tests={tests} />
            <a className="explainer-link explainer-tests-link" href={href}>
                Open {runIds.length === 1 ? 'the charging test' : `the ${runIds.length} charging tests`} in Charging Curves →
            </a>
        </figure>
    );
}

function Inline({ nodes, ctx }) {
    return nodes.map((node, n) => {
        if (typeof node === 'string') return <Fragment key={n}>{node}</Fragment>;
        switch (node.t) {
            case 'b': return <strong key={n}><Inline nodes={node.c} ctx={ctx} /></strong>;
            case 'i': return <em key={n}><Inline nodes={node.c} ctx={ctx} /></em>;
            case 'code': return <code key={n} className="explainer-code">{node.v}</code>;
            case 'fn': return <sup key={n} className="explainer-fn"><a href={`#fn-${node.n}`} onClick={jumpTo}>{node.n}</a></sup>;
            case 'fact': return <Citation key={n} id={node.id} ctx={ctx} />;
            case 'link':
                return isTopicHref(node.href)
                    ? <ExplainerLink key={n} topic={node.href}><Inline nodes={node.c} ctx={ctx} /></ExplainerLink>
                    : <a key={n} href={node.href} target="_blank" rel="noopener noreferrer"><Inline nodes={node.c} ctx={ctx} /></a>;
            default: return null;
        }
    });
}

/**
 * Scroll to a note or source in place. A hash change would reach App's
 * popstate handler as a history entry with no state.
 */
function jumpTo(e) {
    e.preventDefault();
    document.getElementById(e.currentTarget.getAttribute('href').slice(1))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function Citation({ id, ctx }) {
    const fact = FACTS.get(id);
    const status = fact?.status ?? 'unverified';
    const suffix = status === 'verified' ? '' : ` (${UNSOURCED_TAG[status] ?? 'unverified'})`;
    return (
        <sup className={`explainer-cite is-${status === 'observed' ? 'accepted' : status}`}>
            <a href={`#src-${id}`} onClick={jumpTo} title={fact ? `${fact.claim}${suffix}` : `Unknown fact ${id}`}>
                {ctx.citeNo.get(id)}
            </a>
        </sup>
    );
}
