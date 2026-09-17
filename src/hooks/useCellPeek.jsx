import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from './useAnchoredPosition';
import { isClipped } from '../components/tables/TableCell';

/**
 * The peek that restates a clipped cell, one per table (#315).
 *
 * It is the info icon's peek — the same `.popover--peek` panel, placed by the
 * same `useAnchoredPosition` — so it themes with every other gloss on the site
 * and appears the moment the pointer arrives, which the browser's own `title`
 * tooltip will not do (it waits about a second, and cannot be styled).
 *
 * ONE for the table rather than a `Popover` per cell. A vehicle table with a
 * dozen columns is well over a thousand cells, and a Popover is several hooks
 * and listeners each; hover is a single question — which cell is under the
 * pointer — so it is answered once, by delegation from the table.
 *
 * Cells say what they would restate through `data-restate` (TableCell writes
 * it). Whether they are clipped is measured when the pointer arrives, because
 * column widths change with the picker, the window and the font. A cell with
 * `data-peek="always"` skips the measurement: it has something to say either way.
 *
 * Returns the handlers to spread on the table and the panel to render.
 */
export function useCellPeek() {
    const [peek, setPeek] = useState(null);   // { serial, text } | null
    const hide = useCallback(() => setPeek(null), []);

    const { anchorRef, measureRef, style } = useAnchoredPosition(
        peek ? `cell-${peek.serial}` : null,
        peek ? hide : undefined,
    );

    const onPointerOver = useCallback((e) => {
        const cell = e.target.closest?.('td[data-restate]');
        if (cell === anchorRef.current && peek) return;
        // A cell that asks to always peek (a flagged value) does, clipped or not.
        if (!cell || (cell.dataset.peek !== 'always' && !isClipped(cell))) {
            anchorRef.current = null;
            setPeek(null);
            return;
        }
        anchorRef.current = cell;
        // A serial, not the text: two cells can restate the same words, and
        // moving between them must still re-place the panel.
        setPeek(prev => ({ serial: (prev?.serial ?? 0) + 1, text: cell.dataset.restate }));
    }, [anchorRef, peek]);

    const panel = peek && createPortal(
        <div
            // A new node per cell, so it re-measures: the placement hook
            // measures once, when the panel attaches.
            key={peek.serial}
            ref={measureRef}
            role="tooltip"
            className="popover popover--anchored popover--peek popover--fit"
            style={style}
        >
            {peek.text}
        </div>,
        document.body,
    );

    return { tableProps: { onPointerOver, onPointerLeave: hide }, panel };
}
