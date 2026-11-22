import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { resolveEffectiveSpecs } from '../../utils/specHelpers';
import { profileFromSpecs } from '../../utils/vehicleProfile';
import { fmtDimension } from '../../utils/unitConversions';
import {
    MARKS, startingMarks, mirrorMarks, carryMarks, figuresFromMarks, fillMarks, clampMarks, isEndView, trackKeyOf,
} from '../../utils/sizePhotoMarks';
import {
    loadCanvas, isCutout, cutOut, finishCutout, flipCanvas, visibleFractions, toBlob, CUTOUT_MAX_SIDE,
} from '../../utils/sizePhotoImages';
import { SIZE_PHOTO_WHEELBASE_PCT, SIZE_PHOTO_HEIGHT_PCT } from '../../constants/sizeChart';
import MarkLine from './MarkLine';
import MarkPoint from './MarkPoint';
import { withSpecValues } from '../../utils/dataCheckFixes';
import SizePhotoSpecs from './SizePhotoSpecs';

const DEFAULT_TOLERANCE = 24;
const LOUPE_ZOOM = 4;
/** At rest on a focused mark, screen px per PHOTO px, so a ¼-pixel nudge moves 2 px. */
const LOUPE_FINE_PX = 8;
/** The loupe's diameter; .size-photo-loupe in index.css matches it. */
const LOUPE_PX = 120;
/** The tallest the marking canvas draws, in percent of the window height. */
const SIZE_PHOTO_MAX_VH = 70;

/** A typed link with its scheme, or null when blank: "www.tesla.com" → "https://www.tesla.com". */
const withScheme = (text) => {
    const t = text.trim();
    if (!t) return null;
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
};

const KIND = {
    front: 'bumper', rear: 'bumper', left: 'bumper', right: 'bumper', frontAxle: 'axle', rearAxle: 'axle',
    ground: 'ground', roof: 'roof', underbody: 'underbody', mirrorLeft: 'mirror', mirrorRight: 'mirror',
    tireLeft: 'track', tireRight: 'track',
};

/** The marks that must run in order along the photo, by view. */
const ORDER = { side: ['front', 'frontAxle', 'rearAxle', 'rear'], front: ['left', 'right'], rear: ['left', 'right'] };

/** A figure read from the marks, beside the spec it is checked against. */
function CheckRow({ label, read, spec, units, limit }) {
    if (read == null) return null;
    const off = spec ? ((read - spec) / spec) * 100 : null;
    return (
        <div className="inline-row flex-wrap">
            <span className="text-label">{label}</span>
            <span className="size-figure">{fmtDimension(read, units)}</span>
            {spec != null && (
                <span className={`text-meta${Math.abs(off) > limit ? ' status-text is-warning' : ''}`}>
                    spec {fmtDimension(spec, units)} ({off >= 0 ? '+' : '−'}{Math.abs(off).toFixed(1)}%)
                </span>
            )}
        </div>
    );
}

/**
 * A size photo, made or edited (docs/size-photos-plan.md): cut out, flipped
 * to face left, marked, credited, saved.
 *
 * Opens on a new file (`file`), or on the vehicle's saved photo (`row`), whose
 * marks, source and credit can be changed without uploading anything. Flip
 * and Redo cutout produce a new cutout; the marks follow them rather than
 * starting over. Only a new file starts the marks again.
 *
 * It lives inside the vehicle form, so its work must not be lost to the
 * form's own Save: while open it puts its save in `pending` (keyed by view),
 * and the form runs that first. Enter in its fields stays here rather than
 * submitting the form.
 *
 * Props:
 *   vehicle   the vehicle (resolved)
 *   view      'side' | 'front'
 *   row       its saved photo for this view, or null
 *   file      a newly chosen file, or null
 *   onClose   () => void
 *   pending   Map, view → () => Promise: the form's list of unsaved photo work
 *   onPickFile (File) => void   start again on another file
 *   specs     { drafts, changed, onDraft }: the dimension specs typed here and
 *             not yet saved (SizePhotoSection); the readouts use them already
 */
export default function SizePhotoEditor({ vehicle, view, row, file, onClose, pending, onPickFile, specs }) {
    const { vehicles, units, saveSizePhoto, showError } = useAppContext();
    const typed = specs?.changed;
    const profile = useMemo(() => {
        const effective = resolveEffectiveSpecs(vehicle, vehicles);
        // A cleared field falls back to what it inherits once saved; until then, keep the old figure.
        const set = Object.fromEntries(Object.entries(typed ?? {}).filter(([, v]) => v != null));
        return profileFromSpecs(withSpecValues(effective, 'dimensions', set));
    }, [vehicle, vehicles, typed]);

    const [original, setOriginal] = useState(null);      // canvas of the upload (new file, or a redo)
    const [cut, setCut] = useState(null);                 // the original with its background removed
    const [cutout, setCutout] = useState(null);           // canvas of the finished cutout, once changed
    const [needsBackground, setNeedsBackground] = useState(false);
    const [refused, setRefused] = useState(null);         // why the background couldn't come off: 'busy' | 'empty'
    const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
    const [trim, setTrim] = useState(row?.trim ?? null);
    const [mirrored, setMirrored] = useState(row?.mirrored ?? false);
    // A photo saved before a mark existed gets it filled in where it would start.
    const [marks, setMarks] = useState(() => (row?.marks ? fillMarks(view, row.marks, profile) : null));
    const [sourceUrl, setSourceUrl] = useState(row?.source_url ?? '');
    const [credit, setCredit] = useState(row?.credit ?? '');
    const [message, setMessage] = useState(null);
    const [working, setWorking] = useState(Boolean(file));
    const [loupe, setLoupe] = useState(null);
    const frameRef = useRef(null);

    // The cut-out step: from the original, at a tolerance (null: already a
    // cutout). Marks carry across from the last trim when there were any.
    const applyCut = (source, tol, { keepMarks }) => {
        const res = cutOut(source, tol);
        setRefused(res.ok ? null : res.reason);
        if (!res.ok) return;
        const finished = finishCutout(res.canvas, res.trim, mirrored);
        setCut(res.canvas);
        setCutout(finished);
        setMarks(keepMarks && marks && trim
            ? carryMarks(view, marks, trim, res.trim, mirrored)
            : startingMarks(view, visibleFractions(finished), profile));
        setTrim(res.trim);
        setMessage(null);
    };

    // A new file: load it, and cut it out if it isn't already.
    useEffect(() => {
        if (!file) return undefined;
        let live = true;
        loadCanvas(file).then(canvas => {
            if (!live) return;
            setOriginal(canvas);
            const plain = !isCutout(canvas);
            setNeedsBackground(plain);
            applyCut(canvas, plain ? DEFAULT_TOLERANCE : null, { keepMarks: false });
        }).catch(err => live && setMessage(err.message)).finally(() => live && setWorking(false));
        return () => { live = false; };
        // Once per file: applyCut reads the state as it is when the file lands.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

    const redoCutout = async () => {
        if (!row?.original_url) return;
        setWorking(true);
        try {
            const canvas = original ?? await loadCanvas(row.original_url);
            setOriginal(canvas);
            const plain = !isCutout(canvas);
            setNeedsBackground(plain);
            applyCut(canvas, plain ? tolerance : null, { keepMarks: true });
        } catch (err) {
            setMessage(err.message);
        } finally {
            setWorking(false);
        }
    };

    const flip = async () => {
        setWorking(true);
        try {
            const next = !mirrored;
            if (cut) setCutout(finishCutout(cut, trim, next));
            else setCutout(flipCanvas(cutout ?? await loadCanvas(row.image_url, CUTOUT_MAX_SIDE)));
            setMarks(m => (m ? mirrorMarks(view, m) : m));
            setMirrored(next);
        } catch (err) {
            setMessage(err.message);
        } finally {
            setWorking(false);
        }
    };

    const imageSrc = useMemo(() => (cutout ? cutout.toDataURL('image/png') : row?.image_url ?? null), [cutout, row]);
    // The upload as it came, shown when its background couldn't be removed.
    const uncut = useMemo(() => (refused && original ? original.toDataURL('image/jpeg', 0.8) : null), [refused, original]);
    const size = cutout ? { w: cutout.width, h: cutout.height } : row ? { w: row.width_px, h: row.height_px } : null;
    const photo = marks && size ? { marks, width_px: size.w, height_px: size.h } : null;
    const read = photo ? figuresFromMarks(view, photo, profile) : null;
    const outOfOrder = marks && ORDER[view].some((k, i, keys) => i > 0 && !(marks[keys[i - 1]] < marks[k]));

    // Throws when it can't save; saveSizePhoto shows its own errors.
    const persist = async () => {
        const problem = !marks || !size ? 'is still loading'
            : outOfOrder ? 'has its marks out of order' : null;
        if (problem) {
            showError(`The ${view} size photo ${problem}. Fix it or Cancel it, then save again.`);
            throw new Error(problem);
        }
        await saveSizePhoto(vehicle.id, view, {
            cutout: cutout ? await toBlob(cutout) : null,
            original: file && original ? await toBlob(original, needsBackground ? 'image/jpeg' : 'image/png', 0.9) : null,
            originalExt: needsBackground ? 'jpg' : 'png',
            fields: {
                width_px: size.w, height_px: size.h, marks: clampMarks(marks), trim, mirrored,
                source_url: withScheme(sourceUrl), credit: credit.trim() || null,
            },
        });
    };

    // Re-registered every render, so the form always runs the latest state.
    // Only once there is a photo with marks: a refused upload has nothing to save.
    useEffect(() => {
        if (!pending || !marks || !size) return undefined;
        pending.set(view, persist);
        return () => { pending.delete(view); };
    });

    const save = async () => {
        setWorking(true);
        try {
            await persist();
            onClose();
        } catch {
            // saveSizePhoto has said what went wrong; the work stays open.
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className="flex flex-col gap-2.5"
            onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
            {view === 'side' && <p className="text-note">Side photos face left, front bumper on the left. Flip one that doesn’t.</p>}
            <p className="text-meta">Drag a mark, or click it and use the arrow keys (1 photo pixel; Shift 10; Option ¼). Hold Option while dragging for fine moves.{view === 'side' ? ' The axles are the dots: put each on its wheel’s center.' : ''}</p>

            {refused === 'busy' && (
                <div className="flex flex-col gap-2">
                    <div className="size-photo-thumb"><img src={uncut} alt="The photo as uploaded" /></div>
                    <p className="text-note status-text is-warning">
                        This photo’s background can’t be removed here. Only one plain color comes off
                        (a studio shot on white or gray); this one has sky, scenery or ground behind the car.
                    </p>
                    <p className="text-note">
                        Cut the car out first, then upload that PNG. On a Mac: right-click the file in
                        Finder, Quick Actions → Remove Background. Or pick a photo on a plain background.
                    </p>
                    <label className="image-upload-label self-start">
                        <span className="btn btn-secondary text-sm">Choose another photo</span>
                        <input type="file" accept="image/*" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickFile?.(f); }} />
                    </label>
                </div>
            )}

            {needsBackground && refused !== 'busy' && (
                <div className="inline-row flex-wrap">
                    <label className="text-label" htmlFor={`tol-${view}`}>Background tolerance</label>
                    <input id={`tol-${view}`} type="range" min={4} max={80} value={tolerance}
                        onChange={e => setTolerance(Number(e.target.value))} />
                    <span className="text-meta">{tolerance}</span>
                    <button type="button" className="btn btn-secondary text-sm" disabled={working}
                        onClick={() => applyCut(original, tolerance, { keepMarks: true })}>
                        Remove background
                    </button>
                </div>
            )}
            {refused === 'empty' && <p className="text-note status-text is-warning">Nothing is left once the background is removed. Lower the tolerance and press Remove background.</p>}
            {message && <p className="text-note status-text is-warning">{message}</p>}
            {working && !imageSrc && <p className="text-meta">Reading the photo…</p>}

            {imageSrc && marks && (
                <div className="size-photo-frame" ref={frameRef} style={{
                    aspectRatio: `${size.w} / ${size.h}`,
                    // As wide as the column allows, but no taller than the window: a near-square front photo would otherwise run off the screen.
                    maxWidth: `calc(${SIZE_PHOTO_MAX_VH}vh * ${size.w / size.h})`,
                }}>
                    <img src={imageSrc} alt="" draggable={false} />
                    {MARKS[view].filter(mark => !mark.point).map(mark => (
                        <MarkLine
                            key={mark.key}
                            mark={mark}
                            value={marks[mark.key] ?? 0}
                            frameRef={frameRef}
                            photoPx={size}
                            kind={KIND[mark.key]}
                            onChange={v => setMarks(m => ({ ...m, [mark.key]: v }))}
                            onPointer={setLoupe}
                        />
                    ))}
                    {MARKS[view].filter(mark => mark.point).map(mark => (
                        <MarkPoint
                            key={mark.key}
                            label={mark.label}
                            x={marks[mark.point] ?? 0}
                            y={marks[mark.key] ?? 0}
                            frameRef={frameRef}
                            photoPx={size}
                            onChange={v => setMarks(m => ({ ...m, [mark.point]: v.x, [mark.key]: v.y }))}
                            onPointer={setLoupe}
                        />
                    ))}
                    {loupe && (() => {
                        // Dragging: 4× the frame. At rest: photo pixels, big enough to see a ¼-pixel nudge.
                        const zoom = loupe.fine && size ? LOUPE_FINE_PX * size.w / loupe.w : LOUPE_ZOOM;
                        return (
                            <div
                                className={`size-photo-loupe is-${loupe.axis}${loupe.fine ? ' is-fine' : ''}`}
                                aria-hidden="true"
                                style={{
                                    left: `${loupe.fx * 100}%`,
                                    top: `${loupe.fy * 100}%`,
                                    backgroundImage: `url(${imageSrc})`,
                                    // In px, so the mark's point sits at the loupe's center.
                                    backgroundSize: `${loupe.w * zoom}px ${loupe.h * zoom}px`,
                                    backgroundPosition: `${LOUPE_PX / 2 - loupe.fx * loupe.w * zoom}px ${LOUPE_PX / 2 - loupe.fy * loupe.h * zoom}px`,
                                }}
                            />
                        );
                    })()}
                </div>
            )}

            {photo && (
                <div className="flex flex-col gap-1">
                    {!read && (
                        <p className="text-note status-text is-warning">
                            No {isEndView(view) ? 'width' : 'length'} spec yet, so the marks can’t be read in inches or checked. Add it below; the marks keep until then.
                        </p>
                    )}
                    {read && view === 'side' && (
                        <>
                            <CheckRow label="Wheelbase" read={read.wheelbase} spec={profile.wheelbase} units={units} limit={SIZE_PHOTO_WHEELBASE_PCT} />
                            <CheckRow label="Front overhang" read={read.frontOverhang}
                                spec={profile.estimated.has('frontOverhang') ? null : profile.frontOverhang} units={units} limit={SIZE_PHOTO_WHEELBASE_PCT} />
                        </>
                    )}
                    {read && <CheckRow label="Height" read={read.height} spec={profile.height} units={units} limit={SIZE_PHOTO_HEIGHT_PCT} />}
                    {read && isEndView(view) && (
                        <CheckRow label={view === 'rear' ? 'Rear track' : 'Front track'} read={read.track}
                            spec={profile.estimated.has(trackKeyOf(view)) ? null : profile[trackKeyOf(view)]} units={units} limit={SIZE_PHOTO_WHEELBASE_PCT} />
                    )}
                    {specs && <SizePhotoSpecs vehicle={vehicle} view={view} {...specs} />}
                </div>
            )}
            {outOfOrder && <p className="text-note status-text is-warning">The marks are out of order: {ORDER[view].map(k => MARKS[view].find(m => m.key === k).label.toLowerCase()).join(', then ')}.</p>}

            {imageSrc && (<>
            <div className="size-photo-fields">
                {/* Text, not type="url": this sits inside the vehicle form, whose
                    submit a bare "www.…" would otherwise block. */}
                <label className="text-label">Source (optional)
                    <input type="text" inputMode="url" className="form-input" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://" />
                </label>
                <label className="text-label">Credit (optional)
                    <input type="text" className="form-input" value={credit} onChange={e => setCredit(e.target.value)} placeholder="Ford Media" />
                </label>
            </div>

            </>)}

            <div className="inline-row flex-wrap">
                {imageSrc && <button type="button" className="btn btn-secondary text-sm" disabled={working} onClick={flip}>Flip</button>}
                {imageSrc && row?.original_url && !file && (
                    <button type="button" className="btn btn-secondary text-sm" disabled={working} onClick={redoCutout}>Redo cutout</button>
                )}
                <span className="flex-1" />
                <button type="button" className="btn btn-secondary text-sm" disabled={working} onClick={onClose}>Cancel</button>
                {imageSrc && (
                    <button type="button" className="btn btn-primary text-sm" disabled={working || !marks || outOfOrder || !size} onClick={save}>
                        {working ? 'Saving…' : 'Save'}
                    </button>
                )}
            </div>
        </div>
    );
}
