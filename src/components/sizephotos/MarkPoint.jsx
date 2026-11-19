import { useMarkDrag } from '../../hooks/useMarkDrag';

/**
 * An axle as a point on a size photo: the wheel's center, across and up. It
 * moves the axle's x (the same value its vertical line shows) and its height
 * together; arrow keys move it either way (useMarkDrag: Option for fine).
 *
 * Props:
 *   label     e.g. 'Front axle'
 *   x, y      where it is, fractions of the frame
 *   frameRef  the frame the fractions are of
 *   photoPx   { w, h } the photo's own pixels, for arrow-key steps
 *   onChange  ({ x, y }) => void
 *   onPointer ({ fx, fy, w, h } | null) => void   where it is, for the loupe
 */
export default function MarkPoint({ label, x, y, frameRef, photoPx, onChange, onPointer }) {
    const handlers = useMarkDrag({ frameRef, photoPx, onPointer, value: { x, y }, onChange });
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={`${label} center (arrow keys move it)`}
            className="size-mark-point"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            {...handlers}
        />
    );
}
