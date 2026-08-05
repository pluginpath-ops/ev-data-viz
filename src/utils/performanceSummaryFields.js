/**
 * The scalar fields of a published performance result, in entry order.
 *
 * Shared by the summary card (which renders them as editable fields) and the
 * paste preview (which renders what a parse would write into them). Keeping one
 * list means a label, unit or tooltip can't say one thing in the editor and
 * another in the preview of the same field.
 *
 * Speed windows are NOT here — they vary by source and live in
 * performance_intervals. See PerformanceIntervals.jsx.
 */
export const SUMMARY_FIELDS = [
    {
        key: 'zero_to_60_sec', label: '0–60 mph', unit: 's', step: '0.001',
        tooltip: 'Clock starts at 0 mph, with no rollout allowance. Sources differ on which of the two 0–60 figures they headline — check the source’s own footnote before entering.',
    },
    {
        key: 'zero_to_60_rollout_sec', label: '0–60 (1ft)', unit: 's', step: '0.001',
        tooltip: 'The 1-foot-rollout figure, drag-strip convention — about 0.3 s quicker than the no-rollout time. The two are not interchangeable.',
    },
    {
        key: 'zero_to_100_sec', label: '0–100 mph', unit: 's', step: '0.001',
        tooltip: 'Time to 100 mph, on whichever rollout convention the source uses for its 0–60.',
    },
    { key: 'quarter_mile_sec',      label: '¼ mile',       unit: 's',   step: '0.001' },
    { key: 'quarter_mile_trap_mph', label: '¼ mile trap',  unit: 'mph', step: '0.01'  },
    { key: 'eighth_mile_sec',       label: '⅛ mile',       unit: 's',   step: '0.001' },
    { key: 'eighth_mile_trap_mph',  label: '⅛ mile trap',  unit: 'mph', step: '0.01'  },
    {
        key: 'top_speed_mph', label: 'Top speed', unit: 'mph', step: '0.1',
        tooltip: 'Measured top speed. Often governor-limited rather than aerodynamically limited.',
    },
    {
        key: 'skidpad_g', label: 'Skidpad', unit: 'g', step: '0.001',
        tooltip: 'Lateral grip, conventionally measured on a 300 ft skidpad.',
    },
];

/** Label + unit for one column key, for messages and preview rows. */
export const summaryFieldLabel = (key) => {
    const f = SUMMARY_FIELDS.find(x => x.key === key);
    return f ? f : { key, label: key, unit: '' };
};
