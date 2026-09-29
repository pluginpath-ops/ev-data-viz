/**
 * An explainer's flat file → a tree the page renders (src/explainers/CLAUDE.md).
 *
 * Content stays a flat Markdown file, reviewable as prose in a PR, with a few
 * tags for what Markdown has no word for. The subset is deliberately small:
 * what is not listed here is plain text, so an author sees a mistake on the
 * page instead of a silent reinterpretation.
 *
 *   ---                      frontmatter: `key: value`, `key: [a, b]`
 *   ## / ###                 headings
 *   - item                   list (indented lines continue the item)
 *   | a | b |                table (second row is the |---| separator)
 *   > text                   quote
 *   ::: engineers            a "For engineers" block, closed by `:::`
 *   ::: held                 draft notes: what is held back and why, closed by `:::`
 *   ::: lab <id>             an interactive lab (one line, no close)
 *   ::: figure <id>          a diagram or overlay (one line, no close)
 *   ::: tests <ids> <text>   EVBench charging tests, comma-separated run ids,
 *                            linked into Charging Curves (one line, no close).
 *                            Leading key=value words set options, e.g.
 *                            `::: tests 23,81 x=time y=chargeRate The caption.`
 *                            x/y take Charging Curves' axis keys (previewAxes.js).
 *   [^1]: text               a footnote (indented lines continue it)
 *
 * Inline: **bold**, *italic*, `code`, [text](href), [[fact:<id>]] cites the
 * facts ledger, [^1] marks a footnote. An href with no scheme and no slash is
 * a topic slug.
 */

const CONTAINERS = new Set(['engineers', 'held']);
const DIRECTIVES = new Set(['lab', 'figure', 'tests']);

export function parseExplainer(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    const meta = {};

    if (lines[0] === '---') {
        for (i = 1; i < lines.length && lines[i] !== '---'; i++) {
            const m = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
            if (!m) continue;
            const raw = m[2].trim();
            meta[m[1]] = /^\[.*\]$/.test(raw)
                ? raw.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
                : raw;
        }
        i++;
    }

    const footnotes = {};
    const root = { blocks: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1].blocks;
    const citations = [];
    const cite = (id) => { if (!citations.includes(id)) citations.push(id); };
    const inl = (text) => parseInline(text, cite);

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === '' || line.trim() === '---') { i++; continue; }

        const dir = /^:::\s*([a-z]+)(?:\s+(.*))?$/.exec(line.trim());
        if (dir) {
            const [, name, arg = ''] = dir;
            if (CONTAINERS.has(name)) {
                const block = { type: 'container', name, arg: arg.trim(), blocks: [] };
                top().push(block);
                stack.push(block);
            } else if (DIRECTIVES.has(name)) {
                const [id, ...rest] = arg.trim().split(/\s+/);
                const options = {};
                while (rest.length && /^[a-z]\w*=\S+$/i.test(rest[0])) {
                    const [k, v] = rest.shift().split('=');
                    options[k] = v;
                }
                top().push({ type: 'directive', name, id, caption: rest.join(' '),
                    ...(Object.keys(options).length && { options }) });
            } else {
                top().push({ type: 'para', inline: [line] });
            }
            i++;
            continue;
        }
        if (line.trim() === ':::') {
            if (stack.length > 1) stack.pop();
            i++;
            continue;
        }

        const heading = /^(#{2,3})\s+(.*)$/.exec(line);
        if (heading) {
            top().push({ type: 'heading', level: heading[1].length, inline: inl(heading[2]) });
            i++;
            continue;
        }

        const fn = /^\[\^(\w+)\]:\s*(.*)$/.exec(line);
        if (fn) {
            const parts = [fn[2]];
            i++;
            while (i < lines.length && /^\S/.test(lines[i]) && !isBlockStart(lines[i])) parts.push(lines[i++]);
            footnotes[fn[1]] = inl(parts.join(' '));
            continue;
        }

        if (/^\|/.test(line)) {
            const rows = [];
            while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
            const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map(c => inl(c.trim()));
            const body = rows.filter((_, n) => n !== 1 || !/^\|[\s|:-]+\|$/.test(rows[1]));
            top().push({ type: 'table', head: cells(body[0]), rows: body.slice(1).map(cells) });
            continue;
        }

        if (/^- /.test(line)) {
            const items = [];
            while (i < lines.length && /^- /.test(lines[i])) {
                const parts = [lines[i++].slice(2)];
                while (i < lines.length && /^\s{2,}\S/.test(lines[i])) parts.push(lines[i++].trim());
                items.push(inl(parts.join(' ')));
            }
            top().push({ type: 'list', items });
            continue;
        }

        if (/^>/.test(line)) {
            const parts = [];
            while (i < lines.length && /^>/.test(lines[i])) parts.push(lines[i++].replace(/^>\s?/, ''));
            top().push({ type: 'quote', inline: inl(parts.join(' ')) });
            continue;
        }

        const parts = [];
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) parts.push(lines[i++].trim());
        top().push({ type: 'para', inline: inl(parts.join(' ')) });
    }

    return { meta, blocks: root.blocks, footnotes, citations };
}

function isBlockStart(line) {
    return /^(#{2,3}\s|:::|\||- |>|\[\^\w+\]:)/.test(line.trim());
}

// Order matters: the fact marker and footnote marker contain brackets a link
// would otherwise claim, and ** must be tried before *.
const INLINE = /\[\[fact:([a-z0-9-]+)\]\]|\[\^(\w+)\]|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text, cite = () => {}) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const [, fact, fn, bold, ital, code, linkText, href] = m;
        if (fact) { cite(fact); out.push({ t: 'fact', id: fact }); }
        else if (fn) out.push({ t: 'fn', n: fn });
        else if (bold) out.push({ t: 'b', c: parseInline(bold, cite) });
        else if (ital) out.push({ t: 'i', c: parseInline(ital, cite) });
        else if (code) out.push({ t: 'code', v: code });
        else out.push({ t: 'link', href, c: parseInline(linkText, cite) });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

/** A topic slug, as opposed to a URL: no scheme, no slash, no dot. */
export const isTopicHref = (href) => /^[a-z0-9-]+$/.test(href);
