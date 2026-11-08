/**
 * The setup wizard's answer controls (PROTOTYPE). Each answer can be cleared:
 * clicking the chosen card again un-picks it, which is "skip" for that one
 * question.
 */
import NumberInput from '../NumberInput';

/** A pick-one grid of cards, each a label and an optional line under it. */
export function ChoiceCards({ legend, options, value, onChange, columns = 2 }) {
    return (
        <fieldset className={`setup-choices${columns === 1 ? ' is-single' : ''}`}>
            {legend && <legend className="text-label">{legend}</legend>}
            {options.map(o => {
                const on = value === o.key;
                return (
                    <button
                        key={o.key}
                        type="button"
                        aria-pressed={on}
                        className={`setup-choice${on ? ' is-on' : ''}`}
                        onClick={() => onChange(on ? null : o.key)}
                    >
                        <span className="text-body">{o.label}</span>
                        {o.detail && <span className="text-meta">{o.detail}</span>}
                    </button>
                );
            })}
        </fieldset>
    );
}

/** A short pick-one row: the segmented control. */
export function SegmentedChoice({ label, options, value, onChange }) {
    return (
        <div className="setup-field">
            <span className="text-label">{label}</span>
            <div role="group" aria-label={label} className="stats-segmented">
                {options.map(([key, text]) => (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={value === key}
                        className={value === key ? 'active' : undefined}
                        onClick={() => onChange(value === key ? null : key)}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** A number with its unit; empty is skipped. */
export function NumberAnswer({ label, value, onChange, min, max, step, unit, prefix, placeholder }) {
    return (
        <label className="setup-field">
            <span className="text-label">{label}</span>
            <span className="setup-number">
                {prefix && <span className="text-meta">{prefix}</span>}
                <NumberInput
                    className="form-input setup-number-input"
                    value={value}
                    onChange={onChange}
                    min={min}
                    max={max}
                    step={step}
                    allowEmpty
                    placeholder={placeholder}
                />
                {unit && <span className="text-meta">{unit}</span>}
            </span>
        </label>
    );
}
