import './explainers.css';
import ExplainerLink from './ExplainerLink';
import ExplainerPage from './ExplainerPage';
import ExplainerTree, { HubGlyph } from './ExplainerTree';
import { OUTLINE, outlineNode, hubOf } from './outline';
import { topicBySlug, visibleTopics } from './topics';

/**
 * Reference › Explainers: the landing page (every hub and the topics under
 * it), or one topic. The other thing EVBench may import from src/explainers
 * (eslint.config.js): the mount point.
 *
 * Drafts are readable on the site, tagged (topics.js): explainers are written
 * in public.
 */
export default function ExplainersSection({ topic = null, onBack }) {
    const topics = visibleTopics();
    const readable = new Map(topics.map(t => [t.slug, t]));

    if (topic) {
        const current = readable.get(topic);
        return (
            <div className="explainer-shell">
                <TopicCrumb slug={topic} readable={readable} onBack={onBack} />
                {current ? (
                    <ExplainerPage topic={current} afterNotes={<WhereThisFits slug={topic} readable={readable} />} />
                ) : (
                    <div className="empty-state">
                        <p>{topicBySlug(topic) || outlineNode(topic) ? 'That explainer is not published yet.' : 'There is no explainer by that name.'}</p>
                    </div>
                )}
            </div>
        );
    }

    if (topics.length === 0) {
        return (
            <div className="explainer-shell">
                <h2 className="page-title mb-6">Explainers</h2>
                <div className="empty-state"><p>Explainers are coming soon: how things work, with diagrams.</p></div>
            </div>
        );
    }

    return (
        <div className="explainer-landing">
            <header className="explainer-landing-head">
                <h2 className="page-title">Explainers</h2>
                <p className="explainer-lede">
                    How EVs charge, and how their packs are built. Each page starts with the short version and opens
                    into the engineering, and every figure links to its source.
                </p>
            </header>
            <div className="explainer-hubs">
                {OUTLINE.map(hub => (
                    <section key={hub.slug} className={`explainer-hub is-${hub.glyph}`} aria-labelledby={`hub-${hub.slug}`}>
                        <div className="explainer-hub-head">
                            <HubGlyph glyph={hub.glyph} />
                            <div>
                                <h3 id={`hub-${hub.slug}`} className="section-title">{hub.title}</h3>
                                <p className="explainer-hub-blurb">{hub.blurb}</p>
                            </div>
                        </div>
                        <ExplainerTree nodes={hub.children} readable={readable} />
                    </section>
                ))}
            </div>
        </div>
    );
}

/** Explainers / the hub / … / this topic. A step is a link when its page can be read. */
function TopicCrumb({ slug, readable, onBack }) {
    const node = outlineNode(slug);
    const steps = node ? [...node.path, node] : [];
    return (
        <nav aria-label="Breadcrumb" className="page-crumb mb-1">
            <a href="?tab=reference&sub=explainers" onClick={e => { e.preventDefault(); onBack?.(); }}>Explainers</a>
            {steps.map((step, n) => {
                const isLast = n === steps.length - 1;
                const title = readable.get(step.slug)?.title ?? step.title;
                return (
                    <span key={step.slug}>
                        <span aria-hidden="true"> / </span>
                        {isLast ? <span aria-current="page">{title}</span>
                            : readable.has(step.slug) ? <ExplainerLink topic={step.slug} className="">{title}</ExplainerLink>
                            : <span>{title}</span>}
                    </span>
                );
            })}
        </nav>
    );
}

/** The topic's hub as a tree, with this page marked: what to read around it. */
function WhereThisFits({ slug, readable }) {
    const hub = hubOf(slug);
    if (!hub) return null;
    return (
        <aside className={`explainer-fits is-${hub.glyph}`} aria-labelledby="explainer-fits">
            <div className="explainer-hub-head">
                <HubGlyph glyph={hub.glyph} />
                <div>
                    <h3 id="explainer-fits" className="text-micro">Where this fits</h3>
                    <p className="subsection-title">{hub.title}</p>
                </div>
            </div>
            <ExplainerTree nodes={hub.children} readable={readable} current={slug} />
        </aside>
    );
}
