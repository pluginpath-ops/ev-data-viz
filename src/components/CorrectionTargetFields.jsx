import { useAppContext } from '../context/AppContext';
import InfoIcon from './InfoIcon';
import {
    CORRECTION_TARGET_RANGES, DEFAULT_CORRECTION_TARGET, normalizeCorrectionTarget, targetDiffers,
    speedText, tempText, altitudeText,
} from '../utils/correctionSettings';

/**
 * What corrected figures are corrected TO: speed, temperature and altitude,
 * in calm air (correctionSettings.js). One component for the charts' sidebar
 * (CorrectionControl) and the vehicle table's Assumptions menu, so the two
 * cannot drift into offering different conditions for the same setting.
 *
 * One row per condition — its name, the slider, its value — so a reader sees
 * which slider is which and what it is set to without reading a sentence. The
 * caveats sit behind ⓘ: they matter once, not every time the sidebar is open.
 *
 * Held in mph, °F and ft; shown in the reader's units.
 */
const ROWS = [
    { key: 'speedMph',     label: 'Speed',    text: speedText },
    { key: 'temperatureF', label: 'Temp',     text: tempText },
    { key: 'altitudeFt',   label: 'Altitude', text: altitudeText },
];

const ABOUT = 'The conditions every corrected range and efficiency figure is moved to, in calm air — the same setting on every chart and the vehicle table. '
    + 'Temperature corrects only for air density, so it stays mild: a cold test’s heating losses are not modelled, and those tests are left out of composites rather than corrected. '
    + 'A test that leaves its speed, temperature or altitude blank is corrected from assumed test conditions (an Admin setting), and its note says so; a blank wind is calm air.';

export default function CorrectionTargetFields({ target, onChange }) {
    const { units } = useAppContext();
    const t = normalizeCorrectionTarget(target);
    return (
        <div className="correction-target">
            <div className="rail-select-row">
                <span className="text-label">Correct to</span>
                <InfoIcon title="Correction target" text={ABOUT} />
                {targetDiffers(t) && (
                    <button type="button" className="section-action" onClick={() => onChange(DEFAULT_CORRECTION_TARGET)}>
                        reset
                    </button>
                )}
            </div>
            {ROWS.map(({ key, label, text }) => {
                const { min, max, step } = CORRECTION_TARGET_RANGES[key];
                return (
                    <label key={key} className="correction-target-row">
                        <span className="text-label">{label}</span>
                        <input
                            type="range"
                            className="assumption-slider"
                            min={min}
                            max={max}
                            step={step}
                            value={t[key]}
                            onChange={e => onChange({ ...t, [key]: Number(e.target.value) })}
                        />
                        <span className="text-label correction-target-value">{text(t[key], units)}</span>
                    </label>
                );
            })}
        </div>
    );
}
