/**
 * The way into the setup wizard (PROTOTYPE): one line and a button, for a
 * reader who would rather answer questions than learn the controls. Renders
 * nothing where no one can open the wizard (the pop-out).
 *
 *   text  the line before the button
 */
import { useNavigation } from '../../context/NavigationContext';

export default function SetupInvite({ text = 'New here? Answer a few questions and we’ll set up the charts for you.' }) {
    const { openSetup } = useNavigation();
    if (!openSetup) return null;
    return (
        <div className="setup-invite">
            <span className="text-secondary">{text}</span>
            <button type="button" className="btn btn-primary" onClick={openSetup}>Set up for me</button>
        </div>
    );
}
