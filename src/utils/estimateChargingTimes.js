import { interpolate } from './interpolate';
import { roundTo } from './unitConversions';

/**
 * Estimate elapsed time values for charging data points using power integration
 * calibrated by anchor (SoC, elapsed-time) pairs.
 *
 * The raw integration of time from kW is noisy; anchors provide known reference
 * points to scale the curve. For each segment between adjacent anchors a separate
 * scale factor is applied, so error correction is local rather than global.
 *
 * @param {Object}  opts
 * @param {Array}   opts.dataPoints   - run data points [{soc, chargeRate, ...}]
 * @param {number}  opts.batteryKwh   - usable battery capacity (kWh)
 * @param {Array}   opts.anchors      - [{soc: number, timeMin: number}, ...] — ≥2 required
 * @param {boolean} opts.shiftToZero  - if true, shift output so min time = 0
 * @returns {{ points: Array<{soc, time}>, warnings: string[] }}
 */
export function estimateChargingTimes({ dataPoints, batteryKwh, anchors, shiftToZero = false }) {
    const warnings = [];

    // ── Validate inputs ────────────────────────────────────────────────────────
    if (!batteryKwh || isNaN(Number(batteryKwh)) || Number(batteryKwh) <= 0)
        throw new Error('Vehicle battery capacity (kWh) is required');
    const kWh = Number(batteryKwh);

    // Filter to points that have both soc and chargeRate, clamp negative kW to 0
    const valid = (dataPoints || [])
        .filter(p => p.soc != null && p.chargeRate != null)
        .map(p => ({ ...p, soc: Number(p.soc), chargeRate: Math.max(0, Number(p.chargeRate)) }));

    // Sort by SoC ascending; deduplicate (keep first occurrence per SoC)
    const seenSoc = new Set();
    const sorted = [];
    for (const p of [...valid].sort((a, b) => a.soc - b.soc)) {
        if (seenSoc.has(p.soc)) {
            warnings.push(`Duplicate SoC=${p.soc}% — keeping first occurrence`);
        } else {
            seenSoc.add(p.soc);
            sorted.push(p);
        }
    }

    if (sorted.length < 2)
        throw new Error('Need at least 2 data points with both soc and chargeRate populated');

    // Parse and validate anchors
    const sortedAnchors = [...(anchors || [])]
        .filter(a => a.soc !== '' && a.timeMin !== ''
            && !isNaN(Number(a.soc)) && !isNaN(Number(a.timeMin)))
        .map(a => ({ soc: Number(a.soc), timeMin: Number(a.timeMin) }))
        .sort((a, b) => a.soc - b.soc);

    if (sortedAnchors.length < 2)
        throw new Error('At least 2 valid anchor points are required');

    for (let i = 1; i < sortedAnchors.length; i++) {
        if (sortedAnchors[i].timeMin < sortedAnchors[i - 1].timeMin)
            warnings.push(`Anchor times not monotone at SoC ${sortedAnchors[i].soc}% — result may be unexpected`);
    }

    // ── Build raw cumulative time curve (trapezoidal integration) ──────────────
    // Handles variable SoC step sizes correctly via delta_soc in the formula.
    const cumRaw = new Array(sorted.length).fill(0);
    for (let i = 1; i < sorted.length; i++) {
        const deltaSoc = sorted[i].soc - sorted[i - 1].soc;
        const avgKw    = (sorted[i].chargeRate + sorted[i - 1].chargeRate) / 2;
        const deltaT   = avgKw > 0 ? (kWh * deltaSoc / 100) / avgKw * 60 : 0;
        cumRaw[i]      = cumRaw[i - 1] + deltaT;
    }

    // Helper: interpolate cumRaw at any SoC using the existing utility
    const curvePoints = sorted.map((p, i) => ({ soc: p.soc, cumRaw: cumRaw[i] }));
    const cumRawAtSoc = (s) => interpolate(curvePoints, 'soc', 'cumRaw', s, true, true);

    // ── Compute per-segment scale factors ──────────────────────────────────────
    const segments = sortedAnchors.slice(0, -1).map((A, i) => {
        const B       = sortedAnchors[i + 1];
        const rawSpan = cumRawAtSoc(B.soc) - cumRawAtSoc(A.soc);
        let scale = 1.0;
        if (rawSpan <= 0) {
            warnings.push(`Anchor pair [${A.soc}%→${B.soc}%] has zero raw time span — using scale 1.0`);
        } else {
            scale = (B.timeMin - A.timeMin) / rawSpan;
            if (scale <= 0) {
                warnings.push(`Scale factor ${scale.toFixed(2)} is invalid — clamping to 0.01`);
                scale = 0.01;
            } else if (scale > 10 || scale < 0.1) {
                warnings.push(`Scale factor ${scale.toFixed(2)} is unusual — verify anchor values`);
            }
        }
        return { A, B, scale, rawAtA: cumRawAtSoc(A.soc) };
    });

    // ── Assign calibrated time to each data point ──────────────────────────────
    const calibrated = sorted.map(p => {
        let seg, baseAnchor;
        if (p.soc < sortedAnchors[0].soc) {
            seg = segments[0];
            baseAnchor = seg.A;
        } else if (p.soc >= sortedAnchors[sortedAnchors.length - 1].soc) {
            seg = segments[segments.length - 1];
            baseAnchor = seg.B;
        } else {
            seg = segments.find(s => p.soc >= s.A.soc && p.soc < s.B.soc);
            baseAnchor = seg.A;
        }
        const t = baseAnchor.timeMin + (cumRawAtSoc(p.soc) - cumRawAtSoc(baseAnchor.soc)) * seg.scale;
        return roundTo(t, 1);
    });

    // ── Optional: shift so minimum time = 0 ───────────────────────────────────
    const minT  = Math.min(...calibrated);
    const times = shiftToZero
        ? calibrated.map(t => roundTo(t - minT, 1))
        : calibrated;

    return {
        points: sorted.map((p, i) => ({ soc: p.soc, chargeRate: p.chargeRate, time: times[i] })),
        warnings,
    };
}
