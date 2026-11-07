/**
 * The Cost to Drive settings in their groups — Home charging, Your week, Fast
 * charging, Season, Your gas car, Efficiency from. Written once: Your Driving
 * lays them out as cards across the page, the sidebar stacks them (`compact`),
 * so the two ways in cannot drift apart. Names: docs/vocabulary.md, Cost to
 * Drive.
 */
import { DETOUR_MPH, MIN_STOP_ADD, STRETCH_CAP_TO, WALL_OUTLET_CHARGER_EFF } from '../../constants/costToDrive';
import { ASSUMED_CHARGER_EFF, DC_FAST_LOSS } from '../../constants/epa';
import { DriveNumberField, DriveSlider, DriveChoice, DriveCheckbox, PlugWindow, HourSelect } from './DriveFields';
import HomeLevelPicker from './HomeLevelPicker';
import WeekPicker from './WeekPicker';

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

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
            <WeekPicker {...props} compact={compact} />
            <label className="drive-field is-wide">
                <span className="text-label">Planned fast charge at</span>
                <HourSelect {...props} field="plannedHour" label="Planned fast charge at" disabled={!settings.planned} />
            </label>
            {!compact && (
                <span className="text-note">
                    Click a day to cycle Daily → Long day → Off. A planned fast charge tops up to the
                    fast-charging cap, and is skipped when the car is already above it. On a driving
                    day it happens between drives, as near that time as the day allows.
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
                value={`${settings.detourMin} min ≈ ${detourMi} mi`} ends={['5 · on my route', '15 · a town over', '30 · rural']} />
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
        </>
    );
}

export function GasCarFields({ settings, onChange }) {
    const props = { settings, onChange };
    return (
        <>
            <div className="flex flex-col gap-2">
                <DriveNumberField {...props} field="gasCity" label="City" unit="mpg" />
                <DriveNumberField {...props} field="gasHwy" label="Highway" unit="mpg" />
                <DriveNumberField {...props} field="gasPrice" label="Price" unit="$/gal" />
                <DriveNumberField {...props} field="gasTank" label="Tank" unit="gal" />
                <DriveNumberField {...props} field="gasFillAt" label="Fill up at" unit="% left" />
                <DriveNumberField {...props} field="gasFillMin" label="Each fill-up" unit="min" />
            </div>
            <span className="text-note">The same week, city share and miles. A fill-up&rsquo;s minutes include its own short detour. Winter mpg loss is not modeled.</span>
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
                Charging losses, site-wide: 240 V {pct(ASSUMED_CHARGER_EFF)} reaches the pack · 120 V {pct(WALL_OUTLET_CHARGER_EFF)} ·
                DC fast {pct(DC_FAST_LOSS)} lost after the port
            </span>
        </>
    );
}
