/**
 * The Cost to Drive settings in their groups — Home charging, Your week, Fast
 * charging, Season, Efficiency from (Gas comparison vehicle's is GasCarFields, shared with
 * Road Trip). Written once: Your Driving lays them out as cards across the
 * page, the sidebar stacks them (`compact`), so the two ways in cannot drift
 * apart. Names: docs/vocabulary.md, Cost to Drive.
 */
import { COST_TO_DRIVE_PRESETS, DETOUR_MPH, MIN_STOP_ADD, STRETCH_CAP_TO } from '../../constants/costToDrive';
import { DC_FAST_LOSS, FIXED_DRAW_W, PHANTOM_DRAIN_PCT_DAY } from '../../constants/epa';
import { RATE_PLANS, ratePlan, CUSTOM_TIER_NAMES } from '../../constants/ratePlans';
import { percentText, rateSeason, customFromPlan } from '../../utils/costToDrive';
import { DriveNumberField, DriveSlider, DriveChoice, DriveCheckbox, PlugWindow } from './DriveFields';
import RateStrip, { TierSwatch } from './RateStrip';
import HomeLevelPicker from './HomeLevelPicker';
import ExplainerLink from '../../explainers/ExplainerLink';
import WeekPicker from './WeekPicker';
import PackWarmingNote from './PackWarmingNote';


export function HomeChargingFields({ settings, onChange, compact }) {
    const props = { settings, onChange };
    return (
        <>
            <HomeLevelPicker {...props} compact={compact} />
            <span className="text-note">Each car takes the lesser of this and its own onboard charger.</span>
            <PlugWindow {...props} />
            <DriveNumberField {...props} field="chargeTo" label="Charge to" unit="%" />
            <DriveCheckbox {...props} field="fullBeforeLong" label="100% the night before a long day" />
        </>
    );
}

/**
 * Electricity rates (owner, 2026-11-17): what a kWh costs at home — One price,
 * or a time-of-use plan, picked from RATE_PLANS or the reader's own — and on a
 * fast charger. A picked plan shows its own tier names and the season's
 * prices; editing its hours or a price makes it the reader's own (Custom),
 * starting from what was shown, as the gas car does. The sidebar (`compact`)
 * leaves out the plan's source line.
 */
export function ElectricityRatesFields({ settings, onChange, compact }) {
    const props = { settings, onChange };
    const tou = settings.rate !== 'flat';
    const plan = ratePlan(settings.rate);
    const rate = rateSeason(settings);
    // A picked plan shows the same controls as the reader's own (owner,
    // 2026-11-17); an edit makes it their own, from the plan as shown: the
    // plan as custom fields first, then the edit. Every plan's weekend is its
    // weekday with or without peak priced lower, so the checkbox holds it.
    const own = (patch) => onChange({ ...customFromPlan(settings), ...patch, rate: 'custom' });
    const ownProps = { settings, onChange: own };
    const weekendOff = rate && rate.weekend !== rate.weekday;
    return (
        <>
            <DriveChoice settings={{ tou }} field="tou" label="Home electricity"
                onChange={({ tou: on }) => onChange({ rate: on ? (tou ? settings.rate : 'custom') : 'flat' })}
                options={[[false, 'One price'], [true, 'Time of use']]} />
            {!tou && <DriveNumberField {...props} field="homePrice" label="Home price" unit="$/kWh" />}
            {tou && (
                <>
                    <select aria-label="Rate plan" className="form-input" value={settings.rate}
                        onChange={e => onChange({ rate: e.target.value })}>
                        {RATE_PLANS.map(p => <option key={p.key} value={p.key}>{p.label} · {p.region}</option>)}
                        <option value="custom">My own plan</option>
                    </select>
                    <RateStrip map={rate.weekday} tiers={rate.tiers}
                        label={weekendOff ? 'Weekday hours' : 'Hours'} onCycle={(rateHours) => own({ rateHours })} />
                    <div className="flex flex-col gap-2">
                        {RATE_FIELDS.map((field, t) => (
                            <DriveNumberField key={field} {...ownProps} field={field}
                                label={rate.tiers[t] ?? CUSTOM_TIER_NAMES[t]} unit="$/kWh" value={rate.prices[t]}>
                                <TierSwatch tier={t} />
                            </DriveNumberField>
                        ))}
                    </div>
                    <DriveCheckbox settings={{ rateWeekendOff: weekendOff }} onChange={own}
                        field="rateWeekendOff" label="Weekends are off-peak (no peak hours)" />
                    <span className="text-note">
                        {plan && `${settings.season === 'winter' ? 'Winter' : 'Summer'} prices, as of ${plan.asOf}. `}
                        Click an hour to change its tier{plan ? '; a change makes it your own plan' : ''}.
                        Each night charges in its cheapest hours first. Monthly fixed charges are left out.
                        {plan?.note ? ` ${plan.note}` : ''}
                        {plan && !compact && <> <a href={plan.source} target="_blank" rel="noreferrer">Source</a>; check your bill.</>}
                    </span>
                </>
            )}
            <DriveNumberField {...props} field="fastPrice" label="Fast price" unit="$/kWh" />
        </>
    );
}

/**
 * The selected cars City share cannot move: with no EPA city figure their
 * city miles are priced at the highway one (owner, 2026-11-17: say so rather
 * than estimate one). `names` from noCityFigure (hooks/useCostToDrive).
 */
function NoCityFigureNote({ names }) {
    if (!names.length) return null;
    const one = names.length === 1;
    return (
        <span className="text-note callout is-warning drive-warning" role="note">
            {listText(names)} {one ? 'has' : 'have'} no EPA city figure, so City share doesn&rsquo;t
            change {one ? 'its' : 'their'} cost: city miles use {one ? 'its' : 'each one\u2019s'} highway figure.
        </span>
    );
}

/** Names as prose: "A", "A and B", "A, B and C". */
const listText = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** A custom plan's price fields, dearest first, as the tiers are. */
const RATE_FIELDS = ['rateHigh', 'rateMid', 'rateLow'];

/** One day type's miles, highway speed and city share. */
function DayTypeFields({ settings, onChange, type }) {
    const props = { settings, onChange };
    const pre = type === 'L' ? 'long' : 'daily';
    const mi = settings[`${pre}Mi`];
    const city = settings[`${pre}City`];
    const cityMi = Math.round(mi * city / 100);
    return (
        <div className="day-type">
            <div className="day-type-head">
                <span className="subsection-title">{type === 'L' ? 'Long day' : 'Daily'}</span>
                <span className="text-meta">{type === 'L' ? 'a typical long driving day' : 'the ordinary commute'}</span>
            </div>
            <DriveNumberField {...props} field={`${pre}Mi`} label="Miles in the day" unit="mi" />
            <DriveNumberField {...props} field={`${pre}Mph`} label="Highway speed" unit="mph" />
            <DriveSlider {...props} field={`${pre}City`} label="City share" value={`${city}%`}
                ends={[`${cityMi} mi city, ${mi - cityMi} mi highway`]} />
        </div>
    );
}

export function WeekFields({ settings, onChange, compact, cityless = [] }) {
    const props = { settings, onChange };
    return (
        <>
            {/* Your Driving only: the chart sidebars tune a week, not pick one (owner, 2026-11-10). */}
            {!compact && (
                <div className="drive-presets" role="group" aria-label="Start from">
                    <span className="text-label">Start from</span>
                    {COST_TO_DRIVE_PRESETS.map(p => (
                        <button key={p.key} type="button" className="btn btn-secondary" title={p.title}
                            aria-pressed={Object.entries(p.settings).every(([k, v]) => settings[k] === v)}
                            onClick={() => onChange(p.settings)}>
                            {p.label}
                        </button>
                    ))}
                </div>
            )}
            <WeekPicker {...props} compact={compact} />
            {!compact && (
                <span className="text-note">
                    Click a day to cycle Daily → Long day → Off. A planned fast charge tops up to the
                    fast-charging cap, and is skipped when the car is already above it. It happens at 5&nbsp;pm on a
                    day off; on a driving day, between drives, as near 5&nbsp;pm as the day allows.
                </span>
            )}
            <div className="day-types">
                <DayTypeFields {...props} type="D" />
                <DayTypeFields {...props} type="L" />
            </div>
            <NoCityFigureNote names={cityless} />
        </>
    );
}

export function FastChargingFields({ settings, onChange }) {
    const props = { settings, onChange };
    const detourMi = Math.round(settings.detourMin / 60 * DETOUR_MPH);
    return (
        <>
            <DriveSlider {...props} field="detourMin" label="Detour to a charger"
                value={`${settings.detourMin} min ≈ ${detourMi} mi`} ends={['0 · on my route', '15 · a town over', '30 · rural']} />
            <DriveSlider {...props} field="stopBy" label="Stop to charge by"
                value={`${settings.stopBy}%`} ends={['10% · run it low', '50% · whichever charger comes up']} />
            <div className="flex flex-col gap-2">
                <DriveNumberField {...props} field="capTo" label="Charge no higher than" unit="%" />
                <DriveNumberField {...props} field="keepAbove" label="Keep battery above" unit="%" />
                <DriveNumberField {...props} field="startMin" label="Time to start and pay" unit="min" />
            </div>
            <span className="text-note">
                A detour is the time off your route to reach a fast charger and get back; its miles
                (at {DETOUR_MPH} mph) count in the cost and the time. A stop always adds at least {MIN_STOP_ADD}%, and
                may go past the cap to {STRETCH_CAP_TO}% when that saves a second stop. If home charging can&rsquo;t
                bring the battery back by Monday morning, the week&rsquo;s last fast stop charges further.
            </span>
            <span className="text-note">
                DC fast charging assumes {percentText(DC_FAST_LOSS)} of the energy delivered is lost to battery
                heating and thermal management systems (<ExplainerLink topic="evbench-charging-energy">why</ExplainerLink>).
            </span>
        </>
    );
}

/**
 * Phantom drain (#590): what a parked car loses a day. Each car's own figure
 * where its record has one, else the site's; or one figure for every car.
 * Driving and charging are not charged it (their efficiency carries it), and
 * the gas car has none.
 */
export function PhantomDrainFields({ settings, onChange }) {
    const props = { settings, onChange };
    const mine = settings.phantomFrom === 'mine';
    return (
        <>
            <DriveChoice {...props} field="phantomFrom" label="Phantom drain"
                options={[['car', 'Each car’s own'], ['mine', 'My figure']]} />
            {mine
                ? <DriveNumberField {...props} field="phantomDrain" label="Phantom drain, every car" unit="% a day" />
                : <span className="text-note">A car with no figure of its own loses {PHANTOM_DRAIN_PCT_DAY}% a day.</span>}
            <span className="text-note">
                The typical amount of battery lost per day regardless of usage. Consumed by maintenance
                electronics and security features. Modern EVs typically lose about {PHANTOM_DRAIN_PCT_DAY}% per day,
                more (up to 3&ndash;5%) with &ldquo;sentry mode&rdquo; or &ldquo;gear guard&rdquo; type systems enabled.
                This is energy consumed while parked and not charging.
            </span>
        </>
    );
}

export function SeasonFields({ settings, onChange }) {
    const props = { settings, onChange };
    return (
        <>
            <DriveChoice {...props} field="season" label="Season shown"
                options={[['summer', `Summer · ${settings.summerF}°F`], ['winter', `Winter · ${settings.winterF}°F`]]} />
            <div className="flex flex-col gap-2">
                <DriveNumberField {...props} field="summerF" label="Summer" unit="°F" />
                <DriveNumberField {...props} field="winterF" label="Winter" unit="°F" />
                <DriveNumberField {...props} field="winterMonths" label="Winter lasts" unit="months" />
                <DriveNumberField {...props} field="elevationFt" label="Elevation" unit="ft" />
            </div>
            <span className="text-note">
                Temperature and elevation change driving efficiency, through EVBench&rsquo;s estimated heating
                and cooling loads and the air&rsquo;s density.
            </span>
            <PackWarmingNote settings={settings} />
        </>
    );
}

export function EfficiencyFields({ settings, onChange }) {
    const props = { settings, onChange };
    return (
        <>
            <DriveChoice {...props} field="efficiencyFrom" label="Efficiency from"
                options={[['tested', 'Tested + EPA'], ['epa', 'EPA only']]} />
            <span className="text-note">
                Tested + EPA uses EVBench range tests for highway miles and the EPA city figure for city
                miles. EVBench range tests are mostly steady interstate drives; EPA&rsquo;s highway figure is
                closer to 50&ndash;60 mph roads with traffic. All are corrected to your temperature and
                elevation, and range tests to your speed too. A car with no range test uses EPA highway for
                highway miles; one with no EPA city figure uses its highway figure for city miles.
            </span>
            <span className="text-note">
                Charging losses: estimated per vehicle by EPA testing certification, adjusted for charging speed.
                At lower charging speeds, an assumed {FIXED_DRAW_W} W fixed draw is applied beyond the EPA losses
                (<ExplainerLink topic="evbench-charging-energy">why</ExplainerLink>).
            </span>
        </>
    );
}
