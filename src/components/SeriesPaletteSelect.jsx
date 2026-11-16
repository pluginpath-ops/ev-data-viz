import { SERIES_PALETTES, VEHICLE_PALETTE, DEFAULT_SERIES_PALETTE, paletteColorsById } from '../utils/colorUtils';

/**
 * Where a chart's series colors come from — the Colors field in the chart's
 * toolbar, beside Link and Image.
 *
 * This replaces the "Auto Color" checkbox, which described its mechanism rather
 * than its effect and then read backwards once vehicles owned their colors
 * (#308). A dropdown rather than a renamed checkbox because the choice was
 * never binary: `SERIES_PALETTES` holds several sets, and Vehicle color is one
 * more answer to the same question.
 *
 * In the toolbar rather than the run picker because the palette is a property
 * of the PLOT — of what the PNG captures — and the toolbar is the plot's own
 * row. The run picker keeps one line about it (ColorSourceNote): the hint that
 * vehicle colors exist while a palette is in force, and the notice that picks
 * have taken over once they have, which is where those picks are made.
 *
 * EVBench leads because it is the default; Vehicle color follows directly so
 * the alternative is the first thing the list offers.
 */
/** The value that means "my picks, over whatever base is selected". */
export const HAND_SET = '__hand-set';

/** The palettes in offer order: the default, Vehicle color, then the rest. */
const OPTIONS = [
    ...SERIES_PALETTES.filter(p => p.id === DEFAULT_SERIES_PALETTE),
    { id: VEHICLE_PALETTE, label: 'Vehicle color' },
    ...SERIES_PALETTES.filter(p => p.id !== DEFAULT_SERIES_PALETTE),
];

export const paletteLabel = (id) => OPTIONS.find(p => p.id === id)?.label ?? id;

export default function SeriesPaletteSelect({
    palette = DEFAULT_SERIES_PALETTE, handSet = false, handSetCount = 0, setChartConfig,
}) {
    // Offered only once there is something to apply, and it stops being the
    // selected value the moment the last pick is released — computed rather
    // than stored, so `handSet` left true over an empty map cannot strand the
    // control on a mode that would do nothing.
    const offered = handSetCount > 0;
    const active = handSet && offered;

    /**
     * One field, two pieces of state — the base and the pick layer. Read as
     * "what is the plot showing right now?" the field has one answer, and
     * making it the whole control is what lets it double as revert and
     * reapply: select a palette to set the picks aside, select Hand-set to
     * bring them back.
     */
    const choose = (value) => setChartConfig(prev => (
        value === HAND_SET
            ? { ...prev, handSet: true }
            // Choosing a base turns the layer off but does NOT clear it.
            // Parking is not discarding.
            : { ...prev, seriesPalette: value, handSet: false }
    ));

    // A few of the palette's first colors inside the field, so the choice reads
    // without opening it. Vehicle color has no fixed set to show.
    const preview = active ? null : (paletteColorsById(palette) ?? []).slice(0, 4);

    return (
        <label className="chart-colors-field" title="Where each series takes its color from">
            <span className="text-label">Colors</span>
            {/* Orange outline and dot while picks are in force: the "applied /
                now" signal Reset zoom already uses, so a plot drawn in hand-set
                colors says so from the toolbar too. */}
            <span className={`chart-colors-box${active ? ' chart-colors-box--hand-set' : ''}`}>
                {active && <span className="applied-dot" aria-hidden="true" />}
                {preview?.length > 0 && (
                    <span className="chart-colors-preview" aria-hidden="true">
                        {preview.map((c, i) => <i key={i} style={{ backgroundColor: c }} />)}
                    </span>
                )}
                <select
                    value={active ? HAND_SET : palette}
                    onChange={e => choose(e.target.value)}
                >
                    {offered && (
                        <option value={HAND_SET}>Hand-set ({handSetCount}) over {paletteLabel(palette)}</option>
                    )}
                    {OPTIONS.map(p => (
                        // No safety mark here: a bare "·" after a name is a
                        // legend with no key. The color panel says
                        // "(not colorblind-safe)" in words.
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                </select>
            </span>
        </label>
    );
}
