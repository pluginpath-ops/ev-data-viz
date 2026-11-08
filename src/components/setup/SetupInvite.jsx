/**
 * A way into the setup wizard: one line and a button, for a reader who would
 * rather answer questions than learn the controls. Renders nothing where no
 * one can open the wizard (the pop-out).
 *
 *   from     where it sits, for the site event: 'home' | 'empty'
 *   centered stacks the line over the button, centered (an empty chart)
 */
import { useNavigation } from '../../context/NavigationContext';
import { SETUP_WIZARD } from '../../constants/setupWizard';

export default function SetupInvite({ from, centered = false }) {
    const { openSetup } = useNavigation();
    if (!openSetup) return null;
    const text = from === 'empty' ? SETUP_WIZARD.entry.emptyChart : SETUP_WIZARD.entry.home;
    return (
        <div className={`setup-invite${centered ? ' is-centered' : ''}`}>
            <span className="text-secondary">{text}</span>
            <span className="inline-flex items-center gap-2">
                <button type="button" className="btn btn-primary" onClick={() => openSetup(from)}>{SETUP_WIZARD.entry.button}</button>
                {from === 'home' && SETUP_WIZARD.entry.beta && <span className="badge-micro is-warning">{SETUP_WIZARD.entry.beta}</span>}
            </span>
        </div>
    );
}
