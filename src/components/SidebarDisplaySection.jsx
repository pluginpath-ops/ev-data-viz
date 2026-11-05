import SectionBand from './SectionBand';
import { useRememberedOpen } from '../hooks/useRememberedOpen';

/**
 * The Display group of a chart's sidebar, behind a section band: toggles, the
 * color source and, on a chart that corrects range, the correction.
 *
 * Collapsed by default, because a reader rarely changes these and the run list
 * below wants the room. Open or closed is remembered across every chart
 * (useRememberedOpen). A correcting chart passes `active` while a correction
 * is applied, which draws the applied dot, and `summary`, which says what the
 * figures are corrected to while the section is closed — closing it must never
 * hide that the numbers have been moved.
 *
 * Props:
 *   title    {string}   "Display", or "Display and corrections" where the chart corrects
 *   active   {boolean}  a correction is applied
 *   summary  {node}     shown on the band while collapsed
 *   children {node}     the group's controls
 */
export default function SidebarDisplaySection({ title = 'Display', active = false, summary = null, children }) {
    const [open, setOpen] = useRememberedOpen('chart-display');
    return (
        <div className="chart-rail-group">
            <SectionBand
                open={open}
                onToggle={setOpen}
                label={title}
                active={active}
                activeLabel="A correction is applied"
                note={open ? null : summary}
            />
            {open && <div className="chart-rail-group">{children}</div>}
        </div>
    );
}
