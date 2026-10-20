/**
 * Break `text` into at most `maxLines` lines that each fit `maxWidth` in the
 * context's CURRENT font (set ctx.font first). Breaks at spaces; a word wider
 * than the line is split by character. What still does not fit after the last
 * line is cut and ends in an ellipsis, so a name is shortened only as a last
 * resort rather than at the first line.
 */
export function wrapCanvasText(ctx, text, maxWidth, maxLines = 3) {
    const fits = s => ctx.measureText(s).width <= maxWidth;
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    const push = () => { if (line) lines.push(line); line = ''; };

    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) { line = next; continue; }
        push();
        // A single over-long word: carry it across lines a character at a time.
        let rest = word;
        while (!fits(rest) && rest.length > 1) {
            let n = rest.length - 1;
            while (n > 1 && !fits(rest.slice(0, n))) n--;
            lines.push(rest.slice(0, n));
            rest = rest.slice(n);
        }
        line = rest;
    }
    push();

    if (lines.length <= maxLines) return lines;
    let last = lines.slice(maxLines - 1).join(' ');
    while (last.length > 1 && !fits(last + '…')) last = last.slice(0, -1);
    return [...lines.slice(0, maxLines - 1), last + '…'];
}
