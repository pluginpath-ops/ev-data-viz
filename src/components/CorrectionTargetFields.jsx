import { useAppContext } from '../context/AppContext';
import InfoIcon from './InfoIcon';
import AccessoryLoadReference from './AccessoryLoadReference';
import {
    CORRECTION_TARGET_RANGES, DEFAULT_CORRECTION_TARGET, normalizeCorrectionTarget, targetDiffers,
    speedText, tempText, altitudeText, accessoryText,
} from '../utils/correctionSettings';
import { effectiveAccessoryW } from '../utils/accessoryLoad';
import { DEFAULT_ACCESSORY_W } from '../constants/epa';

/**
 * What corrected figures are corrected TO: speed, temperature, altitude and
 * accessory load, in calm air (correctionSettings.js). One component for the
 * charts' sidebar (CorrectionControl) and the vehicle table's Assumptions menu,
 * so the two cannot drift into offering different conditions for the same
 * setting.
 *
 * One row per condition — its name, the slider, its value — so a reader sees
 * which slider is which and what it is set to without reading a sentence. The
 * caveats sit behind ⓘ: they matter once, not every time the sidebar is open.
 *
 * The accessory load is the one slider that moves by itself. On AUTO it follows
 * the temperature slider (accessoryLoad.js) and is drawn grey, like a control
 * nobody has touched; the moment the reader drags it, it is theirs, it turns
 * the primary color, and a line beneath says "set by you" with an "auto"
 * action to give it back. That line is under the last row, so it appearing
 * moves nothing the reader is holding. The row is one line like the others:
 * its ⓘ is the heading's, which carries the reference table.
 *
 * Held in mph, °F, ft and W; shown in the reader's units.
 *
 * @param {string[]} [fields]  which conditions to offer. Modeled Efficiency
 *   leaves out 'speedMph': speed is its x axis, so a speed slider would be a
 *   second, contradictory one.
 */
const ROWS = [
    { key: 'speedMph',     label: 'Speed',     text: speedText },
    { key: 'temperatureF', label: 'Temp',      text: tempText },
    { key: 'altitudeFt',   label: 'Altitude',  text: altitudeText },
    // "Accessory Load" in full is in the ⓘ; the row's label column is the width
    // of its longest word, and this one is the longest.
    { key: 'accessoryW',   label: 'Accessory', text: accessoryText },
];

const ABOUT = 'The conditions every corrected range and efficiency figure is moved to, in calm air — the same setting on every chart and the vehicle table. '
    + 'Temperature corrects for air density and for the heating or cooling a test is assumed to have used — no test records it, so it is a rough estimate, and roughest below freezing. Tests outside the composite temperature band are left out of composites. '
    + 'A test that leaves its speed, temperature or altitude blank is corrected from assumed test conditions (an Admin setting), and its note says so; a blank wind is calm air.';

const ACCESSORY_ABOUT = 'Accessory Load: everything the car draws that is not traction: heating, cooling, battery conditioning, lighting. No test records it, so this is a rough estimate, '
    + 'and the same line is assumed for every car — a heat pump draws roughly half a resistive heater. '
    + `Auto follows the temperature: ${DEFAULT_ACCESSORY_W} W while the cabin holds itself, more as heating or A/C is needed. Drag the slider to set it yourself; it then stays put until you press auto. `
    + 'The table is the reference the estimate was read against, and its figures are not yet sourced.';

export default function CorrectionTargetFields({ target, onChange, fields = null }) {
    const { units } = useAppContext();
    const t = normalizeCorrectionTarget(target);
    const shows = (key) => !fields || fields.includes(key);
    const auto = t.accessoryW == null;
    const accessory = CORRECTION_TARGET_RANGES.accessoryW;
    // The accessory slider shows what the load IS: the reader's, or on auto the
    // one the temperature implies, held to the slider.
    const shown = { ...t, accessoryW: Math.min(accessory.max, Math.max(accessory.min, effectiveAccessoryW(t))) };
    return (
        <div className="correction-target">
            <div className="rail-select-row">
                <span className="text-label">Correct to</span>
                <InfoIcon title="Correction target" text={ABOUT}>
                    {shows('accessoryW') && (
                        <>
                            <p>{ABOUT}</p>
                            <p>{ACCESSORY_ABOUT}</p>
                            <AccessoryLoadReference />
                        </>
                    )}
                </InfoIcon>
                {targetDiffers(t) && (
                    <button type="button" className="section-action" onClick={() => onChange(DEFAULT_CORRECTION_TARGET)}>
                        reset
                    </button>
                )}
            </div>
            {ROWS.filter(({ key }) => shows(key)).map(({ key, label, text }) => {
                const { min, max, step } = CORRECTION_TARGET_RANGES[key];
                return (
                    <label key={key} className="correction-target-row">
                        <span className="text-label">{label}</span>
                        <input
                            type="range"
                            className={`assumption-slider${key === 'accessoryW' && auto ? ' is-auto' : ''}`}
                            aria-label={key === 'accessoryW' ? 'Accessory load in watts' : undefined}
                            min={min}
                            max={max}
                            step={step}
                            value={shown[key]}
                            onChange={e => onChange({ ...t, [key]: Number(e.target.value) })}
                        />
                        <span className="text-label correction-target-value">{text(key === 'accessoryW' ? shown[key] : t[key], units)}</span>
                    </label>
                );
            })}
            {shows('accessoryW') && !auto && (
                <div className="rail-select-row">
                    <span className="text-meta">Accessory Load set by you</span>
                    <button type="button" className="section-action" onClick={() => onChange({ ...t, accessoryW: null })}>
                        auto
                    </button>
                </div>
            )}
        </div>
    );
}
