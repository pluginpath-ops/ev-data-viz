/**
 * Choose a performance result's source from the one list, or name a new one
 * (#327).
 *
 * `value` is `{ sourceId, newName }`; `utils/sources.pickedSource` turns it
 * into the source to write. Until something is chosen, a link typed alongside
 * suggests its source by domain — shown as selected, and labelled as coming
 * from the link, because it is a default the curator can change.
 */
import { findSource } from '../utils/sources';

const NEW = '__new__';

export default function SourcePicker({ sources, value, onChange, url = '' }) {
    const nothingChosen = value.sourceId == null && value.newName == null;
    const suggested = nothingChosen ? (findSource(sources, { url })?.source ?? null) : null;
    const selected = value.newName != null ? NEW : String(value.sourceId ?? suggested?.id ?? '');

    return (
        <span className="source-picker">
            <select
                className="form-input"
                value={selected}
                onChange={e => {
                    const v = e.target.value;
                    if (v === NEW) onChange({ sourceId: null, newName: '' });
                    else onChange({ sourceId: v ? Number(v) : null, newName: null });
                }}
            >
                <option value="">— none —</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW}>＋ New source…</option>
            </select>
            {value.newName != null && (
                <input
                    className="form-input"
                    autoFocus
                    value={value.newName}
                    onChange={e => onChange({ sourceId: null, newName: e.target.value })}
                    placeholder="e.g. MotorTrend"
                />
            )}
            {suggested && <span className="text-meta">from the link</span>}
        </span>
    );
}
