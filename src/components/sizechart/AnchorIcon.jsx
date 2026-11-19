import { sideSilhouette } from '../../utils/silhouettes';
import { profileFromSpecs, anchorX } from '../../utils/vehicleProfile';

// One small hatchback for every icon, drawn by the same code as the chart.
const ICON_CAR = profileFromSpecs({
    dimensions: { body_style: 'Hatchback', length_in: 170, height_in: 58, wheelbase_in: 104, front_overhang_in: 33, ground_clearance_in: 6 },
    wheels: { tire_size: '225/45R18' },
});
const ICON_SHAPE = sideSilhouette(ICON_CAR);
const PAD = 8;

/**
 * An alignment option's picture: the car in outline with a line where the
 * vehicles are lined up.
 */
export default function AnchorIcon({ anchor }) {
    const x = anchorX(ICON_CAR, anchor);
    const w = ICON_CAR.length + PAD * 2;
    const h = ICON_CAR.height + PAD * 2;
    return (
        <svg className="size-anchor-icon" viewBox={`${-PAD} ${-PAD} ${w} ${h}`} aria-hidden="true">
            <g transform={`translate(0 ${ICON_CAR.height}) scale(1 -1)`}>
                <path d={ICON_SHAPE.body} vectorEffect="non-scaling-stroke" />
                {ICON_SHAPE.wheels.map(wh => <circle key={wh.x} cx={wh.x} cy={wh.r} r={wh.r} vectorEffect="non-scaling-stroke" />)}
            </g>
            <line className="size-anchor-icon-mark" x1={x} x2={x} y1={-PAD} y2={ICON_CAR.height + PAD} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
