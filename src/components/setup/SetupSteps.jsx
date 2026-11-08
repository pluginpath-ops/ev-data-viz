/**
 * The setup wizard's steps (PROTOTYPE), one per screen. Each reads the answers
 * and patches them; the questions → settings rules are utils/setupWizard.js.
 */
import { useMemo } from 'react';
import VehicleCombobox from '../VehicleCombobox';
import { vehicleOption } from '../../utils/specHelpers';
import {
    SETUP_GOALS, STARTER_SETS, starterSetIds, HIGHWAY_SHARES, HIGHWAY_SPEEDS,
    CLIMATES, MOUNTAIN_FT, TRIP_FREQUENCIES, TRIP_DISTANCES, HOME_CHARGING, NUMBER_LIMITS,
} from '../../utils/setupWizard';
import { ChoiceCards, SegmentedChoice, NumberAnswer } from './SetupFields';

export function GoalStep({ answers, onChange }) {
    return (
        <ChoiceCards
            options={SETUP_GOALS}
            value={answers.goal}
            onChange={goal => onChange({ goal })}
        />
    );
}

/** Which cars: keep the selection, pick some, or let us pick from a kind of car. */
export function CarsStep({ answers, onChange, vehicles, selectedIds, names }) {
    const cars = answers.cars;
    const how = cars?.how ?? null;
    const options = useMemo(() => vehicles.map(vehicleOption), [vehicles]);
    const picked = how === 'pick' ? cars.ids ?? [] : [];
    const preview = useMemo(
        () => (how === 'set' && cars.set ? starterSetIds(cars.set, vehicles) : []),
        [how, cars, vehicles]);

    const hows = [
        ...(selectedIds.length ? [{ key: 'keep', label: `Keep my ${selectedIds.length} selected`, detail: selectedIds.slice(0, 3).map(id => names[id]).join(', ') }] : []),
        { key: 'pick', label: 'I know which cars', detail: 'Search by name' },
        { key: 'set',  label: 'Suggest some', detail: 'Pick a kind of car' },
    ];
    const setHow = (key) => onChange({ cars: key ? { how: key, ids: [], set: null } : null });

    return (
        <div className="setup-step-body">
            <ChoiceCards options={hows} value={how} onChange={setHow} columns={1} />
            {how === 'pick' && (
                <div className="setup-field">
                    <VehicleCombobox
                        options={options.filter(o => !picked.includes(o.id))}
                        value=""
                        noneLabel="＋ Add a car…"
                        onChange={id => id && onChange({ cars: { how: 'pick', ids: [...picked, vehicles.find(v => String(v.id) === id)?.id ?? id] } })}
                    />
                    {picked.length > 0 && (
                        <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
                            {picked.map(id => (
                                <li key={id} className="combobox-chip">
                                    <span className="combobox-chip-label">{names[id] ?? id}</span>
                                    <button
                                        type="button"
                                        className="combobox-chip-clear"
                                        aria-label={`Remove ${names[id] ?? id}`}
                                        onClick={() => onChange({ cars: { how: 'pick', ids: picked.filter(x => x !== id) } })}
                                    >
                                        &times;
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {how === 'set' && (
                <>
                    <ChoiceCards
                        legend="What kind of car?"
                        options={STARTER_SETS}
                        value={cars.set}
                        onChange={set => onChange({ cars: { how: 'set', set } })}
                    />
                    {cars.set && (
                        <p className="text-note">
                            {preview.length
                                ? `We'd pick: ${preview.map(id => names[id] ?? id).join(', ')}`
                                : 'None of these have charging, range and EPA data yet.'}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

export function DrivingStep({ answers, onChange }) {
    return (
        <div className="setup-step-body">
            <NumberAnswer
                label="Miles on a normal day"
                value={answers.dailyMi}
                onChange={dailyMi => onChange({ dailyMi })}
                {...NUMBER_LIMITS.dailyMi}
                step={5}
                unit="mi"
                placeholder="40"
            />
            <SegmentedChoice
                label="Where"
                options={HIGHWAY_SHARES.map(h => [h.key, h.label])}
                value={answers.highway}
                onChange={highway => onChange({ highway })}
            />
            <SegmentedChoice
                label="Highway speed"
                options={HIGHWAY_SPEEDS.map(s => [s, `${s} mph`])}
                value={answers.speedMph}
                onChange={speedMph => onChange({ speedMph })}
            />
            <SegmentedChoice
                label="Road trips"
                options={TRIP_FREQUENCIES.map(t => [t.key, t.label])}
                value={answers.trips}
                onChange={trips => onChange({ trips })}
            />
            <SegmentedChoice
                label="A typical road trip"
                options={TRIP_DISTANCES.map(d => [d, `${d} mi`])}
                value={answers.tripMi}
                onChange={tripMi => onChange({ tripMi })}
            />
        </div>
    );
}

export function WeatherStep({ answers, onChange }) {
    return (
        <div className="setup-step-body">
            <ChoiceCards options={CLIMATES} value={answers.climate} onChange={climate => onChange({ climate })} />
            <SegmentedChoice
                label="Altitude"
                options={[[false, 'Near sea level'], [true, `Mountains (~${MOUNTAIN_FT.toLocaleString('en-US')} ft)`]]}
                value={answers.mountains}
                onChange={mountains => onChange({ mountains })}
            />
        </div>
    );
}

export function MoneyStep({ answers, onChange }) {
    return (
        <div className="setup-step-body">
            <ChoiceCards options={HOME_CHARGING} value={answers.home} onChange={home => onChange({ home })} columns={1} />
            <NumberAnswer
                label="Electricity at home"
                value={answers.homePrice}
                onChange={homePrice => onChange({ homePrice })}
                {...NUMBER_LIMITS.homePrice}
                step={0.01}
                prefix="$"
                unit="/ kWh"
                placeholder="0.17"
            />
            <NumberAnswer
                label="Your gas car's mileage"
                value={answers.gasMpg}
                onChange={gasMpg => onChange({ gasMpg })}
                {...NUMBER_LIMITS.gasMpg}
                step={1}
                unit="mpg"
                placeholder="25"
            />
            <NumberAnswer
                label="Gas price"
                value={answers.gasPrice}
                onChange={gasPrice => onChange({ gasPrice })}
                {...NUMBER_LIMITS.gasPrice}
                step={0.01}
                prefix="$"
                unit="/ gal"
                placeholder="3.20"
            />
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
            {unset.length > 0 && (
                <p className="text-note">Not set (no setting for it yet): {unset.join('; ')}.</p>
            )}
            <p className="text-note">Anything you skipped stays as it is. You can change it all later.</p>
        </div>
    );
}
