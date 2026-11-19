import { useState } from 'react';
import { SpecField } from '../EditSpecsForm';

/**
 * One spec field, edited where it is needed rather than in the specs form:
 * a Data Checks finding (#321), the size photo editor. It writes straight
 * away on Save, through the caller's `onSave`.
 *
 * Save is always present and disabled until the value changes, so typing never
 * moves a control a curator is about to click. The caller keys this by the
 * stored value, so a save from elsewhere resets the draft.
 *
 * Props:
 *   vehicle         its own `specs` are the stored value
 *   category, field the spec's place, e.g. 'dimensions', 'length_in'
 *   def             the field's schema entry (vehicleSpecSchema)
 *   inheritedValue  what an empty field shows as its hint
 *   providedBy      the platform that provides it, if any
 *   onSave          (category, { [field]: value }) => Promise
 */
export default function SpecFixField({ vehicle, category, field, def, inheritedValue, providedBy, onSave }) {
    const own = vehicle.specs?.[category]?.[field] ?? null;
    const [draft, setDraft] = useState(own);
    const [saving, setSaving] = useState(false);
    const dirty = (draft ?? null) !== own;
    const save = async () => {
        setSaving(true);
        await onSave(category, { [field]: draft });
        setSaving(false);
    };
    return (
        <span className="spec-fix-field">
            <span className="text-note">{def.label}</span>
            <SpecField field={def} value={draft} onChange={setDraft} inheritedValue={inheritedValue} providedBy={providedBy} />
            <button type="button" className="btn btn-secondary text-sm" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
            </button>
        </span>
    );
}
