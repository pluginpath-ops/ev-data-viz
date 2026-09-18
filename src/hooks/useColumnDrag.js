import { useRef, useState } from 'react';
import { moveColumn } from '../utils/tableColumns';

/**
 * Drag-to-reorder over a table's ordered column list — one mechanism behind
 * both handles on that list: the rows of the column picker and the table's own
 * column headers.
 *
 * Which half of the target the pointer is over decides the side, so a column
 * can land on either side of any other and the drop marks that edge before the
 * reader lets go. `axis` is 'x' for headers (left half = before) and 'y' for
 * the picker's list (top half = before).
 *
 * The dragged key lives in a REF, with state only for the styling. Read from
 * state, the drop handler saw the closure the target was last rendered with —
 * between a dragstart and a drop React has not re-rendered between, still null,
 * and the drop did nothing. It also means a drag that started anywhere else
 * (selected text, a file, the other handle) is not a drop this list accepts.
 *
 * With no `onChange` nothing is draggable, so a read-only table passes nothing.
 */
export default function useColumnDrag({ visible, fixedKey, onChange, axis = 'x' }) {
    const dragKeyRef = useRef(null);
    const [dragKey, setDragKey] = useState(null);
    const [over, setOver] = useState(null);   // { key, side }

    const sideOf = (e, key) => {
        const r = e.currentTarget.getBoundingClientRect();
        const before = axis === 'x'
            ? e.clientX < r.left + r.width / 2
            : e.clientY < r.top + r.height / 2;
        // Nothing goes in front of the fixed column, so its whole width means "after".
        return before && key !== fixedKey ? 'before' : 'after';
    };

    const end = () => {
        dragKeyRef.current = null;
        setDragKey(null);
        setOver(null);
    };

    const dragProps = (key) => {
        if (!onChange) return {};
        const fixed = key === fixedKey;
        return {
            draggable: !fixed,
            onDragStart: fixed ? undefined : (e) => {
                dragKeyRef.current = key;
                setDragKey(key);
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox starts no drag without a payload.
                    e.dataTransfer.setData('text/plain', key);
                }
            },
            onDragEnd: end,
            onDragOver: (e) => {
                if (!dragKeyRef.current) return;
                e.preventDefault();
                const side = sideOf(e, key);
                setOver(prev => (prev?.key === key && prev.side === side ? prev : { key, side }));
            },
            onDragLeave: (e) => {
                if (e.currentTarget.contains(e.relatedTarget)) return;
                setOver(prev => (prev?.key === key ? null : prev));
            },
            onDrop: (e) => {
                const from = dragKeyRef.current;
                if (!from) return;
                e.preventDefault();
                const next = moveColumn(visible, from, key, sideOf(e, key), fixedKey);
                if (next !== visible) onChange(next);
                end();
            },
        };
    };

    /** `dragging` on the column in hand, `drop-before`/`drop-after` on the one it would land beside. */
    const dragClass = (key) => {
        if (dragKey === key) return 'dragging';
        if (over?.key === key && dragKey) return `drop-${over.side}`;
        return '';
    };

    return { dragProps, dragClass };
}
