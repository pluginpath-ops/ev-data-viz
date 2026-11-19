import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ownValues } from '../../utils/vehicleInheritance';
import { SIZE_VIEWS } from '../../constants/sizeChart';
import SizePhotoEditor from './SizePhotoEditor';

/**
 * The vehicle form's Size photos (docs/size-photos-plan.md): a Side and a
 * Front slot. Each shows the vehicle's own photo (Edit, Delete), or the one it
 * inherits from its model line (read-only, with where it comes from), or
 * nothing; any of them takes a new file.
 */
function Slot({ vehicle, view, label, pending }) {
    const { deleteSizePhoto } = useAppContext();
    const own = ownValues(vehicle).size_photos?.[view] ?? null;
    const shown = vehicle.size_photos?.[view] ?? null;
    const inheritedFrom = own ? null : vehicle.inheritedFrom?.sizePhotos?.[view] ?? null;
    // { file, n } | { file: null, n }: n remounts the editor for each new file.
    const [editing, setEditing] = useState(null);
    const start = (file) => setEditing(e => ({ file, n: (e?.n ?? 0) + 1 }));

    if (editing) {
        return (
            <div className="size-photo-slot">
                <span className="text-micro">{label}</span>
                <SizePhotoEditor key={editing.n} vehicle={vehicle} view={view} row={editing.file ? null : own}
                    file={editing.file} onClose={() => setEditing(null)} pending={pending} onPickFile={start} />
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
                <p className="text-note">Inherited from {inheritedFrom.name}. Add one to override it.</p>
            )}
            <div className="inline-row flex-wrap">
                <label className="image-upload-label">
                    <span className="btn btn-secondary text-sm">{own ? 'Replace' : 'Add photo'}</span>
                    <input type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(f); }} />
                </label>
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

/**
 * `pending` is the vehicle form's list of unsaved photo work (an open editor
 * adds its save), so the form's Save saves photos too.
 */
export default function SizePhotoSection({ vehicle, pending }) {
    return (
        <div className="form-section mt-4">
            <label className="block font-medium mb-2">Size photos</label>
            <p className="text-note mb-2">For the Size chart: the car cut out, with its bumpers, axles and ground marked. Scaled from the length spec (front: width).</p>
            <div className="size-photo-slots">
                {SIZE_VIEWS.map(v => <Slot key={v.key} vehicle={vehicle} view={v.key} label={v.label} pending={pending} />)}
            </div>
        </div>
    );
}
