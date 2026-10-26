import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import RunSourceLinks from '../RunSourceLinks';
import { useIsCompact } from '../../hooks/useIsCompact';
import { nearestRow, windowRows, ACTIVE_REACH_PX } from '../../utils/readoutAtX';

/**
 * The readout's DOM: a crosshair, a dot on each line at that X, and the box
 * listing every series there (#455). State comes from useChartReadout's store;
 * this draws it. Mount it beside the canvas, inside a `.chart-readout-host`.
 *
 * Positioned absolutely against the host rather than fixed to the viewport, so
 * a readout fixed with the mouse stays attached to its chart when the page
 * scrolls. It flips left of the crosshair near the right edge and is clamped to
 * the window, and below the compact breakpoint a FIXED one becomes a bottom
 * sheet so it does not cover the finger that is scrubbing.
 *
 * Hovering, the box takes no pointer (`pointer-events: none`) because it follows
 * the cursor — it cannot be reached. Fixed, it takes the pointer, and that is
 * when its ↗ source links work.
 *
 * `config.subtitle` names what the values are (the Y axes), once, so the rows
 * can be bare numbers.
 *
 * Each row is `describe(row, {nearest, x})`'s answer — the view decides what a row says:
 *   { name, value, companion?, flag?, detail?, sources? }
 * The ACTIVE row also shows `detail` (lines) and `sources` (`{label, run}` —
 * where the data came from, each a link by its name), which are too long to
 * repeat down twelve rows. Active is the row nearest the cursor; in a fixed
 * readout, which the cursor has left, it is the row the pointer is over — so
 * every run's source is one hover away, not only the one that was clicked on.
 * (`nearest` in `describe`'s options means this active row.)
 */
/** How long the pointer must rest on a row of a fixed readout to make it active. */
const DWELL_MS = 200;

export default function ChartReadout({ store }) {
    const s = useSyncExternalStore(store.subscribe, store.get);
    const isCompact = useIsCompact();
    const layerRef = useRef(null);
    const boxRef = useRef(null);
    const detailRef = useRef(null);
    const placedFor = useRef(null);
    const detailReserve = useRef(0);
    const [hovered, setHovered] = useState(null);   // { key, at: the xPx it was chosen at }
    const lastPointer = useRef({ x: NaN, y: NaN });

    // Which row the pointer is over, read on MOVEMENT only. Expanding a row
    // moves the rows below it, so the pointer can end up over a different row
    // without having moved — and an enter event for that one would expand it,
    // move the rows back, and loop for as long as the pointer stayed still.
    // Browsers also fire a synthetic move after a layout shift, at the same
    // coordinates, which is why this compares positions instead of trusting the
    // event.
    //
    // And the row only becomes active once the pointer has RESTED on it. The
    // detail (and its source links) is below the list, so reaching a link means
    // crossing other rows on the way; activating each as it was crossed handed
    // the panel to a different run before the pointer arrived. Leaving the list
    // cancels a pending change and keeps the current one, so the panel is still
    // the one you were reading when you get to it. A click activates at once.
    const dwell = useRef(null);
    const activate = (key) => setHovered({ key, at: s.xPx });
    const onListMove = (e) => {
        const { clientX: x, clientY: y } = e;
        if (Math.abs(x - lastPointer.current.x) < 1 && Math.abs(y - lastPointer.current.y) < 1) return;
        lastPointer.current = { x, y };
        const key = e.target.closest?.('li[data-row]')?.dataset.row;
        clearTimeout(dwell.current);
        if (key == null || key === hovered?.key) return;
        dwell.current = setTimeout(() => activate(key), DWELL_MS);
    };
    useEffect(() => () => clearTimeout(dwell.current), []);

    const fixed = s.mode === 'fixed';
    const sheet = fixed && isCompact;

    // Placed after the box is in the DOM and measured, before paint. Written
    // straight to the node: it changes on every pointer move, and a state
    // update per move to position a box would be a render per move.
    //
    // A FIXED readout is placed once, when it is fixed, and then left alone.
    // Re-placing on every render let its own content move it: the box is clamped
    // to the window, so a taller detail pushed it up, which moved the rows under
    // a still pointer, which changed the active row, which changed the detail.
    // The detail also reserves the tallest it has been (below), so nothing under
    // the pointer moves as the active row changes.
    useLayoutEffect(() => {
        const box = boxRef.current, layer = layerRef.current;
        if (!box || !layer || s.mode === 'off' || sheet) return;

        const detail = detailRef.current;
        if (fixed) {
            const key = `${s.xPx}|${s.area.top}`;
            const fresh = placedFor.current !== key;
            if (fresh) { detailReserve.current = 0; if (detail) detail.style.minHeight = ''; }
            if (detail) {
                detailReserve.current = Math.max(detailReserve.current, detail.offsetHeight);
                detail.style.minHeight = `${detailReserve.current}px`;
            }
            if (!fresh) return;
            placedFor.current = key;
        } else {
            placedFor.current = null;
            detailReserve.current = 0;
        }

        const GAP = 14, MARGIN = 8;
        const host = layer.getBoundingClientRect();
        const w = box.offsetWidth, h = box.offsetHeight;
        let left = s.xPx + GAP;
        if (host.left + left + w > window.innerWidth - MARGIN) left = s.xPx - GAP - w;
        left = Math.max(MARGIN - host.left, Math.min(left, window.innerWidth - MARGIN - w - host.left));
        const top = Math.max(MARGIN - host.top, Math.min(s.area.top + 6, window.innerHeight - MARGIN - h - host.top));
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
    });

    if (s.mode === 'off') return <div ref={layerRef} className="chart-readout-layer" />;

    const { rows, missing, cursorY, area, config } = s;
    // Windowing follows the closest line wherever the cursor is; only a cursor
    // within reach of one makes it the ACTIVE row.
    const closest = nearestRow(rows, cursorY);
    const nearest = nearestRow(rows, cursorY, ACTIVE_REACH_PX);
    // A fixed readout can be scrolled, so it lists everything; a hover one
    // cannot, so it windows around the row the cursor is on.
    const { shown, offset, above, below } = fixed
        ? { shown: rows, offset: 0, above: 0, below: 0 }
        : windowRows(rows, closest);
    const anyInterpolated = rows.some(r => r.interpolated);
    // A choice belongs to the position it was made at: fix somewhere else and the
    // active row is the nearest again.
    const activeKey = fixed && hovered?.at === s.xPx && rows.some(r => r.key === hovered.key) ? hovered.key : null;

    const entries = shown.map((row, k) => {
        const active = activeKey != null ? row.key === activeKey : offset + k === nearest;
        return { row, active, d: config.describe(row, { nearest: active, x: s.x }) };
    });
    const active = entries.find(e => e.active);
    const hasDetail = !!active && (active.d.detail?.length > 0 || active.d.sources?.length > 0);

    return (
        <div ref={layerRef} className="chart-readout-layer">
            <div className="chart-crosshair"
                 style={{ transform: `translateX(${s.xPx}px)`, top: area.top, height: area.bottom - area.top }} />
            {s.dots.map(d => (
                <span key={d.key}
                      className={`chart-crosshair-dot${d.interpolated ? ' is-interpolated' : ''}`}
                      style={{ transform: `translate(${d.px}px, ${d.py}px)`, '--dot': d.color ?? 'currentColor' }} />
            ))}

            <div ref={boxRef}
                 role={fixed ? 'dialog' : 'tooltip'}
                 aria-label={fixed ? 'Values at the fixed position' : undefined}
                 className={`chart-readout${fixed ? ' chart-readout--fixed' : ''}${sheet ? ' chart-readout--sheet' : ''}`}>
                <div className="chart-readout-head">
                    <span className="chart-readout-title">{config.title(s.x)}</span>
                    {fixed && (
                        <button type="button" className="popover-close" aria-label="Clear the fixed readout"
                                onClick={() => store.actions?.clear()}>×</button>
                    )}
                </div>
                {config.subtitle && <div className="chart-readout-subtitle">{config.subtitle}</div>}

                {above > 0 && <div className="chart-readout-more">+{above} above</div>}
                <ol className="chart-readout-list"
                    onPointerMove={fixed ? onListMove : undefined}
                    onPointerLeave={() => clearTimeout(dwell.current)}
                    onClick={fixed ? (e) => {
                        const key = e.target.closest?.('li[data-row]')?.dataset.row;
                        if (key != null) { clearTimeout(dwell.current); activate(key); }
                    } : undefined}>
                    {entries.map(({ row, active: isActive, d }) => (
                        <li key={row.key} data-row={row.key} className={`chart-readout-row${isActive ? ' is-active' : ''}`}>
                            <span className="series-swatch" style={{ backgroundColor: row.color ?? undefined }} />
                            <span className="chart-readout-name" title={d.name}>{d.name}</span>
                            <span className="chart-readout-value">
                                {row.interpolated && <span className="chart-readout-approx" aria-label="read off the line">≈</span>}
                                {d.value}
                                {d.companion && <span className="chart-readout-companion"> · {d.companion}</span>}
                            </span>
                            <span className="chart-readout-flag-cell">
                                {d.flag && <span className="chart-readout-flag" title={d.flag}>⚠</span>}
                            </span>
                        </li>
                    ))}
                </ol>
                {below > 0 && <div className="chart-readout-more">+{below} below</div>}

                {/* The active row's detail and sources, BELOW the list rather than
                    inside its row: expanding a row in place moved every row under
                    it, and a pointer resting on that boundary flickered between
                    two states. Below the list nothing the pointer is over moves.
                    Fixed, the panel is always there (reserving its tallest size
                    so the box never changes height under the pointer). */}
                {(hasDetail || fixed) && (
                    <div ref={detailRef} className="chart-readout-detail">
                        {hasDetail && (
                            <>
                                <div className="chart-readout-detail-name">{active.d.name}</div>
                                {active.d.detail?.map((line, n) => <div key={n}>{line}</div>)}
                                {active.d.sources?.length > 0 && (
                                    <div className="chart-readout-sources">
                                        Source: {active.d.sources.map((src, n) => (
                                            <span key={n}>
                                                {n > 0 && ' · '}
                                                {/* RunSourceLinks renders nothing for a run with no
                                                    link, so the name is shown plain beside it. */}
                                                {(src.run?.source_url ?? src.run?.sourceUrl)
                                                    ? <RunSourceLinks run={src.run}>{src.label}</RunSourceLinks>
                                                    : src.label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                <div className="chart-readout-foot">
                    {anyInterpolated && <span>≈ read off the line</span>}
                    {missing > 0 && <span>{missing} without data here</span>}
                    <span>{fixed ? 'Kept in the PNG · click the chart or press Esc to clear' : 'Click to fix, and it goes in the PNG'}</span>
                </div>
            </div>
        </div>
    );
}
