/**
 * A rate plan's day as a strip of 24 cells, midnight first, each in its
 * tier's color (dearest danger, middle neutral, cheapest success) and letter
 * (P, O, S: Peak, Off-peak, Super off-peak). With `onCycle`, a cell is a
 * button: a click moves that hour one tier cheaper, round from the cheapest
 * back to the dearest. Names: docs/vocabulary.md, Cost to Drive (Electricity
 * rates).
 */
import { TIER_LETTERS, CUSTOM_TIER_NAMES } from '../../constants/ratePlans';
import { hourText } from './DriveFields';

const TIER_CLASS = ['is-high', 'is-mid', 'is-low'];
/** Each tier's mark in a cell: the first letter of its custom name. */
const TIER_MARK = CUSTOM_TIER_NAMES.map(n => n[0]);
/** The letter after this one, H → M → L → H. */
const nextTier = (c) => TIER_LETTERS[(TIER_LETTERS.indexOf(c) + 1) % TIER_LETTERS.length];

export default function RateStrip({ map, tiers, label, onCycle = null }) {
    return (
        <div className="flex flex-col gap-0.5">
            <div className="rate-strip" role="group" aria-label={label}>
                {[...map].map((c, h) => {
                    const t = TIER_LETTERS.indexOf(c);
                    const title = `${hourText(h)}: ${tiers[t] ?? CUSTOM_TIER_NAMES[t]}`;
                    return onCycle
                        ? <button key={h} type="button" className={`rate-cell ${TIER_CLASS[t]}`} title={title} aria-label={title}
                            onClick={() => onCycle(map.slice(0, h) + nextTier(c) + map.slice(h + 1))}>{TIER_MARK[t]}</button>
                        : <span key={h} className={`rate-cell ${TIER_CLASS[t]}`} title={title}>{TIER_MARK[t]}</span>;
                })}
            </div>
            <div className="rate-strip-hours text-caption" aria-hidden="true">
                <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
            </div>
        </div>
    );
}

/** A tier's swatch, with its letter, for the price rows beside the strip. */
export function TierSwatch({ tier }) {
    return <span className={`rate-swatch ${TIER_CLASS[tier]}`} aria-hidden="true">{TIER_MARK[tier]}</span>;
}
