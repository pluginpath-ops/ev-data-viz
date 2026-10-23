/**
 * Basic Markdown for the text a curator writes on Home (#448): a featured
 * comparison's blurb and a chart's caption.
 *
 * Not the explainers' parser (src/explainers/parseExplainer.js). That one is
 * built for long articles — fact citations, footnotes, topic links, tables,
 * directives — and lives behind a lint boundary that keeps the rest of EVBench
 * from importing it. A blurb needs a different, smaller thing, so this is its
 * own. The inline syntax matches, so an author moves between the two without
 * relearning: **bold**, *italic*, [text](url).
 *
 * What is supported, and so everything that is not:
 *
 *   # Heading             any level; drawn at one modest size (see .markdown-heading)
 *   - item  /  * item     a bullet list
 *   **bold**  *italic*  _italic_
 *   [text](url)           a link
 *   https://example.com   a bare address becomes a link
 *
 * Line breaks follow what a text box and a chat do, not strict Markdown: a
 * single Enter is a line break, a blank line starts a new paragraph (owner,
 * 2026-10-24). No tables, images, code blocks, numbered lists, or HTML — a tag
 * typed in is shown as the text it is.
 *
 * It returns a plain tree and never builds HTML, so there is nothing to
 * sanitize: the component draws React elements from it. Links are the one
 * place text becomes something a reader can act on, so `safeHref` allows only
 * http, https, mailto and in-site addresses.
 *
 * Pure module — no React.
 *
 * Blocks:  { t: 'p', lines: [inline[]] } | { t: 'h', c: inline[] } | { t: 'ul', items: [inline[]] }
 * Inline:  string | { t: 'b'|'i', c: inline[] } | { t: 'a', href, c: inline[] }
 */

/**
 * The address a link may point at, or null.
 *
 * Allowed: http, https, mailto, and addresses inside the site — a path, or a
 * query like `?tab=efficiency&m=range`. Anything else (javascript:, data:, a
 * bare word) is not a link and is shown as the text it was written as.
 */
export function safeHref(href) {
    const h = String(href ?? '').trim();
    if (/^(https?:\/\/|mailto:)[^\s]+$/i.test(h)) return h;
    if (/^[/?#][^\s]*$/.test(h) && !h.startsWith('//')) return h;
    return null;
}

/** Whether a link leaves the site, so it can open in a new tab. */
export const isExternalHref = (href) => /^(https?:\/\/|mailto:)/i.test(href);

// Longest-first alternation, scanned left to right. A [text](url) is matched
// before the bare address inside it; an underscore only opens italics at a word
// edge, so snake_case and addresses with underscores are left alone.
const PARTS = [
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`,            // 1 text, 2 href
    String.raw`\*\*(.+?)\*\*`,                           // 3 bold
    String.raw`\*(?!\s)(.+?)\*`,                         // 4 italic
    String.raw`(?<![A-Za-z0-9_])_(?!\s)(.+?)_(?![A-Za-z0-9_])`, // 5 italic
    String.raw`(https?:\/\/[^\s<]+)`,                    // 6 bare address
];
const INLINE = new RegExp(PARTS.join('|'), 'g');
// Inside a link's own text nothing is a link: a link in a link is not one, and
// the address a link was written with would otherwise be linked twice. The
// groups keep their numbers by matching what can never occur.
const INLINE_IN_LINK = new RegExp(['(?!)(\\b)(\\b)', ...PARTS.slice(1, 4), '(?!)(\\b)'].join('|'), 'g');

// Punctuation that ends a sentence rather than an address, and a closing
// bracket only when the address did not open one ("(see https://x.org)").
function trimBareAddress(url) {
    let end = url.length;
    while (end > 0) {
        const c = url[end - 1];
        if ('.,;:!?\'"'.includes(c)) { end--; continue; }
        if (c === ')' && (url.slice(0, end).match(/\(/g) || []).length < (url.slice(0, end).match(/\)/g) || []).length) { end--; continue; }
        break;
    }
    return end;
}

export function parseInline(text, inLink = false) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(inLink ? INLINE_IN_LINK : INLINE)) {
        const [whole, linkText, href, bold, ital, ital2, bare] = m;
        if (m.index < last) continue;   // inside something already taken
        if (m.index > last) out.push(text.slice(last, m.index));
        let consumed = whole.length;
        if (linkText !== undefined) {
            const safe = safeHref(href);
            if (safe) out.push({ t: 'a', href: safe, c: parseInline(linkText, true) });
            else out.push(whole);       // not a link we allow: show what was written
        } else if (bold !== undefined) {
            out.push({ t: 'b', c: parseInline(bold, inLink) });
        } else if (ital !== undefined || ital2 !== undefined) {
            out.push({ t: 'i', c: parseInline(ital ?? ital2, inLink) });
        } else {
            const end = trimBareAddress(bare);
            consumed = end;
            out.push({ t: 'a', href: bare.slice(0, end), c: [bare.slice(0, end)] });
        }
        last = m.index + consumed;
    }
    if (last < text.length) out.push(text.slice(last));
    // Text left as written can come out in pieces; one string reads and tests better.
    return out.reduce((acc, node) => {
        if (typeof node === 'string' && typeof acc[acc.length - 1] === 'string') acc[acc.length - 1] += node;
        else acc.push(node);
        return acc;
    }, []);
}

/** The blocks of a text. An empty or blank text has none. */
export function parseMarkdown(source) {
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let para = null;
    let list = null;
    const flush = () => { para = null; list = null; };

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line.trim() === '') { flush(); continue; }

        const heading = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
        if (heading) {
            flush();
            blocks.push({ t: 'h', c: parseInline(heading[1].replace(/\s+#+\s*$/, '')) });
            continue;
        }

        const bullet = /^\s{0,3}[-*]\s+(.*\S)\s*$/.exec(line);
        if (bullet) {
            para = null;
            if (!list) { list = { t: 'ul', items: [] }; blocks.push(list); }
            list.items.push(parseInline(bullet[1]));
            continue;
        }

        list = null;
        if (!para) { para = { t: 'p', lines: [] }; blocks.push(para); }
        para.lines.push(parseInline(line.trim()));
    }
    return blocks;
}
