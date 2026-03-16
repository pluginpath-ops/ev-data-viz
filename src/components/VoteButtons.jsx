/**
 * VoteButtons — three reusable vote widgets for accuracy vouching and flagging.
 *
 * SpecVouchButton    — whole-vehicle spec vouch (👍 with count)
 * SpecFieldFlagButton — per-field flag inline button (🚩)
 * RunVoteButtons      — vouch/flag pair for a run (👍 N  🚩 N)
 */

// ── SpecVouchButton ────────────────────────────────────────────────────────────

/**
 * Props:
 *   count    {number}   — total vouch count
 *   myVouch  {boolean}  — whether the current browser has vouched
 *   onVouch  {function} — called when button is clicked
 *   readOnly {boolean}  — show count only, no click (for editors viewing their own form)
 */
export function SpecVouchButton({ count = 0, myVouch = false, onVouch, readOnly = false }) {
    if (readOnly) {
        return count > 0 ? (
            <span className="vote-readonly">
                👍 {count} {count === 1 ? 'person vouched' : 'people vouched'} for accuracy
            </span>
        ) : null;
    }

    return (
        <button
            className={`vote-btn vote-btn-vouch${myVouch ? ' vote-btn-active' : ''}`}
            onClick={onVouch}
            title={myVouch ? 'Remove your vouch' : 'Vouch that these specs look accurate'}
        >
            👍 {myVouch ? 'Vouched' : 'Vouch for accuracy'}{count > 0 ? ` (${count})` : ''}
        </button>
    );
}

// ── SpecFieldFlagButton ────────────────────────────────────────────────────────

/**
 * Small inline 🚩 button shown next to a spec field value.
 *
 * Props:
 *   isFlagged {boolean}  — whether this field is currently flagged
 *   onFlag    {function} — called to add a flag
 *   onUnflag  {function} — called to remove a flag (admin only)
 *   isAdmin   {boolean}  — shows unflag option if true and field is already flagged
 */
export function SpecFieldFlagButton({ isFlagged = false, onFlag, onUnflag, isAdmin = false }) {
    if (isFlagged) {
        return (
            <button
                className="vote-btn vote-btn-flag vote-btn-active"
                onClick={isAdmin ? onUnflag : undefined}
                style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                title={isAdmin ? '🚩 Users flagged this value — click to clear' : '🚩 Users have flagged this value as potentially inaccurate'}
            >
                🚩{isAdmin && <span className="text-xs opacity-70 ml-0.5">×</span>}
            </button>
        );
    }

    return (
        <button
            className="vote-btn vote-btn-flag"
            onClick={onFlag}
            title="Flag this value as potentially inaccurate"
        >
            🚩
        </button>
    );
}

// ── RunVoteButtons ─────────────────────────────────────────────────────────────

/**
 * Vouch / Flag pair for a run card.
 *
 * Props:
 *   vouch   {number}              — vouch count
 *   flag    {number}              — flag count
 *   myVote  {'vouch'|'flag'|null} — current browser's vote
 *   onVote  {function(voteType)}  — called with 'vouch' or 'flag'
 */
export function RunVoteButtons({ vouch = 0, flag = 0, myVote = null, onVote }) {
    return (
        <span className="run-vote-buttons">
            <button
                className={`vote-btn vote-btn-vouch${myVote === 'vouch' ? ' vote-btn-active' : ''}`}
                onClick={() => onVote('vouch')}
                title={myVote === 'vouch' ? 'Remove your vouch' : 'Vouch that this test data looks accurate'}
            >
                👍{vouch > 0 ? ` ${vouch}` : ''}
            </button>
            <button
                className={`vote-btn vote-btn-flag${myVote === 'flag' ? ' vote-btn-active' : ''}`}
                onClick={() => onVote('flag')}
                title={myVote === 'flag' ? 'Remove your flag' : 'Flag this test data as questionable'}
            >
                🚩{flag > 0 ? ` ${flag}` : ''}
            </button>
        </span>
    );
}
