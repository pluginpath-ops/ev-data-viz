import { useId, useMemo, useState } from 'react';
import Popover from './Popover';
import {
    SERIES_PALETTES, DEFAULT_RUN_COLOR, seriesColorNote, isUnsetColor, sameHex,
    paletteSlotOf, hexToHsl, hslToHex, rotatePaletteFrom, rampFrom, seedPlot,
} from '../utils/colorUtils';
import { ratioOf, AA_LARGE } from '../utils/contrast';
import { chartTheme } from '../utils/chartTheme';

/**
 * Pick the colour a series is drawn in — and, through it, the set.
 *
 * ── Why this is not an <input type="color"> ─────────────────────────────────
 *
 * It was, in five places. That control opens the browser's own dialog: one
 * colour at a time, over the top of the chart, with no view of the set you are
 * picking against — which is the entire problem, because a series colour only
 * means anything RELATIVE to the other series on the same plot. It also varies
 * by browser, so "the colour picker" was not even one control.
 *
 * ── A pick is a BASE, not one series' colour ────────────────────────────────
 *
 * Setting a colour here fixes it as slot 1 and the rest of the set is
 * re-derived from it. That is what the two derivations mean, and they are the
 * same two the scope control offers:
 *
 *   rotation    the palette re-ordered to lead with the base — different hues,
 *               which is what a whole plot of unrelated tests wants
 *   light→dark  one hue in lightness steps, anchored so it runs AWAY from the
 *               base — which is what one vehicle's runs want, so a chart reads
 *               as families first and runs second (handoff 3c)
 *
 * The preview shows both before you commit either, because "what will this do
 * to everything else" is the question the old control could not answer.
 *
 * ── Nothing here writes to the database ─────────────────────────────────────
 *
 * Every scope is a SESSION override. Reading a chart must never edit stored
 * data for every other visitor, whatever role you hold — so the charting page
 * has no durable path at all, and 3c's per-run steps are computed at render
 * rather than stored. The durable `runs.color` preference is edited in Tests &
 * Data, which is the screen that owns it; there, this control has no scope
 * selector because there is nothing to scope.
 *
 * @param {string}  value       the colour actually being drawn right now
 * @param {string}  [stored]    the durable preference, where one can differ
 * @param {(hex: string) => void} onChange   commit for this series alone
 * @param {() => void} [onReset]  hand it back to the palette. Supplying it is
 *                              what puts "Auto" in the panel
 * @param {string}  [label]     what is being coloured
 * @param {string|number} [seriesId]   this series' id, and
 * @param {string|number} [vehicleId]  the vehicle it belongs to — both needed
 *                              before a scope wider than one series means anything
 * @param {Array<{id, vehicleId, stored}>} [series]  everything plotted
 * @param {(map: Record<string,string>) => void} [onApplyMany]  commit a whole
 *                              derived set. Supplying it, with `series`, is
 *                              what puts the scope control in the panel
 * @param {string}  [className]
 */
export default function SeriesColorPicker({
    value,
    stored = null,
    onChange,
    onReset = null,
    label = '',
    vehicleName = '',
    seriesId = null,
    vehicleId = null,
    series = null,
    onApplyMany = null,
    isAuto = null,
    className = '',
}) {
    const plotted = value || DEFAULT_RUN_COLOR;
    const subject = label || 'this series';

    // The scope control only appears when the owner can actually honour it.
    const scoped = Boolean(onApplyMany && series?.length && seriesId != null);

    return (
        <Popover
            className={className}
            // No "Color —" prefix: a panel of swatches and a hue slider is not
            // ambiguous about what it is, and the words cost the room the
            // vehicle needs. The vehicle IS worth carrying — a test called
            // "Supercharger (EST)" says nothing about which car it belongs to,
            // and the wider scopes act on a vehicle by name.
            title={[vehicleName, label].filter(Boolean).join(' · ') || 'Series color'}
            // One width everywhere: the rail, Tests & Data and a chip all get
            // the same panel, so it never reflows to suit its anchor.
            width="300px"
            peek={
                <>
                    <ColorNote note={seriesColorNote(stored, plotted)} />
                    <span className="popover-more">Click for the palette</span>
                </>
            }
            trigger={({ onClick, ...props }) => (
                <button
                    {...props}
                    type="button"
                    className="series-swatch--button"
                    style={{ backgroundColor: plotted }}
                    aria-label={`Color for ${subject} — ${plotted}`}
                    // Three of the call sites sit inside a <label> wrapping the
                    // row's checkbox, so a click reaching the label toggles the
                    // run's selection too. A swatch means "open the colour
                    // panel" and never anything an ancestor has a claim on, so
                    // it is stopped here, once, rather than at each site.
                    onClick={e => { e.stopPropagation(); onClick(e); }}
                />
            )}
        >
            {({ close }) => (
                <PickerPanel
                    close={close}
                    plotted={plotted}
                    stored={stored}
                    autoInForce={isAuto ?? isUnsetColor(stored)}
                    onChange={onChange}
                    onReset={onReset}
                    scoped={scoped}
                    seriesId={seriesId}
                    vehicleId={vehicleId}
                    series={series}
                    onApplyMany={onApplyMany}
                />
            )}
        </Popover>
    );
}

/**
 * The panel body, mounted fresh each time the popover opens — which is what
 * makes "the draft starts from what is on the chart" true without an effect
 * watching for it.
 */
function PickerPanel({
    close, plotted, stored, onChange, onReset, autoInForce,
    scoped, seriesId, vehicleId, series, onApplyMany,
}) {
    // Radios group by `name`, so two pickers open at once would share a group
    // and fight. They cannot both be open today — the popover is one at a time
    // — but a name that is only unique by luck is a bug waiting for a second
    // caller.
    const panelId = useId();
    const [paletteId, setPaletteId] = useState(SERIES_PALETTES[0].id);

    // Two axes, not one. SCOPE says who a pick reaches; DERIVATION says what it
    // does to them. They were welded — one vehicle always got shades, everything
    // always got separate colours — which assumed a family is the only reason to
    // recolour a vehicle. It is not: telling four tests of ONE car apart wants
    // maximum contrast for the same reason telling four cars apart does.
    const [scope, setScope] = useState('test');
    const [mode, setMode] = useState('shades');

    // ── HSL is the model; the hex is a projection of it ─────────────────────
    //
    // Both are held, and that is not redundancy. hex → HSL is LOSSY at the ends:
    // every hue is white at full lightness and black at none, so there is no hue
    // for hexToHsl to report back and it can only answer zero. Re-deriving the
    // sliders from the hex each render therefore destroyed the hue the moment
    // lightness reached either end. Saturation is lossy the same way.
    const [base, setBaseHex] = useState(plotted);
    const [hsl, setHsl] = useState(() => hexToHsl(plotted));

    // Touching any colour control means you are choosing by hand, which is what
    // takes Auto out of force — live, before anything commits, so the panel
    // stops claiming a state you have already left.
    const [touched, setTouched] = useState(false);

    const setBase = (hex) => { setTouched(true); setBaseHex(hex); setHsl(hexToHsl(hex)); };
    const nudge = (patch) => {
        const next = { ...hsl, ...patch };
        setTouched(true);
        setHsl(next);
        setBaseHex(hslToHex(next));
    };

    const palette = SERIES_PALETTES.find(p => p.id === paletteId) ?? SERIES_PALETTES[0];
    const slot = paletteSlotOf(base, palette.colors);

    // Who each scope would touch, in a stable order so a set is reproducible.
    const targets = useMemo(() => {
        if (!scoped || scope === 'test') return [];
        const rows = scope === 'vehicle'
            ? series.filter(s => s.vehicleId === vehicleId)
            : series;
        // The series being edited leads its own set: it is the base, so it must
        // be the one that keeps the colour that was picked.
        return [...rows].sort((a, b) =>
            (a.id === seriesId ? -1 : 0) - (b.id === seriesId ? -1 : 0));
    }, [scoped, scope, series, vehicleId, seriesId]);

    const handSet = targets.filter(t => !isUnsetColor(t.stored)).length;

    // ── Three outcomes, one choice ──────────────────────────────────────────
    //
    // This was two independent toggles with an "at least one" rule, which made
    // the first row's label depend on the second row's state: rotation means
    // per-vehicle when shading groups it and per-test when nothing does. That
    // is a relationship a reader had to derive from two controls before knowing
    // what either would do. There are only ever three answers, so they are
    // three answers now, and each says its own name.
    //
    // "A color per vehicle" needs more than one vehicle to mean anything, so it
    // is only offered when there is one — which is also why the vehicle scope
    // shows two options rather than three.
    const vehicleCount = new Set(targets.map(t => t.vehicleId)).size;
    const options = DERIVATIONS.filter(d => !d.needsVehicles || vehicleCount > 1);
    const how = (DERIVATIONS.find(d => d.id === mode) ?? DERIVATIONS[0]).how;

    // A scope change can take the current answer off the menu.
    const pickScope = (id) => {
        setScope(id);
        setMode(id === 'all' ? 'family' : 'shades');
    };

    // Auto answers for the SCOPE. Asking only about this series said "the
    // palette is choosing" while twelve other rows in the selected scope were
    // being held by hand — true of the swatch you opened, and wrong about the
    // button's own reach.
    const scopeAuto = scope === 'test' || !targets.length
        ? autoInForce
        : targets.every(t => t.auto);
    const auto = scopeAuto && !touched;

    const derived = useMemo(
        () => (targets.length ? seedPlot(base, targets, how, palette.colors) : null),
        [targets, base, how, palette],
    );

    // Chosen "family" and then narrowed the scope to one vehicle: the answer is
    // no longer on the menu, so fall back rather than silently doing something
    // the panel is not showing as selected.
    const active = options.some(o => o.id === mode) ? mode : options[options.length - 1].id;

    // "All tests" states its blast radius before it will commit; the other two
    // commit on click, because one series and one vehicle are both undoable by
    // looking at them.
    const armed = scope === 'all';

    const commit = () => {
        if (scope === 'test' || !derived) onChange(base);
        else onApplyMany(derived);
        close();
    };

    // Auto follows the scope, which is the whole reason it moved: with it sitting
    // beside "slot 3 of 8" it looked like a property of this one swatch, and
    // choosing "All tests" then pressing it plainly ought to hand ALL of them
    // back to the palette.
    const goAuto = () => {
        if (scope === 'test' || !targets.length) onReset();
        else onApplyMany(Object.fromEntries(targets.map(t => [t.id, null])));
        close();
    };

    const ratio = ratioOf(base, chartTheme().background);

    return (
        <>
            <div className="color-picker-body">
                {scoped && (
                    <div className="stats-segmented color-scope" role="group" aria-label="Apply to">
                        {[['test', 'This test'], ['vehicle', 'This vehicle'], ['all', 'All tests']]
                            .map(([id, text]) => (
                                <button
                                    key={id}
                                    type="button"
                                    className={scope === id ? 'active' : ''}
                                    aria-pressed={scope === id}
                                    onClick={() => pickScope(id)}
                                >
                                    {text}
                                </button>
                            ))}
                    </div>
                )}

                {onReset && (
                    <button
                        type="button"
                        className={`color-auto${auto ? ' is-on' : ''}`}
                        aria-pressed={auto}
                        disabled={auto}
                        onClick={goAuto}
                        title={auto
                            ? 'The palette is choosing this colour'
                            : 'Hand it back to the palette'}
                    >
                        {auto ? autoOnLabel(scope, targets.length) : `Back to auto${scopeSuffix(scope, targets.length)}`}
                    </button>
                )}

                {/* Dimmed while Auto holds, not disabled: touching anything here
                    IS how you take it off auto, so it must stay reachable. */}
                <div className={`color-manual${auto ? ' is-idle' : ''}`}>
                    {/* No label beside it. The select already reads "Okabe-Ito";
                        saying it twice cost a line to wrapping and told nobody
                        anything. */}
                    <label className="color-switch">
                        <select value={paletteId} onChange={e => setPaletteId(e.target.value)} aria-label="Palette">
                            {SERIES_PALETTES.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.label}{p.safe ? '' : ' (not colorblind-safe)'}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="color-slots" role="group" aria-label={`${palette.label} palette`}>
                        {palette.colors.map((hex, i) => (
                            <button
                                key={hex}
                                type="button"
                                className={`color-slot${sameHex(hex, base) ? ' is-current' : ''}`}
                                style={{ backgroundColor: hex }}
                                aria-label={`Slot ${i + 1}, ${hex}`}
                                aria-pressed={sameHex(hex, base)}
                                onClick={() => setBase(hex)}
                            />
                        ))}
                    </div>

                    <label className="color-hex">
                        <span className="color-hex-chip" style={{ backgroundColor: base }} />
                        <input
                            type="text"
                            value={base.toUpperCase()}
                            maxLength={7}
                            spellCheck={false}
                            aria-label="Base color, hex"
                            onChange={e => {
                                const v = e.target.value.trim();
                                if (/^#[0-9a-fA-F]{6}$/.test(v)) setBase(v.toLowerCase());
                            }}
                        />
                        <span className="text-caption">
                            {slot ? `slot ${slot} of ${palette.colors.length}` : 'off-palette'}
                        </span>
                    </label>

                    <Slider label="Hue" min={0} max={360} value={Math.round(hsl.h)}
                        track="hue" onChange={h => nudge({ h })} />
                    <Slider label="Saturation" min={0} max={100} value={Math.round(hsl.s)}
                        track="saturation" hue={hsl.h} sat={hsl.s} lit={hsl.l}
                        onChange={sat => nudge({ s: sat })} />
                    <Slider label="Lightness" min={0} max={100} value={Math.round(hsl.l)}
                        track="lightness" hue={hsl.h} sat={hsl.s} lit={hsl.l}
                        onChange={l => nudge({ l })} />

                    {targets.length > 1 && (
                        <div className="color-seed" role="radiogroup" aria-label="How to color the set">
                            {options.map(o => (
                                <SeedRow
                                    key={o.id}
                                    group={`${panelId}-derivation`}
                                    name={o.name}
                                    hint={o.hint}
                                    colors={o.preview(base, palette.colors)}
                                    active={o.id === active}
                                    onSelect={() => setMode(o.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="color-row color-readout">
                    <ColorNote note={seriesColorNote(stored, base)} />
                    {ratio && (
                        <span className={`text-caption${ratio < AA_LARGE ? ' is-weak' : ''}`}>
                            {ratio.toFixed(1)}:1 on plot{ratio < AA_LARGE ? ' · faint' : ''}
                        </span>
                    )}
                </div>

                {/* One line, and only when there is something to lose. The
                    button already says how many series are reseeded; what a
                    reader cannot see is how much of it was chosen by a person. */}
                {armed && handSet > 0 && (
                    <p className="color-warning">
                        {handSet} hand-set color{handSet === 1 ? '' : 's'} will be overwritten
                    </p>
                )}
            </div>

            <div className="popover-foot">
                {/* Said out loud, because the whole panel turns on it: nothing
                    here reaches the database, at any scope or any role. Two
                    words, not four — at 300px "Session override" wrapped to two
                    lines and took the commit button with it. */}
                <span className="text-nano" title="Nothing here is saved — it applies to this session only">
                    Session only
                </span>
                <span className="popover-foot-gap" />
                <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
                <button
                    type="button"
                    className={armed ? 'btn btn-warning' : 'btn btn-primary'}
                    onClick={commit}
                >
                    {armed ? `Overwrite ${targets.length}` : 'Apply'}
                </button>
            </div>
        </>
    );
}

/**
 * Every way a base can seed a set, as named outcomes.
 *
 * Each carries its own preview, and the previews are structurally honest rather
 * than decorative: "a color per vehicle" shows two hues with two steps each,
 * because that is the shape of what it does. It is the preview that lets the
 * label stay short enough to fit on one line at 300px.
 */
const DERIVATIONS = [
    {
        id: 'distinct',
        name: 'A color per test',
        hint: 'Every test takes its own color from the palette',
        how: { rotate: true, shade: false },
        preview: (base, colors) => rotatePaletteFrom(base, colors, 4).slice(0, 4),
    },
    {
        id: 'family',
        name: 'A color per vehicle',
        hint: 'Each vehicle takes the next color; its own tests step along it',
        how: { rotate: true, shade: true },
        needsVehicles: true,
        preview: (base, colors) => {
            const [a, b] = rotatePaletteFrom(base, colors, 2);
            return [...rampFrom(a, 2), ...rampFrom(b, 2)];
        },
    },
    {
        id: 'shades',
        name: 'Shades of one color',
        hint: 'Everything shares one color, a step apart per test',
        how: { rotate: false, shade: true },
        preview: (base) => rampFrom(base, 4),
    },
];

/** Names what "Back to auto" would release, so the button cannot mislead. */
function scopeSuffix(scope, count) {
    if (scope === 'vehicle') return ` — ${count} on this vehicle`;
    if (scope === 'all') return ` — all ${count}`;
    return '';
}

/** And what it is already true OF, for the same reason. */
function autoOnLabel(scope, count) {
    if (scope === 'test' || !count) return 'Auto — the palette is choosing';
    return `Auto — all ${count} on the palette`;
}

/**
 * A labelled range whose track shows what it controls. The hue track is the
 * spectrum; the lightness track is the CURRENT hue from black to white, so the
 * slider is a preview of its own result rather than a grey bar with a number.
 */
function Slider({ label, min, max, value, onChange, track, hue = 0, sat = 100, lit = 50 }) {
    return (
        <label className="color-slider">
            <span className="text-nano">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                className={`color-slider-input is-${track}`}
                style={track === 'hue' ? undefined : {
                    '--track-hue': `${hue}`,
                    '--track-sat': `${sat}%`,
                    '--track-lit': `${lit}%`,
                }}
                onChange={e => onChange(Number(e.target.value))}
            />
        </label>
    );
}

/**
 * One outcome: a real radio, its name, and a preview of what it produces.
 *
 * A NATIVE `<input type="radio">` rather than a styled button with
 * `aria-pressed`. Three mutually exclusive answers is exactly what the element
 * is for, and using it means arrow-key navigation within the group, the
 * radiogroup semantics and the focus ring all arrive without being written —
 * and a later pass at the app's radio styling reaches this for free, since
 * there is almost nothing here to override.
 *
 * The preview sits on the right and is structurally honest: "a color per
 * vehicle" shows two hues with two steps each, because that is the shape of
 * what it does. Carrying the nuance there is what lets the label stay short
 * enough to fit one line at 300px.
 */
function SeedRow({ group, name, hint, colors, active, onSelect }) {
    return (
        <label className={`color-row color-seed-row${active ? ' is-active' : ''}`} title={hint}>
            <input
                type="radio"
                name={group}
                checked={active}
                onChange={onSelect}
                className="color-seed-radio"
            />
            <span className="color-seed-name">{name}</span>
            <span className="color-seed-chips">
                {colors.map((c, i) => (
                    <span key={`${c}-${i}`} className="series-swatch" style={{ backgroundColor: c }} />
                ))}
            </span>
        </label>
    );
}

/**
 * The stored-versus-drawn sentence. Silent in the one case where there is
 * genuinely nothing to report — a stored colour that is also the drawn one —
 * because a line that always shows up stops being read.
 */
function ColorNote({ note }) {
    if (note.kind === 'saved') return null;
    return (
        <span className="color-note">
            {note.kind === 'auto'
                ? <>No saved color — drawn <b>{note.plotted.toUpperCase()}</b></>
                : <>Saved <b>{note.stored.toUpperCase()}</b> · drawn <b>{note.plotted.toUpperCase()}</b></>}
        </span>
    );
}
