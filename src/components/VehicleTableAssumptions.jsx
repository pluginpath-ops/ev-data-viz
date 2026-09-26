import MenuButton from './shell/MenuButton';
import { DEFAULT_ASSUMPTIONS, ASSUMPTION_RANGES } from '../utils/vehicleTable';

/**
 * The vehicle table's assumptions (#335): inputs the reader sets for the
 * calculated columns that need one — the charge window, how far a stop should
 * take them, and what electricity costs at home and at a fast charger.
 *
 * One menu for every assumption rather than a control inside each header: a
 * header already sorts on click and moves on drag, and a third gesture on the
 * same cell competes with both.
 *
 * It offers only what the shown columns read (`needed`), so a preset with no
 * cost column has no price to set, and the table shows no menu at all when
 * nothing needs one. Every default is one a reader need never touch; the
 * sliders are there for the reader who goes looking.
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

export default function VehicleTableAssumptions({ assumptions, needed, units, onChange }) {
    const unit = units === 'metric' ? 'km' : 'mi';
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const set = (key) => (value) => onChange({ ...a, [key]: value });
    const shows = (key) => needed.has(key);

    // The button names only what the reader changed, and only among what is
    // on offer. The defaults need no restating: the column headers already
    // carry them ("Charge 10→80%", "Time to add 150 mi").
    const differs = (...keys) => keys.some(k => a[k] !== DEFAULT_ASSUMPTIONS[k]);
    const summary = [
        shows('window') && differs('windowFrom', 'windowTo') && `${a.windowFrom}→${a.windowTo}%`,
        shows('addDistance') && differs('addDistance') && `add ${a.addDistance} ${unit}`,
        shows('homePrice') && differs('homePrice') && `${money(a.homePrice)} home`,
        shows('fastPrice') && differs('fastPrice') && `${money(a.fastPrice)} fast`,
    ].filter(Boolean);
    const changed = summary.length > 0;

    return (
        <MenuButton
            label="Assumptions"
            value={summary.join(' · ') || null}
            active={changed}
            title="Inputs to the calculated columns: the charge window, how far a stop should take you, electricity prices"
            panelClass="vehicle-table-assumptions"
        >
            <div className="guide-facet-panel-head">
                <span className="text-nano">Assumptions</span>
                {changed && (
                    <button type="button" className="section-action" onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>
                        reset
                    </button>
                )}
            </div>
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
                        Used by “Time to add”, starting from the bottom of the charge window, with each
                        percent priced at the EPA range.
                    </span>
                </label>
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
            {(shows('homePrice') || shows('fastPrice')) && (
                <span className="text-note">
                    Defaults are round figures near US averages, not a quote. Set your own for your
                    utility or charging network.
                </span>
            )}
        </MenuButton>
    );
}
