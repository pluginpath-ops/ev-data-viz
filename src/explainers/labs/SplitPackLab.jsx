import { useState } from 'react';
import { peakOnCharger } from '../peakOnCharger';
import { FACTS } from '../topics';
import { chargingTestsHref } from '../evbenchLinks';

/**
 * The Split Pack Lab: one pack on one charger, drawn two ways. On the left,
 * the pack as it is built (its halves in series) and what it takes when the
 * charger reaches its whole voltage. On the right, the same halves switched
 * into parallel for a lower-voltage charger, beside a booster that works
 * from the charger's full voltage instead. Model, not measurement.
 *
 * Presets rest on verified facts. Where one rests on an accepted or observed
 * figure, it names that fact in `flagged` and the lab says so on screen
 * (explainers.test.js holds both). Currents are continuous ratings: posts can
 * peak above them, which the caption says.
 */
/**
 * `runs` are EVBench charging tests of the car, for the "real data" link;
 * `runsNote` says when they are not quite the preset.
 *
 * `method` is how the car itself charges below its pack's voltage, so the lab
 * can mark its own bar: the same pack voltage reads very differently split
 * than boosted. Its fact is in `facts` or `flagged` like any other.
 */
export const PACKS = [
    { id: 'silverado', label: 'Chevy Silverado EV', packV: 600, method: 'split-pack', maxKw: 350, runs: [48, 49],
      facts: ['gm-ultium-trucks-800v'], flagged: ['silverado-split-halves-300v'],
      caveat: 'The Silverado’s split, and its halves of about 300 V while charging: observed by EVBench.' },
    { id: 'taycan', label: 'Porsche Taycan (2025+)', packV: 850, method: 'dc-booster', boosterKw: 150, maxKw: 320,
      runs: [45], runsNote: 'a Taycan J1.2, the generation before 2025',
      facts: ['taycan-epa-voltage', 'taycan-2025-booster', 'taycan-peak-kw'],
      caveat: 'Taycan: 850 V is the EPA’s figure, likely near full charge.' },
    { id: 'egmp', label: 'Hyundai Ioniq 5 / Kia EV6', packV: 697, method: 'dc-booster', boosterKw: 150, maxKw: 247, runs: [192, 238],
      facts: ['egmp-epa-voltage', 'egmp-motor-boost'], flagged: ['egmp-boost-kw', 'egmp-peak-kw'],
      caveat: 'Ioniq 5 / EV6: observed by EVBench, its 247 kW peak (from its tests) and its motor boost at about 120–150 kW depending on the model; the lab uses 150 kW.' },
    { id: 'gravity', label: 'Lucid Gravity', packV: 926, method: 'dc-booster', boosterKw: 225, maxKw: 400, runs: [23, 81],
      facts: ['lucid-gravity-voltage', 'lucid-gravity-400v-method', 'lucid-gravity-400v-kw', 'lucid-gravity-peak-kw'],
      caveat: '926 V is Lucid’s figure, near full charge.' },
];

export const CHARGERS = [
    { id: 'supercharger-v3', label: 'Tesla Supercharger (V3)', chargerV: 500, chargerA: 500, chargerKw: 250,
      facts: ['tesla-v4-cabinet-announcement'], flagged: ['older-chargers-500v', 'tesla-v3-boost-current'],
      caveat: 'Supercharger (V3): the 500 V ceiling is widely accepted, and 500 A is what EVBench has observed for non-Tesla cars; neither has a published source.' },
    { id: 'supercharger-v4', label: 'Tesla Supercharger (V4)', chargerV: 1000, chargerA: 615, chargerKw: 500,
      facts: ['tesla-v4-post-ratings', 'tesla-v4-cabinet-voltage'] },
    { id: 'abb-terra-360', label: 'ABB Terra 360', chargerV: 920, chargerA: 500, chargerKw: 360, facts: ['abb-terra360-ratings'] },
    { id: 'alpitronic-hyc400', label: 'Alpitronic HYC400', chargerV: 1000, chargerA: 600, chargerKw: 400, facts: ['alpitronic-hyc400-ratings'] },
];

/**
 * The booster a car without a sourced rating of its own is compared against:
 * rated like the Gravity's motor boost, the highest on record. A booster car
 * with a sourced rating (`boosterKw`) uses its own.
 */
export const BOOSTER = { kw: 225, facts: ['lucid-gravity-400v-kw'], flagged: ['booster-input-voltage'],
    caveat: 'Boosters draw at 450 V at most: observed by EVBench.' };

const LIMIT_TEXT = {
    charger: 'the charger’s power',
    current: 'the charger’s current',
    booster: 'the booster’s rating',
    car: 'the car’s own maximum',
    voltage: 'the pack is above the charger’s voltage',
};

export default function SplitPackLab() {
    const [pack, setPack] = useState(PACKS[0]);
    const [charger, setCharger] = useState(CHARGERS[0]);

    const half = pack.packV / 2;
    const carKw = pack.maxKw;
    const whole = peakOnCharger('direct', charger, { packV: pack.packV, carKw });
    const split = peakOnCharger('split-pack', charger, { packV: pack.packV, carKw });
    const boosterKw = pack.boosterKw ?? BOOSTER.kw;
    const boost = peakOnCharger('dc-booster', charger, { packV: pack.packV, boosterKw, carKw });
    const reachesWhole = whole.fits;
    // A full bar is the car's own maximum, so every bar reads as a share of it.
    const scale = carKw;
    // The current the charger's cable carries for each: at the whole pack's
    // voltage, at half of it, or at the charger's own voltage for a booster.
    // When current is what binds, it is the charger's rating exactly; kW is
    // rounded, so working it back would show 499 or 501 A.
    const cable = (r, v) => (r.limit === 'current' ? charger.chargerA : Math.min(r.kw * 1000 / v, charger.chargerA));
    const amps = {
        whole: cable(whole, pack.packV),
        split: cable(split, half),
        boost: cable(boost, boost.inputV ?? charger.chargerV),
    };
    const caveats = [pack.caveat, charger.caveat, BOOSTER.caveat].filter(Boolean);

    return (
        <figure className="explainer-lab">
            <div className="explainer-lab-head">
                <span className="text-micro">Split Pack Lab</span>
                <span className="explainer-model-badge">Model, not measurement</span>
            </div>

            <ChipRow label="Pack" items={PACKS} value={pack} onChange={setPack} />
            <ChipRow label="Charger" items={CHARGERS} value={charger} onChange={setCharger}
                detail={`up to ${charger.chargerV} V · ${charger.chargerA} A`} />
            <p className="explainer-lab-scale text-note">
                A full bar is this car’s own maximum: <span className="text-data">{carKw} kW</span>.
                {pack.runs?.length > 0 && (
                    <>
                        {' '}
                        <a className="explainer-link" href={chargingTestsHref({ runIds: pack.runs })}>
                            See its {pack.runs.length === 1 ? 'charging test' : `${pack.runs.length} charging tests`} →
                        </a>
                        {pack.runsNote && <> ({pack.runsNote})</>}
                    </>
                )}
            </p>

            <div className="explainer-lab-columns">
                <section className={`explainer-lab-column${reachesWhole ? '' : ' is-moot'}`}>
                    <h4 className="explainer-lab-column-title">As one pack: halves in series</h4>
                    <PackDiagram mode="series" half={half} />
                    <p className="explainer-lab-total">
                        <span className="text-data">{Math.round(pack.packV)} V</span> at the charger
                    </p>
                    <div className="explainer-lab-bars">
                        <Bar label="Whole pack" result={whole} amps={amps.whole} scale={scale} kind="direct" />
                    </div>
                    {!reachesWhole && (
                        <p className="text-note">Charger does not support full pack voltage.</p>
                    )}
                </section>

                <section className={`explainer-lab-column${reachesWhole ? ' is-moot' : ''}`}>
                    <h4 className="explainer-lab-column-title">Below the pack’s voltage: split, or boost</h4>
                    <PackDiagram mode="parallel" half={half} />
                    <p className="explainer-lab-total">
                        <span className="text-data">{Math.round(half)} V</span> at the charger when split
                    </p>
                    <div className="explainer-lab-bars">
                        <Bar label="Split pack" result={split} amps={amps.split} scale={scale} kind="split-pack"
                            isOwn={pack.method === 'split-pack'} />
                        <Bar label="Booster" rating={`rated ${boosterKw} kW`} result={boost} amps={amps.boost} scale={scale} kind="dc-booster"
                            isOwn={pack.method === 'dc-booster'} />
                    </div>
                    {reachesWhole && (
                        <p className="text-note">Charger supports full pack voltage: no split or boost needed.</p>
                    )}
                </section>
            </div>

            <figcaption className="explainer-lab-caption">
                <span className="text-note">
                    The most each option can take from this charger before the cells have a say. Amps are what the
                    charger’s cable carries, worked out from power and voltage, not measured; a booster draws at
                    450 V at most, even from a 500 V charger. It uses continuous
                    current ratings and leaves out conversion loss; posts can peak above their rating (a Cybertruck
                    reaches 325 kW on a V4 post). A booster uses the car’s own rating where one is on record, and
                    otherwise the Lucid Gravity’s 225 kW.
                </span>
                {caveats.map(c => <span key={c} className="explainer-lab-caveat">{c}</span>)}
            </figcaption>
        </figure>
    );
}

function ChipRow({ label, items, value, onChange, detail }) {
    return (
        <div className="explainer-lab-field">
            <span className="text-label">{label}</span>
            <span className="explainer-lab-presets">
                {items.map(item => (
                    <button key={item.id} type="button" className="explainer-chip"
                        aria-pressed={item.id === value.id} onClick={() => onChange(item)}>
                        {item.label}
                    </button>
                ))}
                {detail && <span className="text-meta">{detail}</span>}
            </span>
        </div>
    );
}

/** A vertical bar: kW and the cable's current on top, what limits it underneath. */
function Bar({ label, rating, result, amps, scale, kind, isOwn = null }) {
    const height = result.fits ? Math.max((result.kw / scale) * 100, 2) : 0;
    return (
        <div className={`explainer-lab-vbar${isOwn === true ? ' is-own' : isOwn === false ? ' is-other' : ''}`}>
            <span className="explainer-lab-vbar-own">{isOwn ? 'This car' : '\u00a0'}</span>
            <span className="explainer-lab-vbar-value">
                <span className="text-data">{result.fits ? `${result.kw} kW` : '—'}</span>
                {result.fits && <span className="explainer-lab-vbar-amps text-data">{Math.round(amps)} A</span>}
            </span>
            <span className="explainer-lab-vbar-track">
                <span className={`explainer-lab-vbar-fill is-${kind}`} style={{ height: `${height}%` }} />
            </span>
            <span className="explainer-lab-vbar-label">{label}</span>
            <span className="explainer-lab-vbar-limit text-note">
                {rating && <>{rating}<br /></>}
                {result.fits ? `limited by ${LIMIT_TEXT[result.limit]}` : `cannot charge: ${LIMIT_TEXT.voltage}`}
            </span>
        </div>
    );
}

/**
 * Two halves and a charger. Every wire is straight or turns once: in series
 * the charger's + meets the top half, a link joins the halves on the right,
 * and the bottom half returns to −; in parallel both halves sit between a +
 * bus on the left and a − bus on the right.
 */
function PackDiagram({ mode, half }) {
    const halfLabel = `half · ${Math.round(half)} V`;
    return (
        <svg className="explainer-diagram" viewBox="0 0 320 170" role="img"
            aria-label={mode === 'series'
                ? `Two halves of ${Math.round(half)} V in series: ${Math.round(half * 2)} V at the charger`
                : `Two halves of ${Math.round(half)} V in parallel: ${Math.round(half)} V at the charger`}>
            <rect x="10" y="30" width="60" height="130" rx="6" className="explainer-diagram-charger" />
            <text x="40" y="99" textAnchor="middle" className="explainer-diagram-text">Charger</text>
            <text x="78" y="44" className="explainer-diagram-label">+</text>

            <rect x="140" y="32" width="120" height="36" rx="6" className="explainer-diagram-cells" />
            <text x="200" y="55" textAnchor="middle" className="explainer-diagram-text">{halfLabel}</text>
            <rect x="140" y="92" width="120" height="36" rx="6" className="explainer-diagram-cells" />
            <text x="200" y="115" textAnchor="middle" className="explainer-diagram-text">{halfLabel}</text>

            {mode === 'series' ? (
                <g className="explainer-diagram-wire">
                    <path d="M70 50 H140" />
                    <path d="M260 50 H290 V110 H260" />
                    <path d="M140 110 H70" />
                    <text x="78" y="125" className="explainer-diagram-label">−</text>
                </g>
            ) : (
                <g className="explainer-diagram-wire">
                    <path d="M70 50 H140" />
                    <path d="M115 50 V110 H140" />
                    <path d="M260 50 H290 V150 H70" />
                    <path d="M260 110 H290" />
                    <text x="78" y="145" className="explainer-diagram-label">−</text>
                </g>
            )}
        </svg>
    );
}

/** Every fact the presets rest on, for the test: verified, or flagged on screen. */
export const PRESET_FACTS = [...PACKS, ...CHARGERS, { id: 'booster', ...BOOSTER }].map(p => ({
    id: p.id, facts: p.facts, flagged: p.flagged ?? [], caveat: p.caveat ?? null,
    statuses: [...p.facts, ...(p.flagged ?? [])].map(id => FACTS.get(id)?.status),
}));
