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
import { vehicleLabel } from '../../utils/specHelpers';
import { savedText, extraTimeText, weekSummary, gasCarName } from '../../utils/costToDrive';
import { useCostToDrive } from '../../hooks/useCostToDrive';
import ShareSettingsButton from './ShareSettingsButton';
import {
    HomeChargingFields, WeekFields, FastChargingFields, SeasonFields, EfficiencyFields,
} from './DriveSections';
import GasCarFields from './GasCarFields';

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

/** The selected vehicles vs the gas car, as the settings stand. */
function DrivePreview({ priced, settings, onOpenMode }) {
    return (
        <aside className="drive-preview" aria-label="With these settings">
            <span className="text-secondary">
                With these settings, a {settings.season} week vs {gasCarName(settings)}
            </span>
            {priced.length === 0 && (
                <span className="text-note">Add vehicles with ＋ Add above to see them priced.</span>
            )}
            {priced.map(({ vehicle, color, comparison, missing }) => (
                <div key={vehicle.id} className="drive-preview-row">
                    <span className="flex items-center gap-2 min-w-0">
                        {/* The vehicle's own series color: a runtime value, so inline. */}
                        <span className="drive-dot" style={{ backgroundColor: color }} aria-hidden="true" />
                        <span className="text-body truncate">{vehicleLabel(vehicle)}</span>
                    </span>
                    {missing
                        ? <span className="text-note drive-preview-missing">Can&rsquo;t price: {missing}</span>
                        : (
                            <>
                                <span className={`text-data drive-figure ${comparison.monthly.saved >= 0 ? 'is-saving' : 'is-costing'}`}>
                                    {savedText(comparison.monthly.saved)}
                                </span>
                                {/* Less time than the gas car is a saving, green like money saved (owner, 2026-11-07). */}
                                <span className={`text-data drive-figure ${comparison.extraMinutesPerWeek < 0 ? 'is-saving' : 'is-time'}`}>
                                    {extraTimeText(comparison.extraMinutesPerWeek)}
                                </span>
                            </>
                        )}
                </div>
            ))}
            {onOpenMode && priced.some(p => !p.missing) && (
                <div className="drive-presets">
                    <button type="button" className="btn btn-primary" onClick={() => onOpenMode('drivecost')}>Compare ↘</button>
                    <button type="button" className="btn btn-primary" onClick={() => onOpenMode('driveplan')}>Weekly Charging Plan ↘</button>
                </div>
            )}
        </aside>
    );
}

export default function YourDrivingPage({ vehicles, selectedVehicleIds, settings, onChange, onOpenMode = null, linkError = null }) {
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
                        <ShareSettingsButton />
                    </div>
                </div>
                <DrivePreview priced={priced} settings={settings} onOpenMode={onOpenMode} />
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
                <DriveCard title="Your gas car" aside={<span className="text-secondary">{gasCarName(settings)}</span>}>
                    <GasCarFields {...props} />
                </DriveCard>
            </div>

            <DriveCard title="Efficiency from" className="is-strip">
                <EfficiencyFields {...props} />
            </DriveCard>
        </div>
    );
}
