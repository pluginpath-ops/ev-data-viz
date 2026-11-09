/**
 * The Cost to Drive fields, shared by Your Driving (the full page) and the
 * analysis sub-tabs' sidebar, so a setting looks and behaves the same in both
 * places. Every number is one row — label, a narrow box, its unit — so the
 * boxes line up down a card (owner, 2026-11-07).
 */
import NumberInput from '../NumberInput';
import { costToDriveField } from '../../constants/costToDrive';

/** A number setting as one row: label · box · unit. */
export function DriveNumberField({ settings, onChange, field, label, unit, integer }) {
    const f = costToDriveField(field);
    return (
        <label className="drive-field">
            <span className="text-label">{label}</span>
            <NumberInput
                className="form-input drive-field-input"
                value={settings[field]}
                min={f.min}
                max={f.max}
                // The spinner moves by `spin` where a field has one (the miles,
                // in fives); a typed figure only has to be on the stored step.
                step={f.spin ?? f.step}
                // Settings are stored on their step's grid (the key packs them
                // that way), so an off-grid figure is refused like an
                // out-of-range one rather than shown while the next one along
                // is used: an iPad reader typed 8 mi and was priced for 10,
                // which is why the miles are now stored to the mile.
                onStep={f.step}
                // Named by its label; the title is only the range hint.
                aria-label={label}
                title={f.step === 1 || f.spin ? `${f.min} to ${f.max}` : `${f.min} to ${f.max}, in steps of ${f.step}`}
                integer={integer ?? Number.isInteger(f.step)}
                onChange={n => onChange({ [field]: n })}
            />
            <span className="text-meta">{unit}</span>
        </label>
    );
}

/** A setting on a slider, its value shown at the right of its name, its ends named beneath. */
export function DriveSlider({ settings, onChange, field, label, value, ends = [] }) {
    const f = costToDriveField(field);
    return (
        <label className="drive-slider">
            <span className="drive-slider-head">
                <span className="text-label">{label}</span>
                <span className="text-data">{value}</span>
            </span>
            <input
                type="range"
                className="assumption-slider"
                min={f.min}
                max={f.max}
                step={f.step}
                value={settings[field]}
                onChange={e => onChange({ [field]: Number(e.target.value) })}
            />
            {ends.length > 0 && (
                <span className="drive-slider-ends text-caption">
                    {ends.map(e => <span key={e}>{e}</span>)}
                </span>
            )}
        </label>
    );
}

/** A two-way choice as a segmented control. */
export function DriveChoice({ settings, onChange, field, options, label }) {
    return (
        <div role="group" aria-label={label} className="stats-segmented drive-choice">
            {options.map(([value, text]) => (
                <button
                    key={value}
                    type="button"
                    aria-pressed={settings[field] === value}
                    className={settings[field] === value ? 'active' : undefined}
                    onClick={() => onChange({ [field]: value })}
                >
                    {text}
                </button>
            ))}
        </div>
    );
}

/** A setting that is on or off. */
export function DriveCheckbox({ settings, onChange, field, label }) {
    return (
        <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings[field]} onChange={e => onChange({ [field]: e.target.checked })} />
            <span className="text-secondary">{label}</span>
        </label>
    );
}

/** An hour of the day as a reader reads one: "10 pm", "7 am". */
export const hourText = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;

/** An hour-of-the-day setting as a select: 12 am … 11 pm. */
export function HourSelect({ field, label, settings, onChange, disabled = false }) {
    return (
        <select
            aria-label={label}
            className="form-input"
            value={settings[field]}
            disabled={disabled}
            onChange={e => onChange({ [field]: Number(e.target.value) })}
        >
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourText(h)}</option>)}
        </select>
    );
}

/** The plug-in window as a sentence: Plugged in [10 pm] to [7 am] · 9 hours. */
export function PlugWindow({ settings, onChange }) {
    const hours = ((settings.plugUntil - settings.plugFrom + 24) % 24) || 24;
    const select = (field, label) => <HourSelect field={field} label={label} settings={settings} onChange={onChange} />;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-label">Plugged in</span>
            {select('plugFrom', 'Plugged in from')}
            <span className="text-meta">to</span>
            {select('plugUntil', 'Plugged in until')}
            <span className="text-meta">{hours} hours</span>
        </div>
    );
}
