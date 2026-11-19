import { useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { resolveChartColors, DEFAULT_SERIES_PALETTE } from '../../utils/colorUtils';
import { resolveEffectiveSpecs } from '../../utils/specHelpers';
import { buildVehicleLabels } from '../../utils/seriesLabel';
import { profileFromSpecs } from '../../utils/vehicleProfile';
import { gridStepIn } from '../../utils/sizeChartLayout';
import { SIZE_ANCHORS, SIZE_VIEWS, DEFAULT_SIZE_ANCHOR, DEFAULT_SIZE_VIEW } from '../../constants/sizeChart';
import { useSourceLine } from '../../hooks/useSourceLine';
import { useChartPng } from '../../hooks/useChartPng';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import FeatureChartButton from '../home/FeatureChartButton';
import ChartInfoBubble from '../ChartInfoBubble';
import SizeChartSidebar from './SizeChartSidebar';
import SizeChartCanvas from './SizeChartCanvas';
import SizeFiguresTable from './SizeFiguresTable';

const nameList = (items) => items.map(i => i.label).join(', ');

/**
 * The Size chart: the selected vehicles drawn to one scale from their
 * dimension specs, side or front, lined up on a point the reader picks.
 *
 * The outlines are silhouettes (utils/silhouettes.js), not photos: a body
 * style's shape stretched to each vehicle's own length, height, wheelbase and
 * overhangs. What a vehicle lacks is said under the chart — left out for want
 * of a length, height or wheelbase; drawn with its axles estimated for want of
 * a front overhang.
 *
 * Settings are App's chartConfig (`sizeView`, `sizeAnchor` in the link;
 * `sizeLines`, `sizeGrid` for this visit), so the pop-out draws the same chart.
 */
export default function SizeChart({ vehicles, chartConfig, setChartConfig, presentationMode = false }) {
    const { units, vehicles: allVehicles } = useAppContext();
    const view = SIZE_VIEWS.some(v => v.key === chartConfig.sizeView) ? chartConfig.sizeView : DEFAULT_SIZE_VIEW;
    const anchor = SIZE_ANCHORS.some(a => a.key === chartConfig.sizeAnchor) ? chartConfig.sizeAnchor : DEFAULT_SIZE_ANCHOR;
    const lines = chartConfig.sizeLines ?? true;
    const grid = chartConfig.sizeGrid ?? true;
    const [activeId, setActiveId] = useState(null);

    // A vehicle's color is the same here as on every chart.
    const palette = chartConfig.seriesPalette ?? DEFAULT_SERIES_PALETTE;
    const colorMap = useMemo(() => resolveChartColors(
        vehicles.map(v => ({ id: v.id, created_at: v.created_at })),
        {}, palette, vehicles.map(v => ({ ...v, runs: [{ id: v.id }] })),
    ), [vehicles, palette]);

    const all = useMemo(() => {
        const labels = buildVehicleLabels(vehicles);
        return vehicles.map(v => ({
            id: v.id,
            label: labels.get(v.id)?.short ?? v.name,
            color: colorMap[v.id],
            profile: profileFromSpecs(resolveEffectiveSpecs(v, allVehicles)),
        }));
    }, [vehicles, allVehicles, colorMap]);

    const drawn = useMemo(() => all.filter(i => i.profile.missing[view].length === 0), [all, view]);
    const left = all.filter(i => i.profile.missing[view].length > 0);
    const notes = [
        left.length > 0 && `Not drawn: ${left.map(i => `${i.label} (no ${i.profile.missing[view].join(', ')})`).join('; ')}.`,
        ...(view === 'side' ? [
            (() => { const e = drawn.filter(i => i.profile.estimated.has('frontOverhang')); return e.length > 0 && `Axles placed by a typical overhang split (no front overhang): ${nameList(e)}.`; })(),
            (() => { const e = drawn.filter(i => i.profile.estimated.has('tireDiameter')); return e.length > 0 && `Wheel size estimated (no tire size): ${nameList(e)}.`; })(),
        ] : [
            (() => { const e = drawn.filter(i => i.profile.estimated.has('width')); return e.length > 0 && `Body width estimated from the width with mirrors: ${nameList(e)}.`; })(),
            (() => { const e = drawn.filter(i => i.profile.estimated.has('trackFront')); return e.length > 0 && `Track estimated: ${nameList(e)}.`; })(),
        ]),
        (() => { const e = drawn.filter(i => i.profile.estimated.has('bodyStyle')); return e.length > 0 && `Generic outline (no body style): ${nameList(e)}.`; })(),
    ].filter(Boolean);

    const onChange = (patch) => setChartConfig(p => ({ ...p, ...patch }));
    const anchorLabel = SIZE_ANCHORS.find(a => a.key === anchor).label.toLowerCase();
    const title = view === 'front' ? 'Size, from the front' : 'Size, from the side';
    const gridNote = grid ? `grid ${units === 'metric' ? '0.5 m' : `${gridStepIn(units) / 12} ft`}` : null;
    const subtitle = [
        units === 'metric' ? 'metric' : 'imperial',
        view === 'side' ? `lined up on the ${anchorLabel}` : null,
        gridNote,
        'outlines are generic shapes; the figures are the specs',
    ].filter(Boolean).join(' · ');
    const sourceLine = useSourceLine({});
    const exportRef = useRef(null);
    const { copyPng, copied: imageCopied, preview, dismissPreview } = useChartPng(exportRef, {
        title, subtitle, sources: sourceLine.text, signature: `${drawn.map(i => i.id).join(',')}|${anchor}`,
    });

    // One tree, like every chart's: the pop-out drops the sidebar, and the
    // help bubble is the last thing in the plot's column.
    return (
        <div className="chart-layout">
            {!presentationMode && (
                <SizeChartSidebar view={view} anchor={anchor} lines={lines} grid={grid} onChange={onChange} />
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
                    ? <SizeChartCanvas items={drawn} view={view} anchor={anchor} units={units} lines={lines} grid={grid} activeId={activeId} onActive={setActiveId} exportRef={exportRef} />
                    : <p className="text-note size-chart-empty">No selected vehicle has the figures this view needs.</p>}
            </PlotFrame>
            {drawn.length > 0 && <SizeFiguresTable items={drawn} view={view} units={units} activeId={activeId} onActive={setActiveId} />}
            {notes.map(n => <p key={n} className="text-note size-chart-note">{n}</p>)}
            {!presentationMode && <ChartInfoBubble chartKey="specsize" />}
            </div>{/* .chart-main */}
        </div>
    );
}
