import { fmtSpeed, fmtTemp, fmtDistance } from './unitConversions';

/**
 * Builds the afterLabel lines array for Chart.js tooltips.
 * Sections: Run specifics → Model specifics (trim) → Chart specifics (caller-provided).
 * Returns a flat array of strings; empty strings act as spacers.
 *
 * @param {object|null} run  - Run object, expected to have optional fields:
 *   source, speed_mph, temperature_f, _trim (with name, wheel_size, tire_size, epa_range_miles)
 * @param {string[]} chartLines - Additional lines for the chart-specifics section.
 * @param {string} units - 'imperial' | 'metric'
 */
export function runTooltipLines(run, chartLines = [], units = 'imperial') {
    const lines = [];

    // ── Run specifics ──────────────────────────────────────────────────────────
    const runSection = [];
    if (run?.source)                runSection.push(`Source: ${run.source}`);
    if (run?.speed_mph      != null) runSection.push(`Speed: ${fmtSpeed(run.speed_mph, units)}`);
    if (run?.temperature_f  != null) runSection.push(`Temp: ${fmtTemp(run.temperature_f, units)}`);
    if (runSection.length) lines.push(...runSection);

    // ── Model specifics (trim) ─────────────────────────────────────────────────
    const trimSection = [];
    if (run?._trim?.name)            trimSection.push(`Trim: ${run._trim.name}`);
    const tireStr = [run?._trim?.wheel_size, run?._trim?.tire_size].filter(Boolean).join(' / ');
    if (tireStr)                     trimSection.push(`Tires: ${tireStr}`);
    if (run?._trim?.epa_range_miles != null) trimSection.push(`EPA Range: ${fmtDistance(run._trim.epa_range_miles, units)}`);
    if (trimSection.length) {
        if (lines.length) lines.push('');
        lines.push(...trimSection);
    }

    // ── Chart specifics ────────────────────────────────────────────────────────
    if (chartLines.length) {
        if (lines.length) lines.push('');
        lines.push(...chartLines);
    }

    return lines;
}
