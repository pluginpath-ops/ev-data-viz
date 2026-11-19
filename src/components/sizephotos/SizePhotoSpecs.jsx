import { useAppContext } from '../../context/AppContext';
import { fallbackSpecs } from '../../utils/specHelpers';
import { withSpecValues } from '../../utils/dataCheckFixes';
import { SPEC_CATEGORIES } from '../../utils/vehicleSpecSchema';
import { isEndView } from '../../utils/sizePhotoMarks';
import SpecFixField from '../specs/SpecFixField';

/** The dimensions a size photo is read and drawn by, per view. */
const FIELDS = {
    side: ['length_in', 'wheelbase_in', 'front_overhang_in', 'height_in', 'ground_clearance_in'],
    end: ['width_in', 'width_mirrors_in', 'height_in', 'ground_clearance_in'],
};
const DIMENSIONS = SPEC_CATEGORIES.find(c => c.key === 'dimensions');

/**
 * The vehicle's own dimension specs, beside the photo being marked, so a
 * missing or wrong one can be fixed without leaving the editor. Each writes
 * the spec on its own Save — the same specs the specs form edits, not a copy.
 * An empty field shows what the vehicle inherits.
 */
export default function SizePhotoSpecs({ vehicle, view }) {
    const { vehicles, updateVehicleSpecs } = useAppContext();
    const fallback = fallbackSpecs(vehicle, vehicles);
    const save = (category, values) => updateVehicleSpecs(vehicle.id, withSpecValues(vehicle.specs, category, values));
    return (
        <div className="spec-fix-fields">
            {FIELDS[isEndView(view) ? 'end' : 'side'].map(field => (
                <SpecFixField
                    key={`${field}:${vehicle.specs?.dimensions?.[field] ?? ''}`}
                    vehicle={vehicle}
                    category="dimensions"
                    field={field}
                    def={DIMENSIONS.fields.find(f => f.key === field)}
                    inheritedValue={fallback.specs?.dimensions?.[field] ?? null}
                    providedBy={fallback.fromPlatform.get(`dimensions.${field}`) ?? null}
                    onSave={save}
                />
            ))}
        </div>
    );
}
