/**
 * A fill of diagonal stripes for a Chart.js bar: `stripe` lines over a
 * `base` ground, on an 8 px tile. Marks a part of a bar as a different kind of
 * the same thing — a fast stop inside the day's driving, fast charging on top
 * of home charging — where a shade alone reads as a faded copy (owner,
 * 2026-11-08).
 *
 * Returns `stripe` itself where there is no document to draw on (tests).
 */
import { desaturate, withAlpha } from './colorUtils';

export function stripedFill(base, stripe, { width = 3 } = {}) {
    if (typeof document === 'undefined') return stripe;
    // Drawn at the screen's pixel density and scaled back, so the stripes are
    // as sharp as the chart. Each line runs past the tile's corners: one that
    // stopped at them left a notch where tiles met, a bead every 8 px.
    const dpr = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
    const c = document.createElement('canvas');
    c.width = c.height = 8 * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = base;
    g.fillRect(0, 0, 8, 8);
    g.strokeStyle = stripe;
    g.lineWidth = width;
    g.beginPath();
    for (const o of [-8, 0, 8]) { g.moveTo(o - 2, 10); g.lineTo(o + 10, -2); }
    g.stroke();
    const pattern = g.createPattern(c, 'repeat');
    if (!pattern) return stripe;
    if (dpr > 1 && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix().scale(1 / dpr));
    return pattern;
}

/**
 * A car's fast charging on the Cost & Time stacked bars: its full color striped
 * over a faded ground — the shade desaturated and half see-through, so the
 * stripes stand out against it (owner, 2026-11-08: "slightly more contrasted").
 */
export const fastChargingFill = (color) => stripedFill(withAlpha(desaturate(color, 0.15), 0.5), color);
