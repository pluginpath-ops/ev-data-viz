import { useAppContext } from '../../context/AppContext';
import { fallbackSpecs } from '../../utils/specHelpers';
import { SPEC_CATEGORIES } from '../../utils/vehicleSpecSchema';
import { SpecField } from '../EditSpecsForm';

/**
 * The dimensions a size photo is read and drawn by, per view. Not the front
 * overhang: rarely published, and with none the side photo's own marks split
 * the overhangs (vehicleProfile `fromPhoto`). It stays in the specs form.
 */
const FIELDS = {
    side: ['length_in', 'wheelbase_in', 'height_in', 'ground_clearance_in'],
    front: ['width_in', 'width_mirrors_in', 'track_front_in', 'height_in', 'ground_clearance_in'],
    rear: ['width_in', 'width_mirrors_in', 'track_rear_in', 'height_in', 'ground_clearance_in'],
};
const DIMENSIONS = SPEC_CATEGORIES.find(c => c.key === 'dimensions');

/**
 * The vehicle's own dimension specs, beside the photo being marked, so a
 * missing or wrong one can be fixed without leaving the editor. What is typed
 * is a draft (SizePhotoSection) the readouts use at once, saved by the vehicle
 * form's Save — to the same specs the specs form edits, not a copy. An empty
 * field shows what the vehicle inherits.
 *
 * Props: vehicle, view, drafts (field → value), changed (the drafts that
 * differ from the saved specs), onDraft (field, value) => void
 */
export default function SizePhotoSpecs({ vehicle, view, drafts, changed, onDraft }) {
    const { vehicles } = useAppContext();
    const fallback = fallbackSpecs(vehicle, vehicles);
    const own = vehicle.specs?.dimensions ?? {};
    return (
        <div className="flex flex-col gap-1">
            <div className="spec-fix-fields">
                {FIELDS[view].map(field => (
                    <span key={field} className="spec-fix-field">
                        <span className="text-note">{DIMENSIONS.fields.find(f => f.key === field).label}</span>
                        <SpecField
                            field={DIMENSIONS.fields.find(f => f.key === field)}
                            value={field in drafts ? drafts[field] : own[field] ?? null}
                            onChange={v => onDraft(field, v)}
                            inheritedValue={fallback.specs?.dimensions?.[field] ?? null}
                            providedBy={fallback.fromPlatform.get(`dimensions.${field}`) ?? null}
                        />
                    </span>
                ))}
            </div>
            {Object.keys(changed).length > 0 && (
                <p className="text-note status-text is-warning">Spec changes save with the vehicle’s Save.</p>
            )}
        </div>
    );
}
