/**
 * The Cost to Drive settings in their groups — Home charging, Your week, Fast
 * charging, Season, Efficiency from (Your gas car's is GasCarFields, shared with
 * Road Trip). Written once: Your Driving lays them out as cards across the
 * page, the sidebar stacks them (`compact`), so the two ways in cannot drift
 * apart. Names: docs/vocabulary.md, Cost to Drive.
 */
import { COST_TO_DRIVE_PRESETS, DETOUR_MPH, MIN_STOP_ADD, STRETCH_CAP_TO, WALL_OUTLET_CHARGER_EFF } from '../../constants/costToDrive';
import { ASSUMED_CHARGER_EFF, DC_FAST_LOSS } from '../../constants/epa';
import { percentText } from '../../utils/costToDrive';
import { DriveNumberField, DriveSlider, DriveChoice, DriveCheckbox, PlugWindow } from './DriveFields';
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
            <DriveNumberField {...props} field="homePrice" label="Home price" unit="$/kWh" />
            <DriveCheckbox {...props} field="fullBeforeLong" label="100% the night before a long day" />
        </>
    );
}

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
                <span className="text-meta">{type === 'L' ? 'sales calls, a friend two towns over' : 'the ordinary commute'}</span>
            </div>
            <DriveNumberField {...props} field={`${pre}Mi`} label="Miles in the day" unit="mi" />
            <DriveNumberField {...props} field={`${pre}Mph`} label="Highway speed" unit="mph" />
            <DriveSlider {...props} field={`${pre}City`} label="City share" value={`${city}%`}
                ends={[`${cityMi} mi city, ${mi - cityMi} mi highway`]} />
        </div>
    );
}

export function WeekFields({ settings, onChange, compact }) {
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
                <DriveNumberField {...props} field="fastPrice" label="Fast price" unit="$/kWh" />
            </div>
            <span className="text-note">
                A detour is off the route and back, its minutes at {DETOUR_MPH} mph, and costs energy too.
                A stop charges enough, detour included, to finish the day above the floor. It adds at
                least {MIN_STOP_ADD}%, and goes past the cap to {STRETCH_CAP_TO}% when that saves a second stop.
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
                Priced as denser air plus cabin heating or cooling. Battery warming and cold tires are
                not, so winter is a floor.
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
                Highway from EVBench range tests, city from the EPA highway figure, both corrected to
                your speed, temperature and elevation. A car with no range test uses EPA for both, and says so.
            </span>
            <span className="text-meta">
                Charging losses: at 240 V, each car&rsquo;s own EPA figure, else {percentText(ASSUMED_CHARGER_EFF)} reaches the pack ·
                120 V that × {percentText(WALL_OUTLET_CHARGER_EFF)} ÷ {percentText(ASSUMED_CHARGER_EFF)} (<ExplainerLink topic="wall-outlet-charging-loss">why lower</ExplainerLink>) ·
                DC fast {percentText(DC_FAST_LOSS)} lost after the port
            </span>
        </>
    );
}
