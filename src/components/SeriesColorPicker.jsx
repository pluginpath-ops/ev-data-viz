import { useMemo, useState } from 'react';
import Popover from './Popover';
import {
    SERIES_PALETTES, DEFAULT_RUN_COLOR, seriesColorNote, isUnsetColor, sameHex,
    paletteSlotOf, hexToHsl, hslToHex, rotatePaletteFrom, rampFrom,
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
    seriesId = null,
    vehicleId = null,
    series = null,
    onApplyMany = null,
    className = '',
}) {
    const plotted = value || DEFAULT_RUN_COLOR;
    const subject = label || 'this series';

    // The scope control only appears when the owner can actually honour it.
    const scoped = Boolean(onApplyMany && series?.length && seriesId != null);

    return (
        <Popover
            className={className}
            title={label ? `Color — ${label}` : 'Series color'}
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
    close, plotted, stored, onChange, onReset,
    scoped, seriesId, vehicleId, series, onApplyMany,
}) {
    const [paletteId, setPaletteId] = useState(SERIES_PALETTES[0].id);

    // Two axes, not one. SCOPE says who a pick reaches; DERIVATION says what it
    // does to them. Welding them — one vehicle always gets shades, everything
    // always gets separate colours — assumed that a family is the only reason
    // to recolour a vehicle, and it is not: telling four tests of ONE car apart
    // wants maximum contrast between them, exactly like telling four cars apart.
    // Each scope still has the derivation it usually wants as its default; the
    // rows below are how you say otherwise.
    const [scope, setScope] = useState('test');
    const [derivation, setDerivation] = useState('shades');
    const pickScope = (id) => {
        setScope(id);
        setDerivation(id === 'all' ? 'distinct' : 'shades');
    };

    // ── HSL is the model; the hex is a projection of it ─────────────────────
    //
    // Both are held, and that is not redundancy. hex → HSL is LOSSY at the
    // ends: every hue is white at full lightness and black at none, so there is
    // no hue for hexToHsl to report back and it can only answer zero.
    // Re-deriving the sliders from the hex each render therefore destroyed the
    // hue the moment lightness reached either end — the hue thumb snapped to
    // red and stayed there, and dragging lightness back gave grey instead of
    // the colour you started from.
    //
    // Saturation is lossy in the same way and for the same reason, which is the
    // other half of why the model is held rather than recomputed.
    //
    // Keeping HSL means the hue survives a trip to white and back. A slider
    // writes the model and the hex follows; every other route into the panel —
    // a palette slot, a typed hex — writes the hex and the model follows.
    const [base, setBaseHex] = useState(plotted);
    const [hsl, setHsl] = useState(() => hexToHsl(plotted));

    const setBase = (hex) => { setBaseHex(hex); setHsl(hexToHsl(hex)); };
    const nudge = (patch) => {
        const next = { ...hsl, ...patch };
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
        // be the one that actually keeps the colour that was picked.
        return [...rows].sort((a, b) =>
            (a.id === seriesId ? -1 : 0) - (b.id === seriesId ? -1 : 0));
    }, [scoped, scope, series, vehicleId, seriesId]);

    const handSet = targets.filter(t => !isUnsetColor(t.stored)).length;

    // The two derivations, and the scope each one serves.
    const derived = useMemo(() => {
        if (!targets.length) return null;
        const colors = derivation === 'shades'
            ? rampFrom(base, targets.length)
            // The count matters: without it the rotation wraps with a modulo and
            // a twelve-series plot gets eight colours and four duplicates.
            : rotatePaletteFrom(base, palette.colors, targets.length);
        return Object.fromEntries(targets.map((t, i) => [t.id, colors[i % colors.length]]));
    }, [derivation, targets, base, palette]);

    // "All tests" states its blast radius before it will commit; the other two
    // commit on click, because one series and one vehicle are both undoable by
    // looking at them.
    const armed = scope === 'all';

    const commit = () => {
        if (scope === 'test' || !derived) onChange(base);
        else onApplyMany(derived);
        close();
    };

    const plotBg = chartTheme().background;
    const ratio = ratioOf(base, plotBg);

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

                <div className="color-row">
                    {onReset && (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => { onReset(); close(); }}
                            title="Hand this series back to the palette"
                        >
                            Auto
                        </button>
                    )}
                    <span className="text-caption">
                        {slot ? `slot ${slot} of ${palette.colors.length}` : 'off-palette'}
                    </span>
                </div>

                <div className="color-row">
                    <span className="text-nano">Palette · {palette.label}</span>
                    <label className="color-switch">
                        <span className="sr-only">Palette</span>
                        <select value={paletteId} onChange={e => setPaletteId(e.target.value)}>
                            {SERIES_PALETTES.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.label}{p.safe ? '' : ' (not colorblind-safe)'}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

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
                    <span className="text-nano">base</span>
                </label>

                <Slider
                    label="Hue" min={0} max={360} value={Math.round(hsl.h)}
                    track="hue"
                    onChange={h => nudge({ h })}
                />
                <Slider
                    label="Saturation" min={0} max={100} value={Math.round(hsl.s)}
                    track="saturation" hue={hsl.h} sat={hsl.s} lit={hsl.l}
                    onChange={sat => nudge({ s: sat })}
                />
                <Slider
                    label="Lightness" min={0} max={100} value={Math.round(hsl.l)}
                    track="lightness" hue={hsl.h} sat={hsl.s} lit={hsl.l}
                    onChange={l => nudge({ l })}
                />

                {scoped && targets.length > 1 && (
                    <div className="color-seed">
                        {/* No heading. "Base seeds the set" and "3 more series"
                            were both written from inside the implementation:
                            they name the mechanism rather than the thing it
                            produces, and a reader who has not read the code has
                            no way in. The rows now say what each derivation is
                            FOR — one hue per vehicle, one step per test — which
                            is the same sentence handoff 3c uses. */}
                        <SeedRow
                            name="Different colors"
                            hint="Every series a color of its own — maximum contrast"
                            colors={rotatePaletteFrom(base, palette.colors).slice(0, 4)}
                            active={derivation === 'distinct'}
                            onSelect={() => setDerivation('distinct')}
                        />
                        <SeedRow
                            name="Shades of one"
                            hint="One color in steps — they read as a set"
                            colors={rampFrom(base, 4)}
                            active={derivation === 'shades'}
                            onSelect={() => setDerivation('shades')}
                        />
                    </div>
                )}

                <div className="color-row color-readout">
                    <ColorNote note={seriesColorNote(stored, base)} />
                    {ratio && (
                        <span className={`text-caption${ratio < AA_LARGE ? ' is-weak' : ''}`}>
                            {ratio.toFixed(1)}:1 on plot{ratio < AA_LARGE ? ' · faint' : ''}
                        </span>
                    )}
                </div>

                {armed && (
                    <p className="color-warning">
                        Reseeds {targets.length} plotted series from this base.
                        {handSet > 0 && ` ${handSet} carr${handSet === 1 ? 'ies' : 'y'} a color someone set by hand. Those get overwritten.`}
                    </p>
                )}
            </div>

            <div className="popover-foot">
                {/* Said out loud, because the whole panel turns on it: nothing
                    here reaches the database, at any scope or any role. */}
                <span className="text-nano">Session override</span>
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
 * One derivation, previewed AND selectable — the preview is the control, so
 * there is no separate list of options saying the same thing twice.
 */
function SeedRow({ name, hint, colors, active, onSelect }) {
    return (
        <button
            type="button"
            title={hint}
            aria-pressed={active}
            className={`color-row color-seed-row${active ? ' is-active' : ''}`}
            onClick={onSelect}
        >
            <span className="color-seed-chips">
                {colors.map((c, i) => (
                    <span key={`${c}-${i}`} className="series-swatch" style={{ backgroundColor: c }} />
                ))}
            </span>
            <span className="text-nano">{name}</span>
        </button>
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
