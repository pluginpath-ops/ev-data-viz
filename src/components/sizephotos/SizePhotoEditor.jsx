import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { resolveEffectiveSpecs } from '../../utils/specHelpers';
import { profileFromSpecs } from '../../utils/vehicleProfile';
import { fmtDimension } from '../../utils/unitConversions';
import {
    MARKS, startingMarks, mirrorMarks, carryMarks, figuresFromMarks,
} from '../../utils/sizePhotoMarks';
import {
    loadCanvas, isCutout, cutOut, finishCutout, flipCanvas, visibleFractions, toBlob, CUTOUT_MAX_SIDE,
} from '../../utils/sizePhotoImages';
import { SIZE_PHOTO_WHEELBASE_PCT, SIZE_PHOTO_HEIGHT_PCT } from '../../constants/sizeChart';
import MarkLine from './MarkLine';

const DEFAULT_TOLERANCE = 24;
const LOUPE_ZOOM = 4;
/** The loupe's diameter; .size-photo-loupe in index.css matches it. */
const LOUPE_PX = 120;

/** A typed link with its scheme, or null when blank: "www.tesla.com" → "https://www.tesla.com". */
const withScheme = (text) => {
    const t = text.trim();
    if (!t) return null;
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
};

const KIND = { front: 'bumper', rear: 'bumper', left: 'bumper', right: 'bumper', frontAxle: 'axle', rearAxle: 'axle', ground: 'ground', roof: 'roof' };

/** The marks that must run in order along the photo, by view. */
const ORDER = { side: ['front', 'frontAxle', 'rearAxle', 'rear'], front: ['left', 'right'] };

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
 */
export default function SizePhotoEditor({ vehicle, view, row, file, onClose, pending }) {
    const { vehicles, units, saveSizePhoto, showError } = useAppContext();
    const profile = useMemo(() => profileFromSpecs(resolveEffectiveSpecs(vehicle, vehicles)), [vehicle, vehicles]);

    const [original, setOriginal] = useState(null);      // canvas of the upload (new file, or a redo)
    const [cut, setCut] = useState(null);                 // the original with its background removed
    const [cutout, setCutout] = useState(null);           // canvas of the finished cutout, once changed
    const [needsBackground, setNeedsBackground] = useState(false);
    const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
    const [trim, setTrim] = useState(row?.trim ?? null);
    const [mirrored, setMirrored] = useState(row?.mirrored ?? false);
    const [marks, setMarks] = useState(row?.marks ?? null);
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
        if (!res.ok) {
            setMessage(res.reason === 'busy'
                ? 'The background is not one plain color. Cut the car out elsewhere and upload the PNG.'
                : 'Nothing is left once the background is removed. Lower the tolerance.');
            return;
        }
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
    const size = cutout ? { w: cutout.width, h: cutout.height } : row ? { w: row.width_px, h: row.height_px } : null;
    const photo = marks && size ? { marks, width_px: size.w, height_px: size.h } : null;
    const read = photo ? figuresFromMarks(view, photo, profile) : null;
    const outOfOrder = marks && ORDER[view].some((k, i, keys) => i > 0 && !(marks[keys[i - 1]] < marks[k]));
    const scaleSpec = view === 'front' ? profile.width : profile.length;

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
                width_px: size.w, height_px: size.h, marks, trim, mirrored,
                source_url: withScheme(sourceUrl), credit: credit.trim() || null,
            },
        });
    };

    // Re-registered every render, so the form always runs the latest state.
    useEffect(() => {
        if (!pending) return undefined;
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

            {needsBackground && (
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
            {message && <p className="text-note status-text is-warning">{message}</p>}
            {working && !imageSrc && <p className="text-meta">Reading the photo…</p>}

            {imageSrc && marks && (
                <div className="size-photo-frame" ref={frameRef} style={{ aspectRatio: `${size.w} / ${size.h}` }}>
                    <img src={imageSrc} alt="" draggable={false} />
                    {MARKS[view].map(mark => (
                        <MarkLine
                            key={mark.key}
                            mark={mark}
                            value={marks[mark.key] ?? 0}
                            frameRef={frameRef}
                            kind={KIND[mark.key]}
                            onChange={v => setMarks(m => ({ ...m, [mark.key]: v }))}
                            onPointer={setLoupe}
                        />
                    ))}
                    {loupe && (
                        <div
                            className="size-photo-loupe"
                            aria-hidden="true"
                            style={{
                                left: `${loupe.fx * 100}%`,
                                top: `${loupe.fy * 100}%`,
                                backgroundImage: `url(${imageSrc})`,
                                // In px, so the point under the pointer sits at the loupe's center.
                                backgroundSize: `${loupe.w * LOUPE_ZOOM}px ${loupe.h * LOUPE_ZOOM}px`,
                                backgroundPosition: `${LOUPE_PX / 2 - loupe.fx * loupe.w * LOUPE_ZOOM}px ${LOUPE_PX / 2 - loupe.fy * loupe.h * LOUPE_ZOOM}px`,
                            }}
                        />
                    )}
                </div>
            )}

            {read && (
                <div className="flex flex-col gap-1">
                    {!scaleSpec && <p className="text-note">No {view === 'front' ? 'width' : 'length'} spec yet, so nothing can be checked.</p>}
                    {view === 'side' && (
                        <>
                            <CheckRow label="Wheelbase" read={read.wheelbase} spec={profile.wheelbase} units={units} limit={SIZE_PHOTO_WHEELBASE_PCT} />
                            <CheckRow label="Front overhang" read={read.frontOverhang}
                                spec={profile.estimated.has('frontOverhang') ? null : profile.frontOverhang} units={units} limit={SIZE_PHOTO_WHEELBASE_PCT} />
                        </>
                    )}
                    <CheckRow label="Height" read={read.height} spec={profile.height} units={units} limit={SIZE_PHOTO_HEIGHT_PCT} />
                </div>
            )}
            {outOfOrder && <p className="text-note status-text is-warning">The marks are out of order: {ORDER[view].map(k => MARKS[view].find(m => m.key === k).label.toLowerCase()).join(', then ')}.</p>}

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

            <div className="inline-row flex-wrap">
                <button type="button" className="btn btn-secondary text-sm" disabled={working || !imageSrc} onClick={flip}>Flip</button>
                {row?.original_url && !file && (
                    <button type="button" className="btn btn-secondary text-sm" disabled={working} onClick={redoCutout}>Redo cutout</button>
                )}
                <span className="flex-1" />
                <button type="button" className="btn btn-secondary text-sm" disabled={working} onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary text-sm" disabled={working || !marks || outOfOrder || !size} onClick={save}>
                    {working ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
