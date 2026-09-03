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
 * @param {{title: string, subtitle: string}} frame  Caption drawn onto the PNG.
 */
export function useChartPng(chartRef, frame) {
    const [copied, setCopied] = useState(false);
    const [preview, setPreview] = useState(null);

    // A preview is a picture of the chart AT THE MOMENT IT WAS COPIED. Leave it
    // up after the chart changes and it quietly becomes a picture of something
    // else — two different answers on screen at once, the stale one looking
    // just as authoritative. Keyed on the caption because that is what encodes
    // the run count, the mode, the corrections and the units; a plain object
    // dependency would be a new identity every render and clear it instantly.
    const caption = `${frame?.title ?? ''}|${frame?.subtitle ?? ''}`;
    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return; }
        setPreview(null);
    }, [caption]);

    const copyPng = async () => {
        const chart = chartRef?.current;
        if (!chart) return;
        const opts = { title: frame?.title, subtitle: frame?.subtitle };
        try {
            setPreview(await copyChartAsPng(chart, opts));
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // No clipboard here. The image is still worth having, so it is
            // rendered rather than the click doing nothing at all.
            setPreview(chartToPngDataUrl(chart, opts));
        }
    };

    return { copyPng, copied, preview, dismissPreview: () => setPreview(null) };
}
