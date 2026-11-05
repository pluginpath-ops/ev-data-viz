import { VEHICLE_PALETTE } from '../utils/colorUtils';
import { paletteLabel } from './SeriesPaletteSelect';

/**
 * One line at the top of the run picker about where the series colors come
 * from. The Colors field itself lives in the chart's toolbar (SeriesPaletteSelect);
 * this is the run picker's half, beside the swatches where colors are picked.
 *
 * It says one of three things, and only ever one:
 *   - hand-set mode: your picks override the Colors field (orange dot), with
 *     Clear picks to drop them;
 *   - a palette in force: the hint that each vehicle has its own color, one
 *     click away;
 *   - Vehicle color: nothing — the swatches already show each car's color.
 */
export default function ColorSourceNote({
    palette, handSet = false, handSetCount = 0, setChartConfig, onClearHandSet,
}) {
    if (!setChartConfig) return null;
    const active = handSet && handSetCount > 0;

    if (active) {
        return (
            <p className="color-source-note">
                <span className="applied-dot" aria-hidden="true" />
                <span>
                    Your {handSetCount} picked {handSetCount === 1 ? 'color overrides' : 'colors override'} the
                    Colors field above the chart
                    {onClearHandSet && (
                        <>
                            {' · '}
                            <button type="button" className="color-source-link" onClick={onClearHandSet}>
                                Clear picks
                            </button>
                        </>
                    )}
                </span>
            </p>
        );
    }

    if (palette === VEHICLE_PALETTE) return null;

    return (
        <p className="color-source-note">
            <span>
                Colors: {paletteLabel(palette)} palette ·{' '}
                <button
                    type="button"
                    className="color-source-link"
                    onClick={() => setChartConfig(prev => ({ ...prev, seriesPalette: VEHICLE_PALETTE, handSet: false }))}
                >
                    Use each vehicle&apos;s own color
                </button>
            </span>
        </p>
    );
}
