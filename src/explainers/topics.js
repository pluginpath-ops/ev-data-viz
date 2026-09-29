import { parseExplainer } from './parseExplainer';
import ledger from './facts.json';

/**
 * Every explainer, read from content/*.md at build time. A file is a topic;
 * its slug is the file name. Nothing else registers a page.
 *
 * Explainers are written in public (owner's call, 2026-09-28): a topic whose
 * frontmatter status starts with DRAFT is readable on the site, tagged Draft,
 * with any unverified citation marked where it sits. What a draft may not do
 * is lose the tag while it cites an unverified fact; explainers.test.js holds
 * that.
 */
const files = import.meta.glob('./content/*.md', { query: '?raw', import: 'default', eager: true });

export const FACTS = new Map(ledger.facts.map(f => [f.id, f]));

export const TOPICS = Object.entries(files)
    .map(([path, source]) => {
        const slug = path.replace(/^.*\/|\.md$/g, '');
        const doc = parseExplainer(source);
        const unverified = doc.citations.filter(id => (FACTS.get(id)?.status ?? 'unverified') === 'unverified');
        return {
            slug,
            title: doc.meta.title ?? slug,
            isDraft: /^DRAFT/i.test(doc.meta.status ?? ''),
            unverified,
            hasLab: hasDirective(doc.blocks, 'lab'),
            doc,
        };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

function hasDirective(blocks, name) {
    return blocks.some(b => (b.type === 'directive' && b.name === name)
        || (b.type === 'container' && hasDirective(b.blocks, name)));
}

export const topicBySlug = (slug) => TOPICS.find(t => t.slug === slug) ?? null;

/** The topics a reader may open: every written one, drafts included. */
export const visibleTopics = () => TOPICS;
