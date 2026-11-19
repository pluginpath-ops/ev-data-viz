import { useRef } from 'react';

const clamp = (v) => Math.min(1, Math.max(0, v));

/** How much slower a mark moves while Option (Alt) is held. */
const FINE_DRAG = 8;

/** Arrow-key steps, in photo pixels: plain, Shift, Option (Alt). */
const STEP_PX = { plain: 1, shift: 10, fine: 0.25 };

/**
 * Dragging and nudging a size photo mark (sizephotos/MarkLine, MarkPoint).
 * Marks are fractions of the photo, so they hold sub-pixel positions; this is
 * how a curator puts them there.
 *
 * - A drag moves the mark by how far the pointer moves, not to where it is, so
 *   grabbing a mark never makes it jump. Option (Alt) held slows it 8×.
 * - Arrow keys move it in PHOTO pixels (not screen pixels): 1, Shift 10,
 *   Option ¼.
 * - `onPointer` gets where the mark is, for the loupe. It stays up while the
 *   mark has focus (after a click, or Tab), marked `fine` so the loupe zooms
 *   to photo pixels and a ¼-pixel nudge shows; blur takes it down.
 *
 * @param {object} o
 * @param {{ current: Element }} o.frameRef  the frame the fractions are of
 * @param {{ x?: number, y?: number }} o.value  the mark: x, y or both
 * @param {{ w: number, h: number }} o.photoPx  the photo's size in its own pixels
 * @param {(next: { x?: number, y?: number }) => void} o.onChange
 * @param {({ fx, fy, w, h, axis, fine } | null) => void} o.onPointer
 */
export function useMarkDrag({ frameRef, value, photoPx, onChange, onPointer }) {
    const drag = useRef(null);
    // Where along a line the loupe sits: the pointer's last place, kept for keys.
    const along = useRef({ fx: 0.5, fy: 0.5 });
    const hasX = value.x != null;
    const hasY = value.y != null;
    const axis = hasX && hasY ? 'xy' : hasX ? 'x' : 'y';

    const rect = () => frameRef.current.getBoundingClientRect();
    const show = (v, r, e, fine) => {
        if (e) along.current = { fx: clamp((e.clientX - r.left) / r.width), fy: clamp((e.clientY - r.top) / r.height) };
        onPointer({ fx: v.x ?? along.current.fx, fy: v.y ?? along.current.fy, w: r.width, h: r.height, axis, fine });
    };

    const onPointerDown = (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        drag.current = { x0: e.clientX, y0: e.clientY, start: value };
        show(value, rect(), e, false);
    };
    const onPointerMove = (e) => {
        const d = drag.current;
        if (!d) return;
        const r = rect();
        const slow = e.altKey ? FINE_DRAG : 1;
        const next = {};
        if (hasX) next.x = clamp(d.start.x + (e.clientX - d.x0) / r.width / slow);
        if (hasY) next.y = clamp(d.start.y + (e.clientY - d.y0) / r.height / slow);
        // A change of speed mid-drag restarts from here, so the mark doesn't jump.
        if (d.slow !== slow) drag.current = { x0: e.clientX, y0: e.clientY, start: next, slow };
        onChange(next);
        show(next, r, e, false);
    };
    // Let go: the mark keeps focus, so the loupe stays for the arrow keys.
    const end = () => { drag.current = null; show(value, rect(), null, true); };
    const onKeyDown = (e) => {
        const dir = {
            ArrowLeft: hasX && ['x', -1], ArrowRight: hasX && ['x', 1],
            ArrowUp: hasY && ['y', -1], ArrowDown: hasY && ['y', 1],
        }[e.key];
        if (!dir) return;
        e.preventDefault();
        const step = e.altKey ? STEP_PX.fine : e.shiftKey ? STEP_PX.shift : STEP_PX.plain;
        const [axis, sign] = dir;
        const px = axis === 'x' ? photoPx.w : photoPx.h;
        const next = { ...value, [axis]: clamp(value[axis] + (sign * step) / px) };
        onChange(next);
        show(next, rect(), null, true);
    };

    return {
        onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onKeyDown,
        onFocus: () => { if (!drag.current) show(value, rect(), null, true); },
        onBlur: () => onPointer(null),
    };
}
