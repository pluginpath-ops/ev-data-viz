import { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ownValues } from '../../utils/vehicleInheritance';
import { SIZE_PHOTO_VIEWS } from '../../utils/sizePhotoMarks';
import { withSpecValues } from '../../utils/dataCheckFixes';
import SizePhotoEditor from './SizePhotoEditor';

/**
 * The vehicle form's Size photos (docs/size-photos-plan.md): a Side, Front
 * and Rear slot. Each shows the vehicle's own photo (Edit, Delete), or the one it
 * inherits from its model line (read-only, with where it comes from), or
 * nothing; any of them takes a new file.
 */
function Slot({ vehicle, view, label, pending, specs }) {
    const { deleteSizePhoto, copySizePhoto } = useAppContext();
    const [copying, setCopying] = useState(false);
    const makeOwn = async () => {
        setCopying(true);
        await copySizePhoto(vehicle.id, view, shown);
        setCopying(false);
    };
    const own = ownValues(vehicle).size_photos?.[view] ?? null;
    const shown = vehicle.size_photos?.[view] ?? null;
    const inheritedFrom = own ? null : vehicle.inheritedFrom?.sizePhotos?.[view] ?? null;
    // { file, n } | { file: null, n }: n remounts the editor for each new file.
    const [editing, setEditing] = useState(null);
    const start = (file) => setEditing(e => ({ file, n: (e?.n ?? 0) + 1 }));

    if (editing) {
        return (
            <div className="size-photo-slot is-editing">
                <span className="text-micro">{label}</span>
                <SizePhotoEditor key={editing.n} vehicle={vehicle} view={view} row={editing.file ? null : own}
                    file={editing.file} onClose={() => setEditing(null)} pending={pending} onPickFile={start} specs={specs} />
            </div>
        );
    }

    return (
        <div className="size-photo-slot">
            <span className="text-micro">{label}</span>
            {shown && (
                <div className="size-photo-thumb">
                    <img src={shown.image_url} alt={`${label} photo`} />
                </div>
            )}
            {inheritedFrom && (
                <p className="text-note">Inherited from {inheritedFrom.name}. Add one to override it, or make its own copy to edit apart from {inheritedFrom.name}.</p>
            )}
            <div className="inline-row flex-wrap">
                <label className="image-upload-label">
                    <span className="btn btn-secondary text-sm">{own ? 'Replace' : 'Add photo'}</span>
                    <input type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(f); }} />
                </label>
                {inheritedFrom && (
                    <button type="button" className="btn btn-secondary text-sm" disabled={copying} onClick={makeOwn}
                        title={`Copy ${inheritedFrom.name}’s photo and marks to this vehicle, so each can change without the other`}>
                        {copying ? 'Copying…' : 'Make its own copy'}
                    </button>
                )}
                {own && <button type="button" className="btn btn-secondary text-sm" onClick={() => start(null)}>Edit</button>}
                {own && (
                    <button type="button" className="btn btn-secondary text-sm"
                        onClick={() => { if (window.confirm(`Delete the ${label.toLowerCase()} photo?`)) deleteSizePhoto(vehicle.id, view); }}>
                        Delete
                    </button>
                )}
            </div>
        </div>
    );
}

/** The dimension specs typed in the editors and not yet saved. */
const changedFrom = (drafts, own) =>
    Object.fromEntries(Object.entries(drafts).filter(([k, v]) => (v ?? null) !== (own?.[k] ?? null)));

/**
 * `pending` is the vehicle form's list of unsaved photo work (an open editor
 * adds its save), so the form's Save saves photos too.
 *
 * The dimension specs typed in the editors are one draft, shared by every
 * open editor (side and front both show height), and saved by the form's Save
 * in one write — two editors each writing the whole specs object would lose
 * each other's fields.
 */
export default function SizePhotoSection({ vehicle, pending }) {
    const { updateVehicleSpecs } = useAppContext();
    const [drafts, setDrafts] = useState({});
    const changed = changedFrom(drafts, vehicle.specs?.dimensions);
    const dirty = Object.keys(changed).length > 0;

    useEffect(() => {
        if (!pending || !dirty) return undefined;
        pending.set('specs', async () => {
            const ok = await updateVehicleSpecs(vehicle.id, withSpecValues(vehicle.specs, 'dimensions', changed));
            if (!ok) throw new Error('specs refused'); // updateVehicleSpecs showed why; the form stays open
        });
        return () => { pending.delete('specs'); };
    });

    const specs = { drafts, changed, onDraft: (field, value) => setDrafts(d => ({ ...d, [field]: value })) };
    return (
        <div>
            <label className="block font-medium mb-2">Size photos</label>
            <p className="text-note mb-2">For the Size chart: the car cut out, with its bumpers, axles, ground and roof marked (front and rear: body edges and mirrors). Drawn to the specs. The rear isn’t drawn yet; it is kept for later.</p>
            <div className="size-photo-slots">
                {SIZE_PHOTO_VIEWS.map(v => <Slot key={v.key} vehicle={vehicle} view={v.key} label={v.label} pending={pending} specs={specs} />)}
            </div>
        </div>
    );
}
