import { fmtDimension } from '../../utils/unitConversions';

/**
 * The figures under the Size chart: one row per drawn vehicle, each figure with
 * how far it is from the vehicle they are measured from (`fromId`, picked by a
 * click; else the first).
 *
 * A figure the drawing filled with a stand-in is shown as "est." where the
 * stand-in still says something (the axles placed by a typical overhang split)
 * and as a blank where it would only be a guess dressed as a figure. A figure
 * read off the vehicle's size photo is marked "photo": measured, not a spec.
 */
const COLUMNS = {
    side: [
        { key: 'length',          label: 'Length' },
        { key: 'height',          label: 'Height' },
        { key: 'wheelbase',       label: 'Wheelbase' },
        { key: 'frontOverhang',   label: 'Front overhang', est: 'frontOverhang', show: true, photo: 'frontOverhang' },
        { key: 'rearOverhang',    label: 'Rear overhang',  est: 'frontOverhang', show: true, photo: 'frontOverhang' },
        { key: 'groundClearance', label: 'Clearance',      est: 'groundClearance' },
    ],
    front: [
        { key: 'width',        label: 'Width',            est: 'width' },
        { key: 'widthMirrors', label: 'Incl. mirrors' },
        { key: 'height',       label: 'Height' },
        { key: 'trackFront',   label: 'Front track',      est: 'trackFront' },
        { key: 'trackRear',    label: 'Rear track',       est: 'trackRear' },
    ],
};
COLUMNS.rear = COLUMNS.front;

function cellOf(profile, col) {
    const value = profile[col.key];
    const estimated = col.est ? profile.estimated.has(col.est) : false;
    if (value == null || (estimated && !col.show)) return { value: null, estimated: false };
    return { value, estimated, fromPhoto: col.photo ? profile.fromPhoto.has(col.photo) : false };
}

const signed = (diff, units) => (Math.abs(diff) < 0.05 ? '±0' : `${diff > 0 ? '+' : '−'}${fmtDimension(Math.abs(diff), units)}`);

export default function SizeFiguresTable({ items, view, units, activeId, fromId, onPick }) {
    const cols = COLUMNS[view];
    const first = items.find(i => i.id === fromId) ?? items[0];
    return (
        <div className="size-figures-container">
            <table className="size-figures">
                <thead>
                    <tr>
                        <th>{items.length > 1 ? `Vehicle · differences from ${first.label}` : 'Vehicle'}</th>
                        {cols.map(c => <th key={c.key}>{c.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr
                            key={item.id}
                            className={item.id === activeId ? 'is-active' : ''}
                            onClick={() => onPick(item.id)}
                            title={item === first ? undefined : `Measure the figures from ${item.label}`}
                        >
                            <td>
                                <span className="size-figures-name">
                                    <span className="series-swatch" style={{ backgroundColor: item.color }} />
                                    {item.label}
                                </span>
                            </td>
                            {cols.map(c => {
                                const cell = cellOf(item.profile, c);
                                const ref = item === first ? null : cellOf(first.profile, c);
                                const diff = ref?.value != null && cell.value != null && !ref.estimated && !cell.estimated
                                    ? cell.value - ref.value : null;
                                return (
                                    <td key={c.key}>
                                        {cell.value == null ? <span className="text-meta">—</span> : (
                                            <>
                                                <span className="size-figure">{fmtDimension(cell.value, units)}</span>
                                                {cell.estimated && <span className="text-meta"> est.</span>}
                                                {cell.fromPhoto && <span className="text-meta" title="Read off the size photo's marks"> photo</span>}
                                                {diff != null && <div className="text-meta">{signed(diff, units)}</div>}
                                            </>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
