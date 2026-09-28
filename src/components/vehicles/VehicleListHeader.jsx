/**
 * The List view's header row (#338): one label per column, in the same grid
 * as the rows beneath it, so every figure reads down its column. A column
 * that sorts is a button; clicking it sorts, and clicking it again reverses.
 * The sort is the Vehicles & Specs sort (`sortBy`), shared with the cards'
 * dropdown, so switching views keeps the order.
 */
const COLUMNS = [
    { key: 'photo' },
    { key: 'vehicle', label: 'Vehicle',   sort: ['name_az', 'name_za'] },
    { key: 'battery', label: 'Battery',   sort: ['battery_desc', 'battery_asc'], numeric: true },
    { key: 'range',   label: 'EPA range', sort: ['range_desc', 'range_asc'], numeric: true },
    { key: 'tested',  label: 'Tested',    sort: ['tested_desc', 'tested_asc'], numeric: true },
    { key: 'tests',   label: 'Tests' },
    { key: 'actions' },
];

export default function VehicleListHeader({ sortBy, onSort, allSelected, someSelected, onToggleAll }) {
    return (
        <div className="vehicle-list-head" role="row">
            <span className="vehicle-list-select" role="columnheader">
                <input
                    type="checkbox"
                    aria-label="Select every vehicle on this page"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                    onChange={onToggleAll}
                />
            </span>
            {COLUMNS.map(col => {
                if (!col.sort) return <span key={col.key} role="columnheader" className="text-micro">{col.label ?? ''}</span>;
                const at = col.sort.indexOf(sortBy);
                const dir = at === -1 ? 'none' : (col.sort[0].endsWith('_az') || col.sort[0].endsWith('_asc')) === (at === 0) ? 'ascending' : 'descending';
                return (
                    <span key={col.key} role="columnheader" aria-sort={dir} className={col.numeric ? 'is-numeric' : ''}>
                        <button
                            type="button"
                            className={`vehicle-list-sort text-micro${at !== -1 ? ' active' : ''}`}
                            onClick={() => onSort(at === 0 ? col.sort[1] : col.sort[0])}
                            title={`Sort by ${col.label.toLowerCase()}`}
                        >
                            {col.label}
                            {at !== -1 && <span aria-hidden="true">{dir === 'ascending' ? ' ▲' : ' ▼'}</span>}
                        </button>
                    </span>
                );
            })}
        </div>
    );
}
