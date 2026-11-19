import { useRef } from 'react';

const clamp = (v) => Math.min(1, Math.max(0, v));

/**
 * One mark on a size photo: a line across the frame (vertical for a bumper or
 * axle, horizontal for the ground or roof) that is dragged, or focused and
 * nudged with the arrow keys (Shift for 10 px). The pattern of
 * CardBandPreview: pointer capture, the drag held in a ref.
 *
 * Props:
 *   mark      { key, axis: 'x'|'y', label }
 *   value     where it is, a fraction of the frame
 *   frameRef  the frame the fraction is of
 *   kind      'bumper' | 'axle' | 'ground' | 'roof' (its color)
 *   onChange  (fraction) => void
 *   onPointer ({ fx, fy, w, h } | null) => void   where the pointer is (and the
 *             frame's size in px), for the loupe
 */
export default function MarkLine({ mark, value, frameRef, kind, onChange, onPointer }) {
    const dragging = useRef(false);
    const vertical = mark.axis === 'x';

    const at = (e) => {
        const r = frameRef.current.getBoundingClientRect();
        return { fx: clamp((e.clientX - r.left) / r.width), fy: clamp((e.clientY - r.top) / r.height), w: r.width, h: r.height };
    };
    const onPointerDown = (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        dragging.current = true;
        onPointer(at(e));
    };
    const onPointerMove = (e) => {
        if (!dragging.current) return;
        const p = at(e);
        onChange(vertical ? p.fx : p.fy);
        onPointer(p);
    };
    const end = () => { dragging.current = false; onPointer(null); };
    const onKeyDown = (e) => {
        const keys = vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
        if (!(e.key in keys)) return;
        e.preventDefault();
        const r = frameRef.current.getBoundingClientRect();
        const px = (e.shiftKey ? 10 : 1) * keys[e.key];
        onChange(clamp(value + px / (vertical ? r.width : r.height)));
    };

    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={mark.label}
            aria-orientation={vertical ? 'horizontal' : 'vertical'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(value * 100)}
            className={`size-mark size-mark--${kind} ${vertical ? 'is-vertical' : 'is-horizontal'}`}
            style={vertical ? { left: `${value * 100}%` } : { top: `${value * 100}%` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={onKeyDown}
            onBlur={() => onPointer(null)}
        >
            <span className="size-mark-label">{mark.label}</span>
        </div>
    );
}
