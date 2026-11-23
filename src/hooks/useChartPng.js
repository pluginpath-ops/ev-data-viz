import { useEffect, useRef, useState } from 'react';
import { copyChartAsPng, chartToPngDataUrl } from '../utils/chartUtils';

/**
 * Copy a chart as a framed PNG, and keep a thumbnail of what was copied.
 *
 * The thumbnail is the point. `navigator.clipboard.write` fails silently on
 * most mobile browsers and in any non-secure context, so a button that only
 * copies is a button that does nothing for a large share of readers — and a
 * clipboard is useless to someone who wants to SAVE the image anyway. The
 * preview is right-clickable and long-pressable, which is how you get a file.
 *
 * It was implemented in two views out of five, differently, and three had no
 * preview at all. One hook rather than five handlers means the affordance
 * cannot be present on one chart and missing on the next.
 *
 * @param {{current: object}} chartRef  Ref holding the Chart.js INSTANCE.
 * @param {{title: string, subtitle: string, sources?: string, stamp?: () => string|null}} frame
 *        Caption drawn onto the PNG; `sources` is the source line's text
 *        (useSourceLine); `stamp`, read at copy time, is added to the title
 *        (the playback clock, which moves too fast to be a render-time string).
 */
export function useChartPng(chartRef, frame) {
    const [copied, setCopied] = useState(false);
    const [preview, setPreview] = useState(null);

    // A preview is a picture of the chart AT THE MOMENT IT WAS COPIED. Leave it
    // up after the chart changes and it quietly becomes a picture of something
    // else — two different answers on screen at once, the stale one looking
    // just as authoritative. Keyed on the caption because that is what encodes
    // the mode, the corrections and the units. The subtitle no longer carries
    // the run/vehicle counts (#443), so a view passes `frame.signature` (a
    // string of what is plotted) to keep a change of selection clearing the
    // preview. A plain object dependency would be a new identity every render
    // and clear it instantly.
    const caption = `${frame?.title ?? ''}|${frame?.subtitle ?? ''}|${frame?.signature ?? ''}|${frame?.sources ?? ''}`;
    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return; }
        setPreview(null);
    }, [caption]);

    // `side`: the values of a fixed readout in a panel beside the plot (#456),
    // instead of over it. `copied` is shared by both buttons; `copiedSide` says
    // which one was pressed.
    const [copiedSide, setCopiedSide] = useState(false);
    const copy = async (side) => {
        const chart = chartRef?.current;
        if (!chart) return;
        const title = [frame?.title, frame?.stamp?.()].filter(Boolean).join(' · ');
        const opts = { title, subtitle: frame?.subtitle, sources: frame?.sources, side };
        try {
            setPreview(await copyChartAsPng(chart, opts));
            setCopied(true);
            setCopiedSide(side);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // No clipboard here. The image is still worth having, so it is
            // rendered rather than the click doing nothing at all.
            setPreview(chartToPngDataUrl(chart, opts));
        }
    };

    const copyPng = () => copy(false);
    const copyPngBeside = () => copy(true);

    return {
        copyPng,
        copyPngBeside,
        copied: copied && !copiedSide, copiedBeside: copied && copiedSide,
        preview, dismissPreview: () => setPreview(null),
    };
}
