import { interpolate } from './interpolate';
import { roundTo } from './unitConversions';

/**
 * Derive a missing charging axis (time, SoC, or power) from the two columns that
 * ARE present, using battery capacity as the bridge between state (SoC), rate
 * (power), and time:
 *
 *     Energy (kWh) = Power (kW) × Time (h)        SoC (%) = Energy / C × 100
 *
 * Three modes, all sharing one engine:
 *
 *   target 'time'  — integrate elapsed time from (SoC, power) over the SoC axis.
 *                    dt = (C·dSoC/100) / P                    [the original estimator]
 *   target 'soc'   — integrate SoC from (time, power) over the time axis.
 *                    dSoC = 100·P·dt / C
 *   target 'power' — differentiate power from (SoC, time).
 *                    P = (C·dSoC/100) / dt
 *
 * For the two integration targets the raw integral recovers only the *shape*; it
 * is pinned to absolute values by anchors — known (domain, target) reference
 * pairs. A single anchor fixes the origin (scale = 1, pure physics); two or more
 * additionally rescale the curve per-segment so it lands on the known endpoints
 * (this is how an end-SoC or measured split time calibrates out capacity /
 * efficiency error). With no anchors at all, a 'time' curve still has a natural
 * origin (0 at the first point) so it integrates directly; a 'soc' curve has no
 * natural origin and requires at least one.
 *
 * @param {Object}  opts
 * @param {Array}   opts.dataPoints  - run data points [{soc, chargeRate, time, ...}]
 * @param {number}  opts.batteryKwh  - usable battery capacity (kWh)
 * @param {'time'|'soc'|'power'} opts.target - which column to derive
 * @param {Array}   [opts.anchors]   - [{x, y}] where x = domain value, y = target
 *                                      value (ignored for 'power')
 * @param {boolean} [opts.shiftToZero] - shift integration output so its min = 0
 * @returns {{ points: Array, warnings: string[], effectiveKwh: number|null }}
 */
export function deriveChargingAxis({ dataPoints, batteryKwh, target, anchors = [], shiftToZero = false, chargingLoss = 0.05 }) {
    if (!['time', 'soc', 'power'].includes(target))
        throw new Error(`Unknown derive target "${target}"`);

    if (!batteryKwh || isNaN(Number(batteryKwh)) || Number(batteryKwh) <= 0)
        throw new Error('Vehicle battery capacity (kWh) is required');
    const kWh = Number(batteryKwh);

    // Charging efficiency η: reported kW is charger-side, but only η of it lands
    // in the pack. Without it, times run ~5–10% optimistic vs. measured. Clamp
    // the loss to a sane band so a fat-fingered value can't invert the physics.
    const loss = isNaN(Number(chargingLoss)) ? 0 : Math.min(Math.max(Number(chargingLoss), 0), 0.5);
    const eta = 1 - loss;

    if (target === 'power') return derivePowerCurve({ dataPoints, kWh, eta });
    return deriveIntegral({ dataPoints, kWh, target, anchors, shiftToZero, eta });
}

// ── Per-target field + formula config for the integration engine ───────────────
// η is the charging efficiency (pack-side energy ÷ charger-side energy).
const INTEGRAL = {
    time: {
        domain: 'soc', rate: 'chargeRate', out: 'time',
        domainLabel: 'SoC', targetLabel: 'time',
        // dt in minutes from energy / (usable power). Losses shrink usable power,
        // so time grows by 1/η.
        delta: (dDomain, avgRate, kWh, eta) => (avgRate > 0 ? (kWh * dDomain / 100) / (avgRate * eta) * 60 : 0),
        // calibration scale s on a time curve means effective capacity = C·s
        effKwh: (kWh, scale) => kWh * scale,
    },
    soc: {
        domain: 'time', rate: 'chargeRate', out: 'soc',
        domainLabel: 'time', targetLabel: 'SoC',
        // dSoC in percent from usable energy (η · power × hours) / capacity
        delta: (dDomain, avgRate, kWh, eta) => (avgRate * eta) * (dDomain / 60) / kWh * 100,
        // calibration scale s on a SoC curve means effective capacity = C/s
        effKwh: (kWh, scale) => kWh / scale,
    },
};

function deriveIntegral({ dataPoints, kWh, target, anchors, shiftToZero, eta }) {
    const cfg = INTEGRAL[target];
    const warnings = [];

    // ── Collect points carrying both the domain axis and the rate ──────────────
    const valid = (dataPoints || [])
        .filter(p => p[cfg.domain] != null && p[cfg.rate] != null)
        .map(p => ({
            [cfg.domain]: Number(p[cfg.domain]),
            [cfg.rate]:   Math.max(0, Number(p[cfg.rate])),
        }));

    // Sort by domain ascending; deduplicate (keep first per domain value)
    const seen = new Set();
    const sorted = [];
    for (const p of [...valid].sort((a, b) => a[cfg.domain] - b[cfg.domain])) {
        if (seen.has(p[cfg.domain]))
            warnings.push(`Duplicate ${cfg.domainLabel}=${p[cfg.domain]} — keeping first occurrence`);
        else { seen.add(p[cfg.domain]); sorted.push(p); }
    }

    if (sorted.length < 2)
        throw new Error(`Need at least 2 data points with both ${cfg.domainLabel} and power populated`);

    // ── Raw cumulative target curve (trapezoidal, variable step) ───────────────
    const cumRaw = new Array(sorted.length).fill(0);
    for (let i = 1; i < sorted.length; i++) {
        const dDomain = sorted[i][cfg.domain] - sorted[i - 1][cfg.domain];
        const avgRate = (sorted[i][cfg.rate] + sorted[i - 1][cfg.rate]) / 2;
        cumRaw[i] = cumRaw[i - 1] + cfg.delta(dDomain, avgRate, kWh, eta);
    }
    const curvePoints = sorted.map((p, i) => ({ d: p[cfg.domain], cumRaw: cumRaw[i] }));
    const cumRawAt = (d) => interpolate(curvePoints, 'd', 'cumRaw', d, true, true);

    // ── Normalize anchors → {x: domain, y: target}, sorted by x ────────────────
    const sortedAnchors = (anchors || [])
        .filter(a => a.x !== '' && a.y !== '' && !isNaN(Number(a.x)) && !isNaN(Number(a.y)))
        .map(a => ({ x: Number(a.x), y: Number(a.y) }))
        .sort((a, b) => a.x - b.x);

    // ── Resolve the origin when no explicit anchors were given ─────────────────
    if (sortedAnchors.length === 0) {
        if (target === 'time') {
            // Natural origin: t = 0 at the first (lowest-SoC) point. Pure physics.
            sortedAnchors.push({ x: sorted[0][cfg.domain], y: 0 });
        } else {
            // SoC has no natural origin — caller must supply a start value.
            throw new Error('Provide a start SoC (one anchor) to derive SoC from time + power');
        }
    }

    for (let i = 1; i < sortedAnchors.length; i++) {
        if (sortedAnchors[i].y < sortedAnchors[i - 1].y)
            warnings.push(`Anchor ${cfg.targetLabel} values not monotone at ${cfg.domainLabel} ${sortedAnchors[i].x} — result may be unexpected`);
    }

    // ── Per-segment scale factors (1 anchor ⇒ pure physics, scale = 1) ─────────
    const segments = sortedAnchors.length < 2
        ? [{ A: sortedAnchors[0], B: sortedAnchors[0], scale: 1.0 }]
        : sortedAnchors.slice(0, -1).map((A, i) => {
            const B = sortedAnchors[i + 1];
            const rawSpan = cumRawAt(B.x) - cumRawAt(A.x);
            let scale = 1.0;
            if (rawSpan <= 0) {
                warnings.push(`Anchor pair [${A.x}→${B.x} ${cfg.domainLabel}] has zero raw span — using scale 1.0`);
            } else {
                scale = (B.y - A.y) / rawSpan;
                if (scale <= 0) {
                    warnings.push(`Scale factor ${scale.toFixed(2)} is invalid — clamping to 0.01`);
                    scale = 0.01;
                } else if (scale > 10 || scale < 0.1) {
                    warnings.push(`Scale factor ${scale.toFixed(2)} is unusual — verify anchor values`);
                }
            }
            return { A, B, scale };
        });

    // ── Effective-capacity QC: what capacity/efficiency does calibration imply? ─
    let effectiveKwh = null;
    if (sortedAnchors.length >= 2) {
        const first = sortedAnchors[0], last = sortedAnchors[sortedAnchors.length - 1];
        const rawSpan = cumRawAt(last.x) - cumRawAt(first.x);
        if (rawSpan > 0) {
            const overall = (last.y - first.y) / rawSpan;
            effectiveKwh = roundTo(cfg.effKwh(kWh, overall), 1);
            if (Math.abs(overall - 1) > 0.05)
                warnings.push(`Calibration implies an effective capacity of ≈${effectiveKwh} kWh (vs ${kWh} kWh stated) — power may be measured before charging losses, or stated capacity is off.`);
        }
    }

    // ── Assign calibrated target value to each point ───────────────────────────
    const assign = (d) => {
        let seg, base;
        if (segments.length === 1) {
            seg = segments[0]; base = seg.A;
        } else if (d < sortedAnchors[0].x) {
            seg = segments[0]; base = seg.A;
        } else if (d >= sortedAnchors[sortedAnchors.length - 1].x) {
            seg = segments[segments.length - 1]; base = seg.B;
        } else {
            seg = segments.find(s => d >= s.A.x && d < s.B.x); base = seg.A;
        }
        return base.y + (cumRawAt(d) - cumRawAt(base.x)) * seg.scale;
    };

    let outVals = sorted.map(p => assign(p[cfg.domain]));
    if (shiftToZero) {
        const minV = Math.min(...outVals);
        outVals = outVals.map(v => v - minV);
    }
    outVals = outVals.map(v => roundTo(v, target === 'soc' ? 2 : 1));

    return {
        points: sorted.map((p, i) => ({
            [cfg.domain]: p[cfg.domain],
            chargeRate:   p[cfg.rate],
            [cfg.out]:    outVals[i],
        })),
        warnings,
        effectiveKwh,
    };
}

// ── Power from (SoC, time): differentiate energy w.r.t. time ───────────────────
function derivePowerCurve({ dataPoints, kWh, eta = 1 }) {
    const warnings = [];

    const valid = (dataPoints || [])
        .filter(p => p.soc != null && p.time != null)
        .map(p => ({ soc: Number(p.soc), time: Number(p.time) }));

    const seen = new Set();
    const sorted = [];
    for (const p of [...valid].sort((a, b) => a.soc - b.soc)) {
        if (seen.has(p.soc))
            warnings.push(`Duplicate SoC=${p.soc}% — keeping first occurrence`);
        else { seen.add(p.soc); sorted.push(p); }
    }

    if (sorted.length < 2)
        throw new Error('Need at least 2 data points with both SoC and time populated');

    // Average kW across each SoC interval = energy added / elapsed time.
    const segKw = new Array(sorted.length - 1).fill(null);
    for (let i = 1; i < sorted.length; i++) {
        const dSoC = sorted[i].soc - sorted[i - 1].soc;
        const dMin = sorted[i].time - sorted[i - 1].time;
        if (dMin <= 0)
            warnings.push(`Non-increasing time between SoC ${sorted[i - 1].soc}% and ${sorted[i].soc}% — segment skipped`);
        else
            // dSoC reflects pack-side energy; divide by η to report charger-side kW.
            segKw[i - 1] = (kWh * dSoC / 100) / (dMin / 60) / eta;
    }

    // Per-point power = central average of the segments on either side.
    const points = sorted.map((p, i) => {
        const adj = [segKw[i - 1], segKw[i]].filter(v => v != null);
        const kw = adj.length ? adj.reduce((a, b) => a + b, 0) / adj.length : null;
        return { soc: p.soc, time: p.time, chargeRate: kw == null ? null : roundTo(kw, 2) };
    }).filter(p => p.chargeRate != null);

    if (points.length === 0)
        throw new Error('Could not derive power — need at least one interval with increasing time');

    return { points, warnings, effectiveKwh: null };
}
