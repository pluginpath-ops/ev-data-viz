import { useState } from 'react';
import { useLightDismiss } from '../../hooks/useLightDismiss';
import { useTheme } from '../../hooks/useTheme';

/**
 * The account and settings control at the right end of the nav (#281).
 *
 * It replaces a `Sign In` button that cost 111px of a 375px bar — a quarter of
 * the width, spent on the one action a returning reader has already taken. It
 * is one 30px circle now, at every width, and what used to sit beside it in the
 * bar sits inside it: the signed-in email, the role, and the unit system. The
 * email opt-in (migration 097) lives here too: it is the one place a signed-in user's
 * own settings gather.
 *
 * The units toggle MOVED here rather than being copied. It lived in the
 * selection strip, which is a strip about vehicles; a preference that repaints
 * every figure on every screen is not a property of the current selection, and
 * two controls for one setting is the drift this project keeps paying for.
 *
 * The theme picker is here for the same reason: Light, Dark or System (follow
 * the device), kept per browser like the units.
 */
const THEME_CHOICES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];

function PersonIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.7 0-5 1.5-5 3.4V14h10v-1.1c0-1.9-2.3-3.4-5-3.4Z" />
        </svg>
    );
}

export default function AccountMenu({ user, userRole, emailOptIn, onEmailOptInChange, units, onToggleUnits, onSignIn, onSignOut }) {
    const [open, setOpen] = useState(false);
    const { theme, setTheme } = useTheme();
    const ref = useLightDismiss(open, () => setOpen(false));

    const initial = user?.email?.[0]?.toUpperCase() ?? null;

    return (
        <div className="account-menu" ref={ref}>
            <button
                type="button"
                className={`account-btn${user ? ' signed-in' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-haspopup="menu"
                /* The email is the label rather than a tooltip: on a touch
                   device a title attribute is never seen, and "who am I signed
                   in as" is the question this control exists to answer. */
                aria-label={user ? `Account — signed in as ${user.email}` : 'Account and settings'}
                title={user ? user.email : 'Account and settings'}
            >
                {initial ?? <PersonIcon />}
            </button>

            {open && (
                <div className="popover popover--end account-panel" role="menu">
                    <div className="account-identity">
                        {user ? (
                            <>
                                <span className="account-email">{user.email}</span>
                                {userRole && userRole !== 'user' && (
                                    <span className="badge-micro is-accent ml-2">{userRole.toUpperCase()}</span>
                                )}
                            </>
                        ) : (
                            <span className="text-note">Not signed in</span>
                        )}
                    </div>

                    <div className="account-row">
                        <span className="text-nano">Units</span>
                        {/* Two labeled halves rather than the bar's old `⇄ IMP`.
                            The glyph said a switch existed but never which way
                            it would go, and there is room for the words here. */}
                        <div className="segmented" role="group" aria-label="Units">
                            {['imperial', 'metric'].map(system => (
                                <button
                                    key={system}
                                    type="button"
                                    className={units === system ? 'active' : ''}
                                    aria-pressed={units === system}
                                    onClick={() => units !== system && onToggleUnits()}
                                >
                                    {system === 'imperial' ? 'Imperial' : 'Metric'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="account-row">
                        <span className="text-nano">Theme</span>
                        <div className="segmented" role="group" aria-label="Theme">
                            {THEME_CHOICES.map(([choice, label]) => (
                                <button
                                    key={choice}
                                    type="button"
                                    className={theme === choice ? 'active' : ''}
                                    aria-pressed={theme === choice}
                                    title={choice === 'system' ? 'Follow this device' : undefined}
                                    onClick={() => setTheme(choice)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Off until the user ticks it (migration 097). Hidden, not
                        disabled, while the column does not exist yet. */}
                    {user && emailOptIn !== null && (
                        <label className="account-opt-in">
                            <input
                                type="checkbox"
                                checked={emailOptIn}
                                onChange={e => onEmailOptInChange(e.target.checked)}
                            />
                            <span className="flex flex-col gap-0.5">
                                <span className="account-opt-in-label">Email me</span>
                                <span className="text-caption">Rare emails about major changes, at most once a quarter.</span>
                            </span>
                        </label>
                    )}

                    <button
                        type="button"
                        className="btn btn-secondary account-action"
                        onClick={() => { setOpen(false); (user ? onSignOut : onSignIn)(); }}
                    >
                        {user ? 'Sign out' : 'Sign in'}
                    </button>
                </div>
            )}
        </div>
    );
}
