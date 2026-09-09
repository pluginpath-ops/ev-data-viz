import { SERIES_PALETTES, VEHICLE_PALETTE } from '../utils/colorUtils';

/**
 * Where a chart's series colors come from.
 *
 * This replaces the "Auto Color" checkbox, which described its mechanism rather
 * than its effect and then read backwards once vehicles owned their colors
 * (#308): OFF gave each car its curated color with its tests shaded off it, and
 * switching auto ON threw that away for maximum contrast. A control whose "on"
 * discards curation should not be the one named after the automatic, sensible
 * thing.
 *
 * A dropdown rather than a renamed checkbox because the choice was never binary.
 * `SERIES_PALETTES` has held six sets since #303, and the picker could already
 * switch between them — but only inside its own popover, and `resolveChartColors`
 * ignored the choice and assigned Okabe-Ito anyway (#307). The palette is a
 * property of the PLOT, so it belongs in the plot's controls, and putting it
 * here is what lets one field answer "where do these colors come from?" instead
 * of a checkbox and a popover disagreeing about it.
 *
 * Vehicle Color leads because it is the default and the one that carries
 * meaning; the palettes below it are for when contrast matters more than
 * identity — a screenshot, or a plot of one car's many tests where every series
 * shares a base and telling them apart is the whole job.
 */
export default function SeriesPaletteSelect({ palette = VEHICLE_PALETTE, setChartConfig }) {
    return (
        // Labelled, and in the same row shape as the correction picker beneath
        // it. The options name themselves well enough to stand alone, but the
        // two selects sit together in the Display group and a labelled control
        // above an unlabelled one reads as two unrelated things rather than a
        // block of settings — so context, not the field, is what earns the word.
        <label className="rail-select-row" title="Where each series takes its color from">
            <span className="text-label">Colors:</span>
            <select
                className="form-input"
                value={palette}
                onChange={e => setChartConfig(prev => ({ ...prev, seriesPalette: e.target.value }))}
            >
                    <option value={VEHICLE_PALETTE}>Vehicle color</option>
                {SERIES_PALETTES.map(p => (
                    // No safety mark here. A bare "·" after a name is a legend
                    // with no key: it cannot say WHICH property it is marking,
                    // and a reader who does not already know is told nothing. The
                    // colour panel has room to say "(not colorblind-safe)" in
                    // words, so that is where it says it.
                    <option key={p.id} value={p.id}>{p.label}</option>
                ))}
            </select>
        </label>
    );
}
