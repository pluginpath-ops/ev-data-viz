import { DEFAULT_ASSUMPTIONS, ASSUMPTION_RANGES } from '../utils/vehicleTable';
import CorrectionTargetFields from './CorrectionTargetFields';
import { targetDiffers, correctionTargetText } from '../utils/correctionSettings';

/**
 * The vehicle table's assumption inputs, without a frame: the charge window,
 * how far a stop should take you, electricity prices, the conditions a composite
 * range is corrected to. Two frames hold them — the table's Assumptions menu
 * (VehicleTableAssumptions) and the spec chart's sidebar section (#450) — so
 * the chart, which plots the table's calculated columns, is steered by the very
 * same controls and cannot disagree with the cell the reader came from.
 *
 * It offers only what the shown columns read (`needed`).
 */
const money = (n) => `$${n.toFixed(2)}`;

function Slider({ name, value, onChange, label }) {
    const { min, max, step } = ASSUMPTION_RANGES[name];
    return (
        <input
            type="range"
            className="assumption-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={label}
            onChange={e => onChange(Number(e.target.value))}
        />
    );
}

/** What the reader changed, among what is on offer, as a short line — empty when nothing differs. */
export function assumptionSummary({ assumptions, needed, units, correctionTarget }) {
    const unit = units === 'metric' ? 'km' : 'mi';
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const shows = (key) => needed.has(key);
    const differs = (...keys) => keys.some(k => a[k] !== DEFAULT_ASSUMPTIONS[k]);
    return [
        shows('window') && differs('windowFrom', 'windowTo') && `${a.windowFrom}→${a.windowTo}%`,
        shows('addDistance') && differs('addDistance') && `add ${a.addDistance} ${unit}`,
        shows('rangeBasis') && differs('rangeBasis') && 'EPA range',
        shows('homePrice') && differs('homePrice') && `${money(a.homePrice)} home`,
        shows('fastPrice') && differs('fastPrice') && `${money(a.fastPrice)} fast`,
        shows('conditions') && targetDiffers(correctionTarget) && correctionTargetText(correctionTarget, units),
    ].filter(Boolean);
}

export default function VehicleAssumptionFields({ assumptions, needed, units, onChange, correctionTarget, onCorrectionTargetChange }) {
    const unit = units === 'metric' ? 'km' : 'mi';
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const set = (key) => (value) => onChange({ ...a, [key]: value });
    const shows = (key) => needed.has(key);

    return (
        <>
            {shows('window') && (
                <div className="assumption-field">
                    <span className="assumption-field-name">
                        Charge from <span className="text-data">{a.windowFrom}%</span> to <span className="text-data">{a.windowTo}%</span>
                    </span>
                    <Slider name="windowFrom" label="Charge from" value={a.windowFrom} onChange={set('windowFrom')} />
                    <Slider name="windowTo" label="Charge to" value={a.windowTo} onChange={set('windowTo')} />
                    <span className="text-note">
                        Read off each car’s own charging test where one covers the window. A spec gives
                        only 10→80%, so for any other window a car without a test is blank.
                    </span>
                </div>
            )}
            {shows('addDistance') && (
                <label className="assumption-field">
                    <span className="assumption-field-name">
                        A charging stop adds <span className="text-data">{a.addDistance} {unit}</span>
                    </span>
                    <Slider name="addDistance" value={a.addDistance} onChange={set('addDistance')} />
                    <span className="text-note">
                        Used by “Time to add”, starting from the bottom of the charge window; the top of the window does not limit it.
                    </span>
                </label>
            )}
            {shows('rangeBasis') && (
                <div className="assumption-field">
                    <span className="assumption-field-name">Price each percent at</span>
                    <div className="stats-segmented" role="group" aria-label="Range basis">
                        {[['tested', 'Tested range'], ['epa', 'EPA range']].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                className={a.rangeBasis === value ? 'active' : ''}
                                aria-pressed={a.rangeBasis === value}
                                onClick={() => set('rangeBasis')(value)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <span className="text-note">
                        For “Time to add” and “Range per minute”. Tested is the composite range, else the reported range test; EPA is the label.
                        Either falls back to the other when a car has no figure of its own.
                    </span>
                </div>
            )}
            {shows('homePrice') && (
                <label className="assumption-field">
                    <span className="assumption-field-name">
                        Electricity at home <span className="text-data">{money(a.homePrice)}/kWh</span>
                    </span>
                    <Slider name="homePrice" value={a.homePrice} onChange={set('homePrice')} />
                </label>
            )}
            {shows('fastPrice') && (
                <label className="assumption-field">
                    <span className="assumption-field-name">
                        DC fast charging <span className="text-data">{money(a.fastPrice)}/kWh</span>
                    </span>
                    <Slider name="fastPrice" value={a.fastPrice} onChange={set('fastPrice')} />
                </label>
            )}
            {shows('conditions') && (
                <CorrectionTargetFields target={correctionTarget} onChange={onCorrectionTargetChange} />
            )}
            {(shows('homePrice') || shows('fastPrice')) && (
                <span className="text-note">
                    Defaults are round figures near US averages, not a quote. Set your own for your
                    utility or charging network.
                </span>
            )}
        </>
    );
}
