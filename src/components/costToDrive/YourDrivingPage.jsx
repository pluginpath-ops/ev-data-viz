/**
 * Your Driving — Cost to Drive's landing sub-tab (mode `drivesetup`): every
 * setting on one page, the PRIMARY way in (owner, 2026-11-07). The analysis
 * sub-tabs keep every setting in their sidebar too, as the secondary way.
 *
 * Laid out in rows of even height: Your week beside Fast charging (a stop is
 * part of the week), then Home charging, Season and Your gas car, then
 * Efficiency from as one strip. Beside the intro, a live preview of the
 * selected vehicles against the gas car.
 */
import { COST_TO_DRIVE_PRESETS, DEFAULT_COST_TO_DRIVE } from '../../constants/costToDrive';
import { vehicleLabel } from '../../utils/specHelpers';
import { savedText, extraTimeText } from '../../utils/costToDrive';
import { useCostToDrive } from '../../hooks/useCostToDrive';
import {
    HomeChargingFields, WeekFields, FastChargingFields, SeasonFields, GasCarFields, EfficiencyFields,
} from './DriveSections';

/** A card on the page: a heading band and a body that fills the row's height. */
function DriveCard({ title, aside, children, className = '' }) {
    return (
        <section className={`drive-card ${className}`}>
            <div className="drive-card-head">
                <h3 className="section-title">{title}</h3>
                {aside}
            </div>
            <div className="drive-card-body">{children}</div>
        </section>
    );
}

/** The week in one line: "795 mi per week · three long days, three daily, one off". */
function weekSummary(settings) {
    const count = (t) => [...settings.week].filter(c => c === t).length;
    const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    const miles = count('L') * settings.longMi + count('D') * settings.dailyMi;
    const parts = [
        `${words[count('L')]} long day${count('L') === 1 ? '' : 's'}`,
        `${words[count('D')]} daily`,
        `${words[count('O')]} off`,
    ];
    return `${miles.toLocaleString('en-US')} mi per week · ${parts.join(', ')}`;
}

/** The selected vehicles against the gas car, as the settings stand. */
function DrivePreview({ priced, settings }) {
    return (
        <aside className="drive-preview" aria-label="With these settings">
            <span className="text-secondary">
                With these settings, a {settings.season} week against your gas car
            </span>
            {priced.length === 0 && (
                <span className="text-note">Add vehicles with ＋ Add above to see them priced.</span>
            )}
            {priced.map(({ vehicle, comparison, missing }) => (
                <div key={vehicle.id} className="drive-preview-row">
                    <span className="flex items-center gap-2 min-w-0">
                        {/* The vehicle's own series color: a runtime value, so inline. */}
                        <span className="drive-dot" style={{ backgroundColor: vehicle.color }} aria-hidden="true" />
                        <span className="text-body truncate">{vehicleLabel(vehicle)}</span>
                    </span>
                    {missing
                        ? <span className="text-note drive-preview-missing">Can&rsquo;t price: {missing}</span>
                        : (
                            <>
                                <span className={`text-data ${comparison.monthly.saved >= 0 ? 'is-saving' : 'is-costing'}`}>
                                    {savedText(comparison.monthly.saved)}
                                </span>
                                {/* Less time than the gas car is a saving, green like money saved (owner, 2026-11-07). */}
                                <span className={`text-data ${comparison.extraMinutesPerWeek < 0 ? 'is-saving' : 'is-time'}`}>
                                    {extraTimeText(comparison.extraMinutesPerWeek)}
                                </span>
                            </>
                        )}
                </div>
            ))}
        </aside>
    );
}

export default function YourDrivingPage({ vehicles, selectedVehicleIds, settings, onChange, linkError = null }) {
    const priced = useCostToDrive(vehicles, selectedVehicleIds, settings);
    const props = { settings, onChange };
    return (
        <div className="drive-page">
            {linkError && <p className="drive-link-error text-secondary" role="status">{linkError}</p>}
            <div className="drive-intro">
                <div className="drive-intro-text">
                    <h2 className="page-title">Your driving</h2>
                    <p className="text-secondary">
                        How you charge, how far you drive, and what you&rsquo;d otherwise fill up with.
                        Set these once and every chart on this tab reads them. They travel in the link,
                        so a friend sees your week as you set it.
                    </p>
                    <div className="drive-presets">
                        {COST_TO_DRIVE_PRESETS.map((p, i) => (
                            <button key={p.key} type="button" className="btn btn-secondary" onClick={() => onChange(p.settings)}>
                                {i === 0 ? `Start from: ${p.label}` : p.label}
                            </button>
                        ))}
                        <button type="button" className="btn btn-secondary" onClick={() => onChange(DEFAULT_COST_TO_DRIVE)}>
                            Reset to defaults
                        </button>
                    </div>
                </div>
                <DrivePreview priced={priced} settings={settings} />
            </div>

            <div className="drive-row is-week">
                <DriveCard title="Your week" aside={<span className="text-secondary">{weekSummary(settings)}</span>}>
                    <WeekFields {...props} />
                </DriveCard>
                <DriveCard title="Fast charging, when a day runs short">
                    <FastChargingFields {...props} />
                </DriveCard>
            </div>

            <div className="drive-row">
                <DriveCard title="Home charging"><HomeChargingFields {...props} /></DriveCard>
                <DriveCard title="Season"><SeasonFields {...props} /></DriveCard>
                <DriveCard title="Your gas car"><GasCarFields {...props} /></DriveCard>
            </div>

            <DriveCard title="Efficiency from" className="is-strip">
                <EfficiencyFields {...props} />
            </DriveCard>
        </div>
    );
}
