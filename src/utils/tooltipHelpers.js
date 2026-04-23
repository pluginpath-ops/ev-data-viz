import { fmtSpeed, fmtTemp, fmtDistance } from './unitConversions';

/**
 * Builds the afterLabel lines array for Chart.js tooltips.
 * Sections: Run specifics → Chart specifics (caller-provided).
 * Returns a flat array of strings; empty strings act as spacers.
 *
 * @param {object|null} run  - Run object with optional: source, speed_mph, temperature_f
 * @param {string[]} chartLines - Additional lines for the chart-specifics section.
 * @param {string} units - 'imperial' | 'metric'
 */
export function runTooltipLines(run, chartLines = [], units = 'imperial') {
    const lines = [];

    // ── Run specifics ──────────────────────────────────────────────────────────
    const runSection = [];
    if (run?.source)               runSection.push(`Source: ${run.source}`);
    if (run?.speed_mph     != null) runSection.push(`Speed: ${fmtSpeed(run.speed_mph, units)}`);
    if (run?.temperature_f != null) runSection.push(`Temp: ${fmtTemp(run.temperature_f, units)}`);
    if (runSection.length) lines.push(...runSection);

    // ── Chart specifics ────────────────────────────────────────────────────────
    if (chartLines.length) {
        if (lines.length) lines.push('');
        lines.push(...chartLines);
    }

    return lines;
}
