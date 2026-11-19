import { useEffect, useMemo, useRef } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useTheme } from '../../hooks/useTheme';
import { svgToCanvas } from '../../utils/svgRaster';
import { sideSilhouette, frontSilhouette } from '../../utils/silhouettes';
import { sizeChartLayout, gridStepIn, SIZE_MARGIN, SIZE_ROW_PX } from '../../utils/sizeChartLayout';
import { fmtDimension } from '../../utils/unitConversions';
import { isEndView, trackKeyOf } from '../../utils/sizePhotoMarks';

/** Labels in the right margin, pushed apart so none overlaps the one above. */
function spreadLabels(ys, gap) {
    const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < order.length; k++) {
        if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
    }
    const out = [];
    for (const { y, i } of order) out[i] = y;
    return out;
}

/** An outline's estimated parts, dashed: the axles or the wheels drawn from a stand-in. */
const wheelsEstimated = (p) => p.estimated.has('frontOverhang') || p.estimated.has('tireDiameter');

/**
 * The Size chart's drawing: the selected vehicles to one scale, laid over each
 * other on one ground line, with a dimension line per vehicle below.
 *
 * Each vehicle is its size photo, or an outline in its series color. Either
 * way it stands on a short ground line in that color, so a photo still says
 * whose it is. The largest is drawn first so a smaller one is never hidden
 * behind it; with more than one, photos are see-through so the cars behind
 * still show. The one under the pointer (or its row in the figures table)
 * comes to the front and the rest fade further.
 *
 * Props:
 *   items       [{ id, label, color, profile, photo }] drawable in this view,
 *               selection order; `photo` (with its `placement`, in inches) or null
 *   view        'side' | 'front' | 'rear'
 *   anchor      a SIZE_ANCHORS key (side view)
 *   units       'imperial' | 'metric'
 *   lines       draw the dimension lines
 *   grid        draw the grid
 *   activeId    the vehicle brought forward, or null
 *   onActive    (id|null) => void   the vehicle under the pointer
 *   onPick      (id) => void        a click: measure the figures from this vehicle
 *   opacity     the photos' opacity when more than one is drawn (the back-most is solid)
 *   exportRef   receives `{ canvas }`, the drawing as the PNG export reads it
 */
export default function SizeChartCanvas({ items, view, anchor, units, lines, grid, activeId, onActive, onPick, opacity = 0.6, exportRef }) {
    const endView = isEndView(view);
    const [ref, widthPx] = useElementWidth();
    const svgRef = useRef(null);
    const { isDark } = useTheme();
    const layout = useMemo(
        () => sizeChartLayout(items, { view, anchor, widthPx, lines }),
        [items, view, anchor, widthPx, lines],
    );

    const shapes = useMemo(() => new Map(items.map(({ id, profile }) => [
        // The rear outline is the front's, on the rear track.
        id, endView ? frontSilhouette(view === 'rear' ? { ...profile, trackFront: profile.trackRear } : profile) : sideSilhouette(profile),
    ])), [items, view, endView]);

    // Largest first; the active one last, on top.
    const drawOrder = useMemo(() => {
        const area = ({ profile: p }) => (endView ? p.width : p.length) * p.height;
        const sorted = [...items].sort((a, b) => area(b) - area(a));
        const active = sorted.find(i => i.id === activeId);
        return active ? [...sorted.filter(i => i !== active), active] : sorted;
    }, [items, endView, activeId]);

    // The export copies a canvas, so the drawing is rasterized whenever it
    // changes; the last one to finish wins.
    useEffect(() => {
        let live = true;
        svgToCanvas(svgRef.current)
            .then(canvas => { if (live && exportRef) exportRef.current = canvas ? { canvas } : null; })
            .catch(() => { if (live && exportRef) exportRef.current = null; });
        return () => { live = false; };
    }, [layout, shapes, drawOrder, units, lines, grid, isDark, exportRef]);

    const svg = layout && (() => {
        const { scale, originX, groundY, heightPx, barsTop, places, minX, maxX } = layout;
        const px = (x) => originX + x * scale;
        const py = (y) => groundY - y * scale;
        const right = widthPx - SIZE_MARGIN.right;
        const maxH = Math.max(...items.map(i => i.profile.height));

        const step = gridStepIn(units);
        const gridXs = [];
        for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) gridXs.push(x);
        const gridYs = [];
        for (let y = step; y <= maxH; y += step) gridYs.push(y);

        const heightYs = spreadLabels(items.map(i => py(i.profile.height)), 14);

        return (
            <svg
                ref={svgRef}
                className={`size-chart-svg${items.length > 1 ? ' is-overlaid' : ''}`}
                style={{ '--size-photo-opacity': opacity }}
                width={widthPx}
                height={heightPx}
                role="img"
                aria-label={`${items.length} vehicle${items.length === 1 ? '' : 's'} drawn to scale, ${view} view`}
                onPointerLeave={() => onActive(null)}
            >
                {grid && (
                    <g className="size-grid">
                        {gridXs.map(x => <line key={`x${x}`} x1={px(x)} x2={px(x)} y1={py(maxH)} y2={groundY} />)}
                        {gridYs.map(y => <line key={`y${y}`} x1={px(minX)} x2={px(maxX)} y1={py(y)} y2={py(y)} />)}
                    </g>
                )}
                {view === 'side' && (
                    <line className="size-anchor-line" x1={px(0)} x2={px(0)} y1={SIZE_MARGIN.top - 8} y2={groundY + 6} />
                )}
                <line className="size-ground" x1={SIZE_MARGIN.left} x2={right} y1={groundY} y2={groundY} />

                {drawOrder.map(({ id, color, profile: p, photo }) => {
                    const shape = shapes.get(id);
                    const place = places.get(id);
                    const x0 = px(place);
                    const dashed = view === 'side' ? wheelsEstimated(p) : p.estimated.has(trackKeyOf(view)) || p.estimated.has('tireDiameter');
                    // The back-most photo is drawn solid: nothing behind it would show through.
                    const back = id === drawOrder[0].id && activeId !== id;
                    const cls = `size-silhouette${activeId === id ? ' is-active' : ''}${activeId && activeId !== id ? ' is-quiet' : ''}${back ? ' is-back' : ''}`;
                    if (photo) {
                        const { top, h, slices } = photo.placement;
                        const [g0, g1] = endView ? [-p.width / 2, p.width / 2] : [0, p.length];
                        const W = photo.width_px;
                        const H = photo.height_px;
                        // Each piece is a window (a nested <svg>, which clips) onto
                        // its part of the photo, stretched to its span. The group
                        // takes the opacity, so the pieces' seams don't double up.
                        return (
                            <g key={id} className={cls} style={{ '--series': color }} onPointerEnter={() => onActive(id)} onClick={() => onPick(id)}>
                                <g className="size-photo">
                                    {slices.map(s => (
                                        <svg
                                            key={s.from}
                                            x={px(place + s.x)}
                                            y={py(top)}
                                            width={s.w * scale}
                                            height={h * scale}
                                            viewBox={`${s.from * W} 0 ${(s.to - s.from) * W} ${H}`}
                                            preserveAspectRatio="none"
                                        >
                                            <image href={photo.image_url} width={W} height={H} />
                                        </svg>
                                    ))}
                                </g>
                                <line className="size-photo-ground" x1={px(place + g0)} x2={px(place + g1)} y1={groundY} y2={groundY} />
                            </g>
                        );
                    }
                    return (
                        <g
                            key={id}
                            className={cls}
                            style={{ '--series': color }}
                            transform={`translate(${x0} ${groundY}) scale(${scale} ${-scale})`}
                            onPointerEnter={() => onActive(id)}
                            onClick={() => onPick(id)}
                        >
                            {endView && shape.tires.map((t, i) => (
                                <rect key={i} className={`size-wheel${dashed ? ' is-estimated' : ''}`} x={t.x} y={0} width={t.w} height={t.h} rx={t.w * 0.25} vectorEffect="non-scaling-stroke" />
                            ))}
                            <path className="size-body" d={shape.body} vectorEffect="non-scaling-stroke" />
                            {shape.glass && <path className="size-glass" d={shape.glass} vectorEffect="non-scaling-stroke" />}
                            {view === 'side' && shape.wheels.map((w, i) => (
                                <g key={i} className={`size-wheel${dashed ? ' is-estimated' : ''}`}>
                                    <circle cx={w.x} cy={w.r} r={w.r} vectorEffect="non-scaling-stroke" />
                                    {w.rimR && <circle className="size-rim" cx={w.x} cy={w.r} r={w.rimR} vectorEffect="non-scaling-stroke" />}
                                </g>
                            ))}
                        </g>
                    );
                })}

                {lines && items.map(({ id, color, profile: p }, i) => {
                    const y = heightYs[i];
                    const roofY = py(p.height);
                    // Across the whole drawing, so each roof can be read against every car.
                    return (
                        <g key={`h${id}`} className="size-callout" style={{ '--series': color }}>
                            <line className="size-callout-lead" x1={px(minX)} x2={right + 4} y1={roofY} y2={roofY} />
                            <text x={right + 8} y={y + 4}>{fmtDimension(p.height, units)}</text>
                        </g>
                    );
                })}

                {lines && items.map(({ id, color, label, profile: p }, i) => {
                    const y = barsTop + i * SIZE_ROW_PX + SIZE_ROW_PX / 2;
                    const start = endView ? -p.width / 2 : places.get(id);
                    const end = endView ? p.width / 2 : start + p.length;
                    const mirrors = endView && p.widthMirrors > p.width ? p.widthMirrors / 2 : null;
                    const axles = view === 'side' ? [start + p.frontOverhang, start + p.frontOverhang + p.wheelbase] : [];
                    return (
                        <g key={`b${id}`} className="size-callout" style={{ '--series': color }}
                            onPointerEnter={() => onActive(id)} onClick={() => onPick(id)}>
                            <text className="size-callout-name" x={px(mirrors ? -mirrors : start)} y={y - 7}>{label}</text>
                            {mirrors && (
                                <line className="size-callout-mirrors" x1={px(-mirrors)} x2={px(mirrors)} y1={y} y2={y} />
                            )}
                            <line className="size-callout-bar" x1={px(start)} x2={px(end)} y1={y} y2={y} />
                            {[start, end].map(x => <line key={x} className="size-callout-bar" x1={px(x)} x2={px(x)} y1={y - 5} y2={y + 5} />)}
                            {axles.map(x => (
                                <circle key={x} className={`size-callout-axle${wheelsEstimated(p) ? ' is-estimated' : ''}`} cx={px(x)} cy={y} r={3.5} />
                            ))}
                            <text x={right + 8} y={y + 4}>
                                {fmtDimension(endView ? p.width : p.length, units)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    })();

    return <div ref={ref} className="size-chart-canvas">{svg}</div>;
}
