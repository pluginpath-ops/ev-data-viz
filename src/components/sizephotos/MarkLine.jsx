import { useMarkDrag } from '../../hooks/useMarkDrag';

/**
 * One mark on a size photo: a line across the frame (vertical for a bumper,
 * axle, body edge or mirror; horizontal for the ground, underbody or roof),
 * dragged or nudged with the arrow keys (useMarkDrag: Option for fine).
 *
 * Props:
 *   mark      { key, axis: 'x'|'y', label }
 *   value     where it is, a fraction of the frame
 *   frameRef  the frame the fraction is of
 *   photoPx   { w, h } the photo's own pixels, for arrow-key steps
 *   kind      'bumper' | 'axle' | 'ground' | 'roof' | 'underbody' | 'mirror' (its color)
 *   onChange  (fraction) => void
 *   onPointer ({ fx, fy, w, h } | null) => void   where the mark is, for the loupe
 */
export default function MarkLine({ mark, value, frameRef, photoPx, kind, onChange, onPointer }) {
    const vertical = mark.axis === 'x';
    const handlers = useMarkDrag({
        frameRef, photoPx, onPointer,
        value: vertical ? { x: value } : { y: value },
        onChange: (v) => onChange(vertical ? v.x : v.y),
    });
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={mark.label}
            aria-orientation={vertical ? 'horizontal' : 'vertical'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(value * 1000) / 10}
            className={`size-mark size-mark--${kind} ${vertical ? 'is-vertical' : 'is-horizontal'}`}
            style={vertical ? { left: `${value * 100}%` } : { top: `${value * 100}%` }}
            {...handlers}
        >
            <span className="size-mark-label">{mark.label}</span>
        </div>
    );
}
