import { SERIES_PALETTES, VEHICLE_PALETTE } from '../utils/colorUtils';

/**
 * Where a chart's series colours come from.
 *
 * This replaces the "Auto Color" checkbox, which described its mechanism rather
 * than its effect and then read backwards once vehicles owned their colours
 * (#308): OFF gave each car its curated colour with its tests shaded off it, and
 * switching auto ON threw that away for maximum contrast. A control whose "on"
 * discards curation should not be the one named after the automatic, sensible
 * thing.
 *
 * A dropdown rather than a renamed checkbox because the choice was never binary.
 * `SERIES_PALETTES` has held six sets since #303, and the picker could already
 * switch between them — but only inside its own popover, and `resolveChartColors`
 * ignored the choice and assigned Okabe-Ito anyway (#307). The palette is a
 * property of the PLOT, so it belongs in the plot's controls, and putting it
 * here is what lets one field answer "where do these colours come from?" instead
 * of a checkbox and a popover disagreeing about it.
 *
 * Vehicle Colour leads because it is the default and the one that carries
 * meaning; the palettes below it are for when contrast matters more than
 * identity — a screenshot, or a plot of one car's many tests where every series
 * shares a base and telling them apart is the whole job.
 */
export default function SeriesPaletteSelect({ palette = VEHICLE_PALETTE, setChartConfig }) {
    return (
        <label className="toggle-label" title="Where each series takes its colour from">
            <span className="text-label">Colours</span>
            <select
                className="form-input"
                value={palette}
                onChange={e => setChartConfig(prev => ({ ...prev, seriesPalette: e.target.value }))}
            >
                <option value={VEHICLE_PALETTE}>Vehicle colour</option>
                {SERIES_PALETTES.map(p => (
                    // The colourblind-safe mark travels with the palette rather
                    // than being explained once somewhere else — the moment you
                    // need it is the moment you are choosing.
                    <option key={p.id} value={p.id}>{p.label}{p.safe ? '' : ' ·'}</option>
                ))}
            </select>
        </label>
    );
}
