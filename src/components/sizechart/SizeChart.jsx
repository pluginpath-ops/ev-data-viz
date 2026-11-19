import { useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { resolveChartColors, DEFAULT_SERIES_PALETTE } from '../../utils/colorUtils';
import { resolveEffectiveSpecs } from '../../utils/specHelpers';
import { buildVehicleLabels } from '../../utils/seriesLabel';
import { profileFromSpecs } from '../../utils/vehicleProfile';
import { gridStepIn } from '../../utils/sizeChartLayout';
import {
    SIZE_ANCHORS, SIZE_VIEWS, SIZE_DRAWS, DEFAULT_SIZE_ANCHOR, DEFAULT_SIZE_VIEW, DEFAULT_SIZE_DRAW,
    SIZE_PHOTO_CHART_PCT, DEFAULT_SIZE_PHOTO_OPACITY, SIZE_END_ANCHORS, DEFAULT_SIZE_END_ANCHOR,
} from '../../constants/sizeChart';
import { photoPlacement, figuresFromMarks, isEndView, trackKeyOf } from '../../utils/sizePhotoMarks';
import { useSourceLine } from '../../hooks/useSourceLine';
import { sourceLineText } from '../../utils/sources';
import { useChartPng } from '../../hooks/useChartPng';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import FeatureChartButton from '../home/FeatureChartButton';
import ChartInfoBubble from '../ChartInfoBubble';
import SizeChartSidebar from './SizeChartSidebar';
import SizeChartCanvas from './SizeChartCanvas';
import SizeFiguresTable from './SizeFiguresTable';

const nameList = (items) => items.map(i => i.label).join(', ');

/** Where a drawn photo's marks read further than SIZE_PHOTO_CHART_PCT from the specs: "height +7.4%". */
function photoErrors(view, item) {
    const read = figuresFromMarks(view, item.photo, item.profile);
    if (!read) return [];
    const p = item.profile;
    const checks = isEndView(view)
        ? [['height', read.height, p.height], ['track', read.track, p.estimated.has(trackKeyOf(view)) ? null : p[trackKeyOf(view)]]]
        : [['wheelbase', read.wheelbase, p.wheelbase], ['height', read.height, p.height]];
    return checks
        .filter(([, got, spec]) => got != null && spec > 0 && Math.abs(got / spec - 1) * 100 > SIZE_PHOTO_CHART_PCT)
        .map(([name, got, spec]) => { const pct = (got / spec - 1) * 100; return `${name} ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`; });
}

/** A photo's credit for the source line: its credit, else its source's site. */
function creditOf(photo) {
    let name = photo.credit?.trim();
    if (!name && photo.source_url) {
        try { name = new URL(photo.source_url).hostname.replace(/^www\./, ''); } catch { name = null; }
    }
    return name ? { name: photo.mirrored ? `${name} (mirrored)` : name, url: photo.source_url || null } : null;
}

/**
 * The Size chart: the selected vehicles drawn to one scale from their
 * dimension specs, side or front, lined up on a point the reader picks.
 *
 * Each vehicle is its size photo (docs/size-photos-plan.md), its marks
 * stretched to its length (front: width) and height specs, when it has one and
 * Draw is Photos; otherwise a
 * silhouette (utils/silhouettes.js), a body style's shape stretched to its own
 * length, height, wheelbase and overhangs. What a vehicle lacks is said under
 * the chart — left out for want of a length, height or wheelbase; drawn with
 * its axles estimated for want of a front overhang.
 *
 * Settings are App's chartConfig (`sizeView`, `sizeAnchor`, `sizeEndAnchor`, `sizeDraw` in the
 * link; `sizeLines`, `sizeGrid`, `sizeOpacity` for this visit), so the pop-out
 * draws the same chart. A click on a vehicle (or its row) picks the one the
 * figures are measured from, and keeps it forward; a second click lets go.
 */
export default function SizeChart({ vehicles, chartConfig, setChartConfig, presentationMode = false }) {
    const { units, vehicles: allVehicles } = useAppContext();
    const view = SIZE_VIEWS.some(v => v.key === chartConfig.sizeView) ? chartConfig.sizeView : DEFAULT_SIZE_VIEW;
    const anchor = SIZE_ANCHORS.some(a => a.key === chartConfig.sizeAnchor) ? chartConfig.sizeAnchor : DEFAULT_SIZE_ANCHOR;
    const endAnchor = SIZE_END_ANCHORS.some(a => a.key === chartConfig.sizeEndAnchor) ? chartConfig.sizeEndAnchor : DEFAULT_SIZE_END_ANCHOR;
    const lines = chartConfig.sizeLines ?? true;
    const grid = chartConfig.sizeGrid ?? true;
    const draw = SIZE_DRAWS.some(d => d.key === chartConfig.sizeDraw) ? chartConfig.sizeDraw : DEFAULT_SIZE_DRAW;
    const opacity = chartConfig.sizeOpacity ?? DEFAULT_SIZE_PHOTO_OPACITY;
    const [hoverId, setHoverId] = useState(null);
    // A click picks the vehicle the figures are measured from; it stays forward.
    const [pickedId, setPickedId] = useState(null);

    // A vehicle's color is the same here as on every chart.
    const palette = chartConfig.seriesPalette ?? DEFAULT_SERIES_PALETTE;
    const colorMap = useMemo(() => resolveChartColors(
        vehicles.map(v => ({ id: v.id, created_at: v.created_at })),
        {}, palette, vehicles.map(v => ({ ...v, runs: [{ id: v.id }] })),
    ), [vehicles, palette]);

    const all = useMemo(() => {
        const labels = buildVehicleLabels(vehicles);
        return vehicles.map(v => {
            const profile = profileFromSpecs(resolveEffectiveSpecs(v, allVehicles), v.size_photos);
            const photo = draw === 'photos' ? v.size_photos?.[view] ?? null : null;
            // A photo the specs can't scale (no length, or no width from the front) isn't drawn.
            const placement = photo ? photoPlacement(view, photo, profile) : null;
            return {
                id: v.id,
                label: labels.get(v.id)?.short ?? v.name,
                color: colorMap[v.id],
                profile,
                photo: placement ? { ...photo, placement } : null,
            };
        });
    }, [vehicles, allVehicles, colorMap, draw, view]);

    const drawn = useMemo(() => all.filter(i => i.profile.missing[view].length === 0), [all, view]);
    const fromId = drawn.some(i => i.id === pickedId) ? pickedId : null;
    const activeId = hoverId ?? fromId;
    const pick = (id) => setPickedId(p => (p === id ? null : id));
    const left = all.filter(i => i.profile.missing[view].length > 0);
    const notes = [
        left.length > 0 && `Not drawn: ${left.map(i => `${i.label} (no ${i.profile.missing[view].join(', ')})`).join('; ')}.`,
        ...(view === 'side' ? [
            (() => { const e = drawn.filter(i => i.profile.estimated.has('frontOverhang')); return e.length > 0 && `Axles placed by a typical overhang split (no front overhang): ${nameList(e)}.`; })(),
            (() => { const e = drawn.filter(i => i.profile.estimated.has('tireDiameter')); return e.length > 0 && `Wheel size estimated (no tire size): ${nameList(e)}.`; })(),
        ] : [
            (() => { const e = drawn.filter(i => i.profile.estimated.has('width')); return e.length > 0 && `Body width estimated from the width with mirrors: ${nameList(e)}.`; })(),
            (() => { const e = drawn.filter(i => i.profile.estimated.has(trackKeyOf(view))); return e.length > 0 && `Track estimated: ${nameList(e)}.`; })(),
        ]),
        (() => { const e = drawn.filter(i => !i.photo && i.profile.estimated.has('bodyStyle')); return e.length > 0 && `Generic outline (no body style): ${nameList(e)}.`; })(),
        view === 'side' && (() => { const e = drawn.filter(i => i.profile.fromPhoto.has('frontOverhang')); return e.length > 0 && `Front and rear overhang split as the photo shows it (no front overhang spec): ${nameList(e)}.`; })(),
        (() => { const e = drawn.filter(i => i.photo?.mirrored); return e.length > 0 && `Mirrored photo (the other side of the car, flipped): ${nameList(e)}.`; })(),
        // One line per vehicle.
        ...drawn.filter(i => i.photo).map(i => [i, photoErrors(view, i)]).filter(([, errs]) => errs.length)
            .map(([i, errs]) => `${i.label}: photo marks off the specs by more than ${SIZE_PHOTO_CHART_PCT}% (${errs.join(', ')}); drawn to the specs, the photo may be distorted.`),
    ].filter(Boolean);

    const onChange = (patch) => setChartConfig(p => ({ ...p, ...patch }));
    const anchorLabel = (isEndView(view) ? SIZE_END_ANCHORS.find(a => a.key === endAnchor) : SIZE_ANCHORS.find(a => a.key === anchor)).label.toLowerCase();
    const title = `Size, from the ${view}`;
    const gridNote = grid ? `grid ${units === 'metric' ? '0.5 m' : `${gridStepIn(units) / 12} ft`}` : null;
    const subtitle = [
        units === 'metric' ? 'metric' : 'imperial',
        `lined up on the ${anchorLabel}`,
        gridNote,
        drawn.every(i => i.photo) ? 'photos scaled to the specs' : 'outlines are generic shapes; the figures are the specs',
    ].filter(Boolean).join(' · ');
    const dataLine = useSourceLine({});
    const sourceLine = useMemo(() => {
        const seen = new Map();
        for (const i of drawn) {
            const c = i.photo && creditOf(i.photo);
            if (c && !seen.has(c.name)) seen.set(c.name, c);
        }
        const photos = [...seen.values()];
        return photos.length ? { ...dataLine, photos, text: sourceLineText({ ...dataLine, photos }, dataLine.showGaps) } : dataLine;
    }, [dataLine, drawn]);
    const exportRef = useRef(null);
    const { copyPng, copied: imageCopied, preview, dismissPreview } = useChartPng(exportRef, {
        title, subtitle, sources: sourceLine.text, signature: `${drawn.map(i => i.id).join(',')}|${view}|${anchor}|${endAnchor}|${draw}`,
    });

    // One tree, like every chart's: the pop-out drops the sidebar, and the
    // help bubble is the last thing in the plot's column.
    return (
        <div className="chart-layout">
            {!presentationMode && (
                <SizeChartSidebar view={view} anchor={anchor} endAnchor={endAnchor} draw={draw} lines={lines} grid={grid} opacity={opacity} onChange={onChange} />
            )}
            <div className="chart-main">
            <PlotFrame
                title={title}
                subtitle={subtitle}
                sourceLine={sourceLine}
                preview={preview}
                onDismissPreview={dismissPreview}
                exportControls={!presentationMode && (
                    <>
                        <FeatureChartButton />
                        <CopyLinkButton />
                        <button
                            onClick={copyPng}
                            className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                            title="Copy the framed chart as an image (PNG)"
                        >
                            {imageCopied ? '✓ Image copied' : 'Image'}
                        </button>
                    </>
                )}
            >
                {drawn.length > 0
                    ? <SizeChartCanvas items={drawn} view={view} anchor={anchor} endAnchor={endAnchor} units={units} lines={lines} grid={grid} activeId={activeId} onActive={setHoverId} onPick={pick} opacity={opacity} exportRef={exportRef} />
                    : <p className="text-note size-chart-empty">No selected vehicle has the figures this view needs.</p>}
            </PlotFrame>
            {drawn.length > 0 && <SizeFiguresTable items={drawn} view={view} units={units} activeId={activeId} onActive={setHoverId} fromId={fromId} onPick={pick} />}
            {notes.map(n => <p key={n} className="text-note size-chart-note">{n}</p>)}
            {!presentationMode && <ChartInfoBubble chartKey="specsize" />}
            </div>{/* .chart-main */}
        </div>
    );
}
