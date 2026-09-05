import { useState } from 'react';
import { useLightDismiss } from '../../hooks/useLightDismiss';

/**
 * The account and settings control at the right end of the nav (#281).
 *
 * It replaces a `Sign In` button that cost 111px of a 375px bar — a quarter of
 * the width, spent on the one action a returning reader has already taken. It
 * is one 30px circle now, at every width, and what used to sit beside it in the
 * bar sits inside it: the signed-in email, the role, and the unit system.
 *
 * The units toggle MOVED here rather than being copied. It lived in the
 * selection strip, which is a strip about vehicles; a preference that repaints
 * every figure on every screen is not a property of the current selection, and
 * two controls for one setting is the drift this project keeps paying for.
 *
 * The light/dark toggle belongs in this menu too and is deliberately not built
 * yet — the re-skin is dark-only until the light pass lands.
 */
function PersonIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.7 0-5 1.5-5 3.4V14h10v-1.1c0-1.9-2.3-3.4-5-3.4Z" />
        </svg>
    );
}

export default function AccountMenu({ user, userRole, units, onToggleUnits, onSignIn, onSignOut }) {
    const [open, setOpen] = useState(false);
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
                <div className="account-panel" role="menu">
                    <div className="account-identity">
                        {user ? (
                            <>
                                <span className="account-email">{user.email}</span>
                                {userRole && userRole !== 'user' && (
                                    <span className="owner-badge">{userRole.toUpperCase()}</span>
                                )}
                            </>
                        ) : (
                            <span className="text-note">Not signed in</span>
                        )}
                    </div>

                    <div className="account-row">
                        <span className="text-nano">Units</span>
                        {/* Two labelled halves rather than the bar's old `⇄ IMP`.
                            The glyph said a switch existed but never which way
                            it would go, and there is room for the words here. */}
                        <div className="account-segmented">
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
