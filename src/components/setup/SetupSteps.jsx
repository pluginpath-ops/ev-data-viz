/**
 * The setup wizard's steps, one per screen. Every word comes from
 * constants/setupWizard.js; answers are held in miles, mph and °F and shown in
 * the reader's units.
 */
import { useEffect, useMemo, useRef } from 'react';
import VehicleCombobox from '../VehicleCombobox';
import { vehicleOption } from '../../utils/specHelpers';
import { MI_TO_KM } from '../../constants/units';
import { SETUP_WIZARD as C } from '../../constants/setupWizard';
import { starterSetIds, fill, speedWords, distanceWords, tempWords, altitudeWords } from '../../utils/setupWizard';
import { ChoiceCards, SegmentedChoice, NumberAnswer } from './SetupFields';

export function GoalStep({ answers, onChange }) {
    return (
        <ChoiceCards
            legend={C.goals.question}
            options={C.goals.options}
            value={answers.goals}
            onChange={goals => onChange({ goals })}
            multiple
        />
    );
}

/**
 * A search that adds cars, and the added ones as removable chips. Used for
 * "I know which cars" and to add to a kept selection. The list drops below the
 * field, so choosing a way that shows it brings it to the top of the step.
 */
function CarSearch({ options, ids, names, addLabel, onIds, vehicles }) {
    const ref = useRef(null);
    useEffect(() => { ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, []);
    return (
        <div ref={ref} className="setup-field setup-car-search">
            <VehicleCombobox
                options={options.filter(o => !ids.includes(o.id))}
                value=""
                noneLabel={addLabel}
                onChange={id => id && onIds([...ids, vehicles.find(v => String(v.id) === id)?.id ?? id])}
            />
            {ids.length > 0 && (
                <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
                    {ids.map(id => (
                        <li key={id} className="combobox-chip">
                            <span className="combobox-chip-label">{names[id]}</span>
                            <button
                                type="button"
                                className="combobox-chip-clear"
                                aria-label={`Remove ${names[id]}`}
                                onClick={() => onIds(ids.filter(x => x !== id))}
                            >
                                &times;
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Which cars: keep the selection (and add to it), pick some, or let us suggest some of a kind. */
export function CarsStep({ answers, onChange, vehicles, selectedIds, names }) {
    const cars = answers.cars;
    const how = cars?.how ?? null;
    const options = useMemo(() => vehicles.map(vehicleOption), [vehicles]);
    const picked = how === 'pick' ? (cars.ids ?? []).filter(id => names[id]) : [];
    const added = how === 'keep' ? (cars.add ?? []).filter(id => names[id]) : [];
    const preview = useMemo(
        () => (how === 'set' && cars.set ? starterSetIds(cars.set, vehicles) : []),
        [how, cars, vehicles]);
    const W = C.cars.ways;

    const hows = [
        ...(selectedIds.length ? [{ key: 'keep', label: fill(W.keep.label, { n: selectedIds.length }), detail: selectedIds.slice(0, 3).map(id => names[id]).join(', ') }] : []),
        { key: 'pick', label: W.pick.label, detail: W.pick.detail },
        { key: 'set',  label: W.set.label, detail: W.set.detail },
    ];
    const setHow = (key) => onChange({ cars: key ? { how: key, ids: [], add: [], set: null } : null });

    return (
        <div className="setup-step-body">
            <ChoiceCards options={hows} value={how} onChange={setHow} columns={1} />
            {how === 'keep' && (
                <CarSearch
                    options={options.filter(o => !selectedIds.includes(o.id))}
                    ids={added} names={names} vehicles={vehicles} addLabel={W.keep.addLabel}
                    onIds={ids => onChange({ cars: { how: 'keep', add: ids } })}
                />
            )}
            {how === 'pick' && (
                <CarSearch
                    options={options}
                    ids={picked} names={names} vehicles={vehicles} addLabel={W.pick.addLabel}
                    onIds={ids => onChange({ cars: { how: 'pick', ids } })}
                />
            )}
            {how === 'set' && (
                <>
                    <ChoiceCards
                        legend={C.cars.kindsQuestion}
                        options={C.cars.kinds}
                        value={cars.set}
                        onChange={set => onChange({ cars: { how: 'set', set } })}
                    />
                    {cars.set && (
                        <p className="text-note">
                            {preview.length
                                ? fill(C.cars.preview, { names: preview.map(id => names[id] ?? id).join(', ') })
                                : C.cars.previewEmpty}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** Daily distance in the reader's units, held in miles. */
function DailyDistance({ answers, onChange, units }) {
    const f = C.driving.dailyMi;
    const metric = units === 'metric';
    const toShown = (mi) => (mi == null ? null : metric ? Math.round(mi * MI_TO_KM) : mi);
    return (
        <NumberAnswer
            label={metric ? f.labelMetric : f.label}
            value={toShown(answers.dailyMi)}
            onChange={v => onChange({ dailyMi: v == null ? null : metric ? v / MI_TO_KM : v })}
            min={toShown(f.min)}
            max={toShown(f.max)}
            step={metric ? 5 : f.step}
            unit={metric ? 'km' : 'mi'}
        />
    );
}

/*
 * Driving, weather and money show only the questions `asked` holds: the ones
 * a chosen goal's chart reads (constants/setupWizard.js, goals[].asks).
 */
export function DrivingStep({ answers, onChange, units, asked }) {
    const D = C.driving;
    return (
        <div className="setup-step-body">
            {asked.has('dailyMi') && <DailyDistance answers={answers} onChange={onChange} units={units} />}
            {asked.has('highway') && <SegmentedChoice
                label={D.highway.label}
                options={D.highway.options.map(h => [h.key, h.label])}
                value={answers.highway}
                onChange={highway => onChange({ highway })}
            />}
            {asked.has('speedMph') && <SegmentedChoice
                label={D.speed.label}
                options={D.speed.mph.map(s => [s, speedWords(s, units)])}
                value={answers.speedMph}
                onChange={speedMph => onChange({ speedMph })}
            />}
            {asked.has('tripMi') && <SegmentedChoice
                label={D.tripMi.label}
                options={D.tripMi.miles.map(d => [d, distanceWords(d, units)])}
                value={answers.tripMi}
                onChange={tripMi => onChange({ tripMi })}
            />}
        </div>
    );
}

export function WeatherStep({ answers, onChange, units, asked }) {
    const W = C.weather;
    const climates = W.climates.map(c => ({
        key: c.key,
        label: `${c.label} — ${c.region}`,
        detail: fill(W.climateDetail, { winter: tempWords(c.winterF, units), summer: tempWords(c.summerF, units) }),
    }));
    return (
        <div className="setup-step-body">
            {asked.has('climate') && <ChoiceCards options={climates} value={answers.climate} onChange={climate => onChange({ climate })} columns={1} />}
            {asked.has('mountains') && <SegmentedChoice
                label={W.mountains.label}
                options={[[false, W.mountains.low], [true, fill(W.mountains.high, { alt: altitudeWords(W.mountains.ft, units) })]]}
                value={answers.mountains}
                onChange={mountains => onChange({ mountains })}
            />}
        </div>
    );
}

export function MoneyStep({ answers, onChange, asked }) {
    const M = C.money;
    const field = (key) => {
        if (!asked.has(key)) return null;
        const f = M[key];
        return (
            <NumberAnswer
                label={f.label}
                value={answers[key]}
                onChange={v => onChange({ [key]: v })}
                min={f.min}
                max={f.max}
                step={f.step}
                prefix={f.prefix}
                unit={f.unit}
            />
        );
    };
    return (
        <div className="setup-step-body">
            {asked.has('home') && <ChoiceCards options={M.home.options} value={answers.home} onChange={home => onChange({ home })} columns={1} />}
            {answers.home !== 'none' && field('homePrice')}
            {field('gasMpg')}
            {field('gasPrice')}
        </div>
    );
}

/** What Apply will do, in plain lines, and what it can't. */
export function SummaryStep({ lines, unset }) {
    return (
        <div className="setup-step-body">
            <dl className="setup-summary">
                {lines.map(l => (
                    <div key={l.label} className="setup-summary-row">
                        <dt className="text-label">{l.label}</dt>
                        <dd className="text-body">{l.text}</dd>
                    </div>
                ))}
            </dl>
            {unset.length > 0 && <p className="text-note">{fill(C.summary.unset, { list: [...new Set(unset)].join('; ') })}</p>}
            <p className="text-note">{C.summary.footer}</p>
        </div>
    );
}
