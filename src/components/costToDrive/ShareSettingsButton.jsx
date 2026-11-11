/**
 * Copies a short link to the Cost & Time page as set: the vehicles, the
 * sub-tab and every setting (owner, 2026-11-10: the settings, not only the
 * charts, should offer one). At the top of the sidebar and on Your Driving.
 */
import CopyLinkButton from '../charts/CopyLinkButton';

export default function ShareSettingsButton() {
    return (
        <CopyLinkButton className="btn btn-secondary" label="Share this comparison"
                        title="Copy a short link: the vehicles, this page and every setting" />
    );
}
