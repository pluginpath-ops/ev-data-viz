/**
 * An OpenDocument spreadsheet's content.xml, as plain grids.
 *
 *   odsSheets(xml) → { [sheetName]: rows }   rows[r][c] = { text, value } | undefined
 *
 * `text` is what the cell shows; `value` is the full-precision number behind it
 * (office:value), or null. Green NCAP rounds its display to one decimal, so a
 * figure is read from `value` wherever there is one.
 *
 * No DOM and no zip: the caller unzips (Node's zlib in the scripts, a
 * DecompressionStream if this ever runs in the browser) and passes the XML in.
 * Regex, not a parser, because the files are machine-written and flat — every
 * cell is <table:table-cell …>…</table:table-cell> or self-closing.
 */

// LibreOffice pads a sheet with "1,048,000 empty columns/rows". Expanding those
// would allocate gigabytes, so a repeat only advances the index unless the
// repeated cell or row carries content, and then it expands to at most this.
const MAX_EXPAND = 256;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
});

const attr = (tag, name) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? decode(m[1]) : null;
};

function cellText(inner) {
    if (!inner) return '';
    const paras = [...inner.matchAll(/<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g)].map(m => m[1] ?? '');
    return paras.map(p => decode(
        p.replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(n ? +n : 1))
         .replace(/<text:(?:tab|line-break)\s*\/>/g, ' ')
         .replace(/<[^>]+>/g, ''),
    )).join(' ').replace(/\s+/g, ' ').trim();
}

function parseRow(rowXml) {
    const cells = [];
    let c = 0;
    const re = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
    for (const m of rowXml.matchAll(re)) {
        const rep = Number(attr(m[1], 'table:number-columns-repeated') ?? 1);
        const text = cellText(m[2]);
        const raw = attr(m[1], 'office:value');
        const value = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
        if (text || value != null) {
            const cell = { text, value };
            for (let i = 0; i < Math.min(rep, MAX_EXPAND); i++) cells[c + i] = cell;
        }
        c += rep;
    }
    return cells;
}

export function odsSheets(xml) {
    const out = {};
    const tableRe = /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g;
    for (const t of xml.matchAll(tableRe)) {
        const name = attr(t[1], 'table:name');
        const rows = [];
        let r = 0;
        const rowRe = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
        for (const m of t[2].matchAll(rowRe)) {
            const rep = Number(attr(m[1], 'table:number-rows-repeated') ?? 1);
            const cells = m[2] ? parseRow(m[2]) : [];
            if (cells.length) for (let i = 0; i < Math.min(rep, MAX_EXPAND); i++) rows[r + i] = cells;
            r += rep;
        }
        out[name] = rows;
    }
    return out;
}
