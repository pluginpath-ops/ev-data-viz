/**
 * EPA testing data section — shown in the Tests & Data (RunsView) per-vehicle panel.
 *
 * Shows:
 *   • A card for each linked EPA test group (coefficients, cycle results, label values)
 *   • An "Assign EPA Testing Data" combobox for linking additional test groups
 *   • Unlink controls (contributor+)
 */
import { useState, useRef } from 'react';
import InfoIcon from './InfoIcon';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600',
};

function ConfidenceBadge({ confidence }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[confidence] ?? CONFIDENCE_COLORS.inferred}`}>
            {confidence}
        </span>
    );
}

/** One row of a label/value table inside the card. */
function DataRow({ label, value, muted }) {
    if (value == null) return null;
    return (
        <div className="flex justify-between gap-4 py-0.5">
            <span className="text-gray-500 dark:text-slate-400 shrink-0">{label}</span>
            <span className={`font-mono text-right ${muted ? 'text-gray-400 dark:text-slate-500' : ''}`}>{value}</span>
        </div>
    );
}

/** Card displaying the data for one EPA test group mapping. */
function EpaGroupCard({ mapping, canEdit, onUnlink, onUpdateConfidence }) {
    const [unlinking, setUnlinking] = useState(false);
    const [updatingConf, setUpdatingConf] = useState(false);
    const g = mapping.epaGroup;
    if (!g) return null;

    const fmt = (n, dp = 4) => n != null ? n.toFixed(dp) : null;
    const mpge = (kwh) => kwh != null ? (33705 / kwh).toFixed(1) : null; // kWh/100mi → MPGe

    const handleUnlink = async () => {
        setUnlinking(true);
        try { await onUnlink(mapping.id); } finally { setUnlinking(false); }
    };

    const handleConfidence = async (e) => {
        setUpdatingConf(true);
        try { await onUpdateConfidence(mapping.id, e.target.value); } finally { setUpdatingConf(false); }
    };

    return (
        <div className="card p-4 mb-3">
            {/* Card header */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{g.epa_carline_name}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {g.model_year}{g.make ? ` · ${g.make}` : ''}{g.drive ? ` · ${g.drive}` : ''}
                        {g.transmission ? ` · ${g.transmission}` : ''}
                    </div>
                    <div className="font-mono text-xs text-gray-400 mt-0.5">{g.test_group_id}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {canEdit ? (
                        <select
                            value={mapping.confidence}
                            onChange={handleConfidence}
                            disabled={updatingConf}
                            className="form-input text-xs py-0.5 w-28"
                        >
                            <option value="verified">Verified</option>
                            <option value="likely">Likely</option>
                            <option value="inferred">Inferred</option>
                        </select>
                    ) : (
                        <ConfidenceBadge confidence={mapping.confidence} />
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            disabled={unlinking}
                            onClick={handleUnlink}
                            className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                        >
                            {unlinking ? '…' : 'Unlink'}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-xs">

                {/* Physical */}
                <div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Test Setup
                    </div>
                    <DataRow label="Test weight" value={g.equiv_test_weight_lbs != null ? g.equiv_test_weight_lbs.toLocaleString() + ' lbs' : null} />
                    <DataRow label="Fuel type" value={g.fuel_type} />
                </div>

                {/* Road-load coefficients */}
                <div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold flex items-center gap-1">
                        Road-Load Coefficients
                        <InfoIcon text={EPA_EXPLAINERS.roadLoad} position="right" />
                    </div>
                    {g.target_a != null && (
                        <>
                            <DataRow label="Target A" value={fmt(g.target_a, 3) + ' lbf'} />
                            <DataRow label="Target B" value={fmt(g.target_b, 5) + ' lbf/mph'} />
                            <DataRow label="Target C" value={fmt(g.target_c, 6) + ' lbf/mph²'} />
                        </>
                    )}
                    {g.set_a != null && (
                        <>
                            <DataRow label="Set A" value={fmt(g.set_a, 3) + ' lbf'} muted />
                            <DataRow label="Set B" value={fmt(g.set_b, 5) + ' lbf/mph'} muted />
                            <DataRow label="Set C" value={fmt(g.set_c, 6) + ' lbf/mph²'} muted />
                        </>
                    )}
                </div>

                {/* Cycle results */}
                <div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold flex items-center gap-1">
                        Cycle Results
                        <InfoIcon text={EPA_EXPLAINERS.unadjVsAdj} position="right" />
                    </div>
                    {(g.udds_adj_kwh_100mi != null || g.udds_unadj_kwh_100mi != null) && (
                        <DataRow
                            label="UDDS (city)"
                            value={(g.udds_adj_kwh_100mi ?? g.udds_unadj_kwh_100mi)?.toFixed(1) + ' kWh/100mi'}
                        />
                    )}
                    {(g.hwfet_adj_kwh_100mi != null || g.hwfet_unadj_kwh_100mi != null) && (
                        <DataRow
                            label="HWFET (hwy)"
                            value={(g.hwfet_adj_kwh_100mi ?? g.hwfet_unadj_kwh_100mi)?.toFixed(1) + ' kWh/100mi'}
                        />
                    )}
                    {(g.us06_adj_kwh_100mi != null || g.us06_unadj_kwh_100mi != null) && (
                        <DataRow
                            label="US06"
                            value={(g.us06_adj_kwh_100mi ?? g.us06_unadj_kwh_100mi)?.toFixed(1) + ' kWh/100mi'}
                        />
                    )}
                    {(g.sc03_adj_kwh_100mi != null || g.sc03_unadj_kwh_100mi != null) && (
                        <DataRow
                            label="SC03 (AC)"
                            value={(g.sc03_adj_kwh_100mi ?? g.sc03_unadj_kwh_100mi)?.toFixed(1) + ' kWh/100mi'}
                        />
                    )}
                    {(g.cold_ftp_adj_kwh_100mi != null || g.cold_ftp_unadj_kwh_100mi != null) && (
                        <DataRow
                            label="Cold FTP"
                            value={(g.cold_ftp_adj_kwh_100mi ?? g.cold_ftp_unadj_kwh_100mi)?.toFixed(1) + ' kWh/100mi'}
                        />
                    )}
                    {/* Label values */}
                    {g.label_combined_mpge != null && (
                        <DataRow label="Label combined" value={g.label_combined_mpge.toFixed(1) + ' MPGe'} />
                    )}
                    {g.label_hwy_mpge != null && (
                        <DataRow label="Label highway" value={g.label_hwy_mpge.toFixed(1) + ' MPGe'} />
                    )}
                    {g.label_city_mpge != null && (
                        <DataRow label="Label city" value={g.label_city_mpge.toFixed(1) + ' MPGe'} />
                    )}
                    {g.label_combined_mi != null && (
                        <DataRow label="Label range" value={g.label_combined_mi.toFixed(0) + ' mi'} />
                    )}
                    {/* No cycle data at all */}
                    {g.label_combined_mpge == null && g.hwfet_adj_kwh_100mi == null && g.hwfet_unadj_kwh_100mi == null && (
                        <p className="text-gray-400 text-[10px] italic">No cycle data in this record</p>
                    )}
                </div>
            </div>

            {mapping.notes && (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400 italic border-t pt-2">{mapping.notes}</p>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EpaVehicleSection({ vehicle, canEdit, searchEpaTestGroups, onLink, onUnlink, onUpdateConfidence }) {
    const [query, setQuery]               = useState('');
    const [results, setResults]           = useState([]);
    const [searching, setSearching]       = useState(false);
    const [searchError, setSearchError]   = useState(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [linking, setLinking]           = useState(false);
    const debounceRef = useRef(null);

    const mappings = vehicle?.epa_mappings ?? [];

    const handleQueryChange = (e) => {
        const q = e.target.value;
        setQuery(q);
        setShowDropdown(true);
        setSearchError(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!q.trim()) { setResults([]); return; }
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                // No year filter — EPA model years often differ from the vehicle's model year
                // by 1–2 years; the year is shown in dropdown results for manual verification.
                const rows = await searchEpaTestGroups?.(q.trim());
                setResults(rows || []);
            } catch (err) {
                setSearchError(err?.message || 'Search failed');
                setResults([]);
            } finally {
                setSearching(false);
            }
        }, 300);
    };

    const handleSelect = async (group) => {
        setShowDropdown(false);
        setQuery('');
        setResults([]);
        if (!vehicle?.id || !onLink) return;
        setLinking(true);
        try {
            await onLink(vehicle.id, group.test_group_id, 'inferred', null);
        } finally {
            setLinking(false);
        }
    };

    return (
        <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
                <h3 className="section-title">
                    EPA Testing Data
                    <InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="right" className="ml-1" />
                </h3>
            </div>

            {/* Existing mappings */}
            {mappings.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">
                    No EPA test group linked yet.
                    {canEdit && ' Use the search below to assign one.'}
                </p>
            ) : (
                mappings.map(m => (
                    <EpaGroupCard
                        key={m.id}
                        mapping={m}
                        canEdit={canEdit}
                        onUnlink={onUnlink}
                        onUpdateConfidence={onUpdateConfidence}
                    />
                ))
            )}

            {/* Link combobox — contributors only */}
            {canEdit && (
                <div className="mt-2">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Assign EPA testing data — search by make or carline…"
                            value={query}
                            onChange={handleQueryChange}
                            onFocus={() => query && setShowDropdown(true)}
                            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                            disabled={linking}
                            className="form-input text-sm w-full"
                        />
                        {linking && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Linking…</span>
                        )}
                        {showDropdown && (results.length > 0 || searching || searchError) && (
                            <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600">
                                {searching && (
                                    <li className="px-3 py-2 text-sm text-gray-400 italic">Searching…</li>
                                )}
                                {!searching && searchError && (
                                    <li className="px-3 py-2 text-sm text-red-500">Error: {searchError}</li>
                                )}
                                {!searching && results.map(g => (
                                    <li
                                        key={g.test_group_id}
                                        className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900"
                                        onMouseDown={e => { e.preventDefault(); handleSelect(g); }}
                                    >
                                        <span className="font-medium">{g.make} · {g.epa_carline_name}</span>
                                        <span className="text-gray-400 ml-2 text-xs">
                                            {g.model_year}{g.drive ? ` · ${g.drive}` : ''} · {g.test_group_id}
                                        </span>
                                    </li>
                                ))}
                                {!searching && !searchError && results.length === 0 && query.trim() && (
                                    <li className="px-3 py-2 text-sm text-gray-400 italic">No results</li>
                                )}
                            </ul>
                        )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        Results filtered by vehicle year when available. Import test groups via Admin → Import → EPA Test Car Data.
                    </p>
                </div>
            )}
        </div>
    );
}
