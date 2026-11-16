/**
 * The Cost to Drive sidebar: every setting Your Driving has, stacked in the
 * chart sidebar of each analysis sub-tab — the secondary way in, not a summary
 * (owner, 2026-11-07). The groups are Your Driving's own components in their
 * `compact` form, so the two ways in cannot drift apart.
 *
 * Each group sits behind a section band. Your week and Home charging start open,
 * because they move the answer most; the rest start closed, each band saying
 * what it holds while closed. Open or closed is remembered per group.
 */
import { HOME_LEVELS } from '../../constants/costToDrive';
import { weekSummary, gasCarName } from '../../utils/costToDrive';
import { useRememberedOpen } from '../../hooks/useRememberedOpen';
import SectionBand from '../SectionBand';
import ShareSettingsButton from './ShareSettingsButton';
import { hourText } from './DriveFields';
import { levelLabel } from './HomeLevelPicker';
import {
    HomeChargingFields, WeekFields, FastChargingFields, SeasonFields, EfficiencyFields,
} from './DriveSections';
import GasCarFields from './GasCarFields';

const GROUPS = [
    {
        key: 'week', label: 'Your week', open: true, Fields: WeekFields,
        note: (s) => weekSummary(s),
    },
    {
        key: 'home', label: 'Home charging', open: true, Fields: HomeChargingFields,
        note: (s) => (HOME_LEVELS[s.level]?.none
            ? levelLabel(HOME_LEVELS[s.level])
            : `${levelLabel(HOME_LEVELS[s.level])} · ${hourText(s.plugFrom)} to ${hourText(s.plugUntil)} · $${s.homePrice.toFixed(2)}/kWh`),
    },
    {
        key: 'fast', label: 'Fast charging', open: false, Fields: FastChargingFields,
        note: (s) => `Stop by ${s.stopBy}% · no higher than ${s.capTo}% · ${s.detourMin} min detour · $${s.fastPrice.toFixed(2)}/kWh`,
    },
    {
        key: 'season', label: 'Season', open: false, Fields: SeasonFields,
        note: (s) => s.season === 'summer' ? `Summer · ${s.summerF}°F` : `Winter · ${s.winterF}°F`,
    },
    {
        key: 'gas', label: 'Your gas car', open: false, Fields: GasCarFields,
        note: (s) => `${gasCarName(s)} · ${s.gasCity} city · ${s.gasHwy} hwy mpg · $${s.gasPrice.toFixed(2)}/gal`,
    },
    {
        key: 'efficiency', label: 'Efficiency from', open: false, Fields: EfficiencyFields,
        note: (s) => s.efficiencyFrom === 'epa' ? 'EPA only' : 'Tested + EPA',
    },
];

function SidebarGroup({ group, settings, onChange }) {
    const [open, setOpen] = useRememberedOpen(`drive-${group.key}`, group.open);
    const { Fields } = group;
    return (
        <div className="chart-rail-group">
            <SectionBand open={open} onToggle={setOpen} label={group.label} note={open ? null : group.note(settings)} />
            {open && (
                <div className="flex flex-col gap-3">
                    <Fields settings={settings} onChange={onChange} compact />
                </div>
            )}
        </div>
    );
}

/**
 * Opens with a link to these settings (owner, 2026-11-10), where a button to
 * Your Driving was: the sub-tab row already goes there, and a reader who has
 * set their week wants to share it.
 */
export default function CostToDriveSidebar({ settings, onChange }) {
    return (
        <aside className="chart-rail">
            <ShareSettingsButton />
            {GROUPS.map(g => <SidebarGroup key={g.key} group={g} settings={settings} onChange={onChange} />)}
        </aside>
    );
}
