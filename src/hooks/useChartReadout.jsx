import { useCallback, useState } from 'react';
import ChartReadout from '../components/charts/ChartReadout';
import { readingsAtX, autoTolerance } from '../utils/readoutAtX';

/**
 * The readout: every series at the X under the cursor, in one box with a
 * crosshair (#455).
 *
 * ── Why it is not Chart.js's tooltip ────────────────────────────────────────
 *
 * Chart.js draws its tooltip on the canvas, where text cannot be a link, and
 * its `index`/`x` modes assume the datasets share x values — here each test has
 * its own samples. So the lookup is `readoutAtX`, and the box is DOM
 * (`ChartReadout`), which also keeps it out of the PNG by construction.
 *
 * ── Hover reads, click fixes ────────────────────────────────────────────────
 *
 * Hover shows the readout and it follows the cursor, so it cannot also be
 * reached: it moves as you approach. A click FIXES it at that X, and a fixed
 * readout stays put and takes the pointer — which is how its source links are
 * clicked. A second click on the chart, Esc, or a click outside clears it.
 *
 * A drag is a box-zoom, not a click, so it never fixes anything: past 4px of
 * movement the readout hides, and releasing clears a fixed one (the axes moved
 * under it). The fixed readout is DOM only, local to the window it was made in,
 * and gone whenever the chart is rebuilt (#456 owns anything more durable:
 * drawing it into the PNG, the URL, the pop-out).
 *
 * Touch has no hover: a tap fixes, a horizontal drag scrubs the crosshair, and
 * `touch-action: pan-y` leaves vertical page scroll alone.
 *
 * ── What re-renders ─────────────────────────────────────────────────────────
 *
 * Nothing but the overlay. State lives in an external store the overlay
 * subscribes to, updates are coalesced to one per animation frame, and the
 * crosshair and dots are DOM positioned by transform — Chart.js never redraws
 * on a hover. The lookup itself is a binary search per series (0.4µs for twelve
 * series of two thousand points, measured).
 *
 * Usage, in a chart view:
 *
 *   const readout = useChartReadout();
 *   new Chart(ctx, { …, plugins: [readout.plugin({ title, describe })],
 *                       options: { plugins: { tooltip: { enabled: false } } } });
 *   <div className="chart-readout-host"><canvas />{readout.overlay}</div>
 *
 * The config is passed per chart because `title` and `describe` close over
 * values only the chart's build has (units, labels, the runs).
 *
 * @returns {{ plugin: (config: object) => object, overlay: React.ReactNode }}
 *   config: `{ title(x) → string, describe(row, {nearest}) → object }`, and
 *   optionally `xTolerance` in x-units (default: autoTolerance).
 */
export function useChartReadout() {
    const [store] = useState(createStore);
    const plugin = useCallback((config) => readoutPlugin(store, config), [store]);
    return { plugin, overlay: <ChartReadout store={store} />, store };
}

const IDLE = { mode: 'off' };

function createStore() {
    let state = IDLE;
    const subscribers = new Set();
    return {
        get: () => state,
        set(next) {
            if (next === IDLE && state === IDLE) return;
            state = next;
            subscribers.forEach(fn => fn());
        },
        subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
        // Set by the attached chart, so the overlay's close button can clear.
        actions: null,
    };
}

/** Movement under this is a click; over it, a drag (box-zoom, or a touch scrub). */
const CLICK_SLOP = 4;
const SCRUB_SLOP = 8;

function readoutPlugin(store, config) {
    let detach = null;
    return {
        id: 'readout',
        afterInit(chart) { detach = attach(chart, config, store); },
        beforeDestroy() { detach?.(); detach = null; },
    };
}

function attach(chart, config, store) {
    const canvas = chart.canvas;
    let mode = 'off';            // mirrors the store, so handlers need not read it
    let raf = 0;
    let pending = null;
    let down = null;             // the press in progress
    let keyboardX = null;

    const priorTouchAction = canvas.style.touchAction;
    const priorTabIndex = canvas.getAttribute('tabindex');
    canvas.style.touchAction = 'pan-y';
    canvas.tabIndex = 0;

    const reading = (px, py, forMode, xOverride) => {
        const { chartArea: area, scales } = chart;
        const xScale = scales.x;
        if (!area || !xScale) return null;
        const x = xOverride ?? xScale.getValueForPixel(px);
        const span = Math.abs(xScale.max - xScale.min);
        const tolerance = config.xTolerance
            ?? autoTolerance({ span, pxPerUnit: span > 0 ? xScale.width / span : 0 });
        const { rows, missing } = readingsAtX(chart.data.datasets, x, {
            tolerance,
            fuzz: span * 0.01,
            isVisible: i => chart.isDatasetVisible(i),
            toPixelY: (axisId, y) => (scales[axisId] ?? scales.y).getPixelForValue(y),
        });
        if (!rows.length) return null;
        return {
            mode: forMode,
            x,
            xPx: xScale.getPixelForValue(x),
            cursorY: py,
            rows,
            missing,
            area: { left: area.left, right: area.right, top: area.top, bottom: area.bottom },
            dots: rows.map(r => ({
                key: r.key,
                px: xScale.getPixelForValue(r.x),
                py: r.pixelY,
                color: r.color,
                interpolated: r.interpolated,
            })),
            config,
        };
    };

    const show = (px, py, forMode, xOverride) => {
        const next = reading(px, py, forMode, xOverride);
        mode = next ? forMode : 'off';
        store.set(next ?? IDLE);
    };

    const clear = () => { mode = 'off'; down = null; store.set(IDLE); };
    store.actions = { clear };

    // One update per frame, the latest wins.
    const schedule = (fn) => {
        pending = fn;
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            const run = pending;
            pending = null;
            run?.();
        });
    };

    const where = (e) => {
        const r = canvas.getBoundingClientRect();
        return { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    const inArea = ({ px, py }) => {
        const a = chart.chartArea;
        return !!a && px >= a.left && px <= a.right && py >= a.top && py <= a.bottom;
    };

    const onMove = (e) => {
        if (down) {
            const dx = e.clientX - down.cx, dy = e.clientY - down.cy;
            if (down.touch) {
                // Horizontal movement scrubs; vertical is the page scrolling.
                if (Math.abs(dx) > SCRUB_SLOP && Math.abs(dx) > Math.abs(dy)) {
                    down.scrubbing = true;
                    const p = where(e);
                    schedule(() => show(p.px, p.py, 'fixed'));
                }
                return;
            }
            if (Math.hypot(dx, dy) > CLICK_SLOP) {
                // A box-zoom is under way: nothing to read until it is done.
                down.dragged = true;
                schedule(() => { store.set(IDLE); });
                return;
            }
        }
        if (mode === 'fixed') return;
        const p = where(e);
        if (!inArea(p)) { schedule(() => { mode = 'off'; store.set(IDLE); }); return; }
        schedule(() => show(p.px, p.py, 'hover'));
    };

    const onLeave = () => {
        if (mode === 'fixed' || down) return;
        pending = null;
        clear();
    };

    const onUp = (e) => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        const press = down;
        down = null;
        if (!press || e.button > 0) return;
        const p = where(e);

        if (press.touch) {
            if (press.scrubbing) return;           // left fixed where the finger stopped
            if (Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > SCRUB_SLOP) return;
            if (mode === 'fixed') { clear(); return; }
            if (inArea(p)) show(p.px, p.py, 'fixed');
            return;
        }

        if (press.dragged) { clear(); return; }    // zoomed: the axes moved under it
        if (mode === 'fixed') {
            // Back to reading, at once, wherever the pointer is.
            if (inArea(p)) show(p.px, p.py, 'hover'); else clear();
            return;
        }
        if (inArea(p)) show(p.px, p.py, 'fixed');
    };
    const onCancel = () => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        down = null;
    };

    const onDown = (e) => {
        if (e.button > 0) return;
        down = { cx: e.clientX, cy: e.clientY, touch: e.pointerType === 'touch', dragged: false, scrubbing: false };
        // On the window: a drag can be released outside the canvas.
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
    };

    // Outside the chart and the readout: clear a fixed one. The readout is
    // exempt because its source links are the reason it can be fixed at all.
    const onDocDown = (e) => {
        if (mode !== 'fixed') return;
        const t = e.target;
        if (t === canvas || t?.closest?.('.chart-readout')) return;
        clear();
    };

    const keyboardStep = (dir, big) => {
        const xScale = chart.scales.x;
        if (!xScale) return;
        const span = xScale.max - xScale.min;
        const from = keyboardX ?? store.get().x ?? xScale.min + span / 2;
        keyboardX = Math.min(xScale.max, Math.max(xScale.min, from + dir * (span / 100) * (big ? 10 : 1)));
        show(xScale.getPixelForValue(keyboardX), null, mode === 'fixed' ? 'fixed' : 'hover', keyboardX);
    };

    const onKey = (e) => {
        if (e.key === 'Escape') { if (mode !== 'off') { clear(); keyboardX = null; } return; }
        if (e.target !== canvas) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            keyboardStep(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const s = store.get();
            if (mode === 'fixed') { show(s.xPx, null, 'hover', s.x); }
            else if (s.mode === 'hover') show(s.xPx, s.cursorY, 'fixed', s.x);
            else keyboardStep(0, false);
        }
    };

    const onBlur = () => { if (mode === 'hover') clear(); keyboardX = null; };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDocDown, true);

    return () => {
        if (raf) cancelAnimationFrame(raf);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('blur', onBlur);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('pointerdown', onDocDown, true);
        canvas.style.touchAction = priorTouchAction;
        if (priorTabIndex == null) canvas.removeAttribute('tabindex');
        else canvas.setAttribute('tabindex', priorTabIndex);
        // A rebuilt chart starts without a readout: its axes, series or units
        // may be different, and a fixed one would be a stale answer.
        store.actions = null;
        store.set(IDLE);
    };
}
