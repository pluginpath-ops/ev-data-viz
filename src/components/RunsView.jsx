import { useState, useMemo, useEffect, Fragment } from 'react';
import { useAppContext } from '../context/AppContext';
import { fmtSpeed, speedBasisNote, fmtTemp, fmtDistance, calcEff, effLabel as getEffLabel, roundTo } from '../utils/unitConversions';
import Papa from 'papaparse';
import { parseCSV, parseCSVText } from '../utils/parseCSV';
import { packKwh } from '../utils/specHelpers';
import { dataService } from '../services/DataService';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';
import LazyBoundary from './LazyBoundary';
import { EditVehicleForm } from './lazyComponents';
import { groupRunsBySession } from '../utils/testSessions';
import SessionControl from './SessionControl';
import RunSpecRows from './RunSpecRows';
import SectionHeader, { SectionAction } from './SectionHeader';
import InfoIcon from './InfoIcon';
import SessionGroupHeader from './SessionGroupHeader';
import VehicleLink from './VehicleLink';
import SessionEditModal from './SessionEditModal';
import EditSpecsForm from './EditSpecsForm';
import ViewSpecsModal from './ViewSpecsModal';
import { RunVoteButtons } from './VoteButtons';
import RunSourceLinks from './RunSourceLinks';
import EpaVehicleSection from './EpaVehicleSection';
import PerformanceVehicleSection from './PerformanceVehicleSection';
import { deriveChargingAxis } from '../utils/deriveChargingAxis';
import { displayImageUrl } from '../utils/imageRenditions';
import { isRangeRun, runKindFrom, linkableRuns, linkableCounts } from '../utils/runUtils';
import { isTimestampValue, timestampToMs } from '../utils/parseElapsedTime';
import RunCard from './runs/RunCard';
import { DATA_FLAGS, RunKindPill, FIELD_META, inferRunFlags } from './runs/runDisplay';




const INHERITED_SECTION_HELP =
    'Tests borrowed from another vehicle that shares this one\'s hardware — a ' +
    'trim with the same battery can inherit its charging curves, a battery ' +
    'variant of the same body can inherit its range tests. Linked per test, ' +
    'with a scaling factor where the two differ.';

// The two knobs on an inherited test (migration 055). What a field IS decides
// which factors reach it, so neither needs to know the run's kind:
//
//   capacity   × kWh and kW (and, with efficiency, distance) — a bigger pack
//   efficiency × distance only — the same pack carried further
//
// Capacity cancels out of distance ÷ energy, so efficiency alone moves the
// efficiency figure and capacity alone leaves it untouched.
const CAPACITY_HELP =
    'Target pack ÷ source pack. Scales energy and charge rate, and distance ' +
    'along with them, so efficiency is unchanged — the same car carrying a ' +
    'bigger battery.';

const EFFICIENCY_HELP =
    'How much further the target goes on the same energy — aero, tyres, ' +
    'drivetrain. Scales distance only, so this is the knob that moves the ' +
    'efficiency figure.';

// On a charging test efficiency is not inert, but it is nearly so: the only
// distance such a run carries is the range readout on its data points. Saying
// so is the difference between "this knob does nothing" and "this knob does
// one specific thing" — the question the missing kind pill left open.
const EFFICIENCY_ON_CHARGING =
    'On a charging test the only distance to scale is the range readout on ' +
    'its data points — kWh and kW are capacity\'s job.';

// Capacity on a CHARGING test is the naive one: it assumes the curve keeps its
// shape and just gets bigger. A different-size pack can differ in chemistry,
// thermal management and max current, none of which this knows about.
const CHARGING_SCALE_WARNING =
    'On a charging test, capacity assumes the curve keeps the same shape, ' +
    'just bigger. That is invalid for most optional battery packs, which can ' +
    'differ in chemistry, thermal management or max current limits. Use only ' +
    'when you have reason to believe the curve really does scale linearly.';

const TESTS_SECTION_HELP =
    'Measured charging and range tests for this vehicle. A charging test is a ' +
    'time-series of SoC against charge rate; a range test is a distance driven ' +
    'against energy used. Since the two were split they are separate records, ' +
    'paired to each other so a charging curve can be priced in miles — the ' +
    'pairing is set per test, and grouped by the session they were driven in.';

// ── Sub-tabs ─────────────────────────────────────────────────────────────────
// Counts are computed from data the view already has, so a tab can say how much
// is behind it without fetching anything to find out.
const SUBTABS = [
    { id: 'tests',       label: '📏 Charging & Range', count: d => d.displayRuns.length },
    { id: 'inherited',   label: '🔗 Inherited',     count: d => d.inheritedRuns.length },
    { id: 'performance', label: '⚡ Performance',   count: d => {
        const c = d.performanceCounts?.[d.vehicle.id];
        return c ? (c.accel ?? 0) + (c.braking ?? 0) : null;
    } },
    { id: 'epa',         label: '🏛 EPA',           count: d => d.vehicle.epa_mappings?.length || null },
];

/** Valid sub-tab ids, for App.jsx to validate the ?sub= URL param against. */
export const RUNS_SUBTAB_IDS = SUBTABS.map(t => t.id);

/** Sub-tab shown when none is specified, and the fallback for an unknown `?sub=`. */
export const DEFAULT_RUNS_SUBTAB = 'tests';

/**
 * One of the two scaling knobs on an inherited test, as an editable number.
 *
 * Module-level rather than inline: an inline definition is a new component type
 * every render, which remounts the input and loses the caret mid-typing.
 *
 * Commits on blur (and on Enter, by blurring) rather than per keystroke — each
 * save is a write plus a full vehicle reload, so per-keystroke would fire one
 * for every digit of "1.035".
 */
function FactorInput({ label, title, value, onChange, onCommit }) {
    return (
        <label className="flex items-center gap-1 text-xs text-secondary">
            <span title={title}>{label} ×</span>
            <input
                type="number"
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onCommit}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                step="0.001"
                min="0.001"
                placeholder="1.0"
                title={title}
                className="form-input w-20 .5 font-mono text-secondary"
            />
        </label>
    );
}


// ── Shared run-card display components ───────────────────────────────────────




// ── Derive-charging-axis panel ────────────────────────────────────────────────
// Three modes share one engine (src/utils/deriveChargingAxis.js):
//   time  — integrate elapsed time from (SoC, power); no anchors needed (t=0 origin)
//   soc   — integrate SoC from (time, power); needs a start-SoC origin
//   power — differentiate power from (SoC, time); no anchors
// By default each mode derives straight from the run's already-populated columns;
// calibration anchors are an opt-in refinement.
const DERIVE_MODES = {
    time: {
        label: 'Time', source: 'SoC + power', write: 'time',
        anchorCols: [
            { key: 'x', label: 'SoC (%)',       ph: 'SoC%',   min: 0, max: 100 },
            { key: 'y', label: 'Elapsed (min)', ph: 'minutes', step: 0.1 },
        ],
        canCalibrate: true, calibMinAnchors: 2, showShift: true,
        previewCols: [['soc', 'SoC %', v => `${v}%`], ['chargeRate', 'kW', v => v], ['time', 'Est. time (min)', v => v]],
    },
    soc: {
        label: 'SoC', source: 'time + power', write: 'SoC',
        anchorCols: [
            { key: 'x', label: 'Elapsed (min)', ph: 'minutes', step: 0.1 },
            { key: 'y', label: 'SoC (%)',       ph: 'SoC%',   min: 0, max: 100 },
        ],
        canCalibrate: true, calibMinAnchors: 2, needsOrigin: true, showShift: false,
        previewCols: [['time', 'Elapsed (min)', v => v], ['chargeRate', 'kW', v => v], ['soc', 'Est. SoC %', v => `${v}%`]],
    },
    power: {
        label: 'Power', source: 'SoC + time', write: 'power',
        anchorCols: [], canCalibrate: false, showShift: false,
        previewCols: [['soc', 'SoC %', v => `${v}%`], ['time', 'Elapsed (min)', v => v], ['chargeRate', 'Est. kW', v => v]],
    },
};

const DeriveAxisPanel = ({
    vehicle, editData, editDataLoading,
    mode, onChangeMode,
    calibrate, onChangeCalibrate,
    startSoc, onChangeStartSoc,
    chargingLoss, onChangeChargingLoss,
    anchors, onChangeAnchors,
    shiftToZero, onShiftToZeroChange,
    preview, applying, error,
    onPreview, onApply,
}) => {
    const cfg = DERIVE_MODES[mode];
    const batteryMissing = !vehicle?.battery;
    const validAnchors = anchors.filter(
        a => a.x !== '' && a.y !== '' && !isNaN(Number(a.x)) && !isNaN(Number(a.y))
    );
    const gridCols = 'grid-cols-[96px_96px_24px]';
    const usingAnchors = cfg.canCalibrate && calibrate;

    // SoC mode origin: prefer the first already-populated SoC in the data.
    const originRow = mode === 'soc'
        ? (editData || []).filter(r => r.time != null && r.soc != null).sort((a, b) => a.time - b.time)[0] || null
        : null;
    const startSocOk = !!originRow || (startSoc !== '' && !isNaN(Number(startSoc)));

    let ready;
    if (usingAnchors)          ready = validAnchors.length >= cfg.calibMinAnchors;
    else if (mode === 'soc')   ready = startSocOk;
    else                       ready = true; // time / power derive from populated data
    const canPreview = !batteryMissing && ready && editData !== null && !editDataLoading;

    return (
        <div className="mt-2 border rounded bg-[var(--color-surface-muted)] p-3 space-y-3">
            {/* Mode selector */}
            <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-secondary mr-1">Derive:</span>
                {Object.entries(DERIVE_MODES).map(([key, m]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onChangeMode(key)}
                        className={`text-xs px-2 py-1 rounded border ${mode === key
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-[var(--color-surface)] text-secondary hover:text-[var(--color-text-primary)]'}`}
                        title={`from ${m.source}`}
                    >{m.label}</button>
                ))}
                <span className="text-xs text-meta ml-1">from {cfg.source}</span>
            </div>

            {batteryMissing && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    ⚠ Set the battery capacity (kWh) on this vehicle to derive charging axes.
                </p>
            )}
            {editDataLoading && <p className="text-xs text-meta">Loading data…</p>}
            {!editDataLoading && (
                <>
                    {/* Default: derive straight from the populated columns */}
                    {!usingAnchors && (
                        <p className="text-xs text-secondary">
                            {mode === 'time' && 'Elapsed time is integrated from the populated SoC + power columns (t=0 at the first point).'}
                            {mode === 'power' && 'Power is averaged across each SoC interval from the elapsed-time delta. Needs ≥2 points with both SoC and time.'}
                            {mode === 'soc' && (originRow
                                ? `SoC is integrated from time + power, anchored to the first populated SoC (${originRow.soc}% at ${originRow.time} min).`
                                : 'SoC is integrated from the populated time + power columns. Enter the starting SoC to anchor the origin:')}
                        </p>
                    )}

                    {/* SoC origin input — only when no populated SoC is available */}
                    {!usingAnchors && mode === 'soc' && !originRow && (
                        <input
                            type="number" min="0" max="100"
                            placeholder="Start SoC (%)"
                            value={startSoc}
                            onChange={e => onChangeStartSoc(e.target.value)}
                            className="form-input form-input w-32"
                        />
                    )}

                    {/* Charging-loss factor — reported kW is charger-side; only η lands
                        in the pack. Moot once anchors calibrate to measured values. */}
                    {!usingAnchors && (
                        <div className="flex items-center gap-2 text-xs text-secondary flex-wrap">
                            <label htmlFor="derive-loss">Charging loss</label>
                            <input
                                id="derive-loss"
                                type="number" min="0" max="50" step="0.5"
                                value={chargingLoss}
                                onChange={e => onChangeChargingLoss(e.target.value)}
                                className="form-input form-input w-16"
                            />
                            <span>%</span>
                            <span className="text-meta">reported kW is charger-side; ~5% typical</span>
                        </div>
                    )}

                    {/* Opt-in calibration toggle */}
                    {cfg.canCalibrate && (
                        <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                            <input
                                type="checkbox"
                                checked={calibrate}
                                onChange={e => onChangeCalibrate(e.target.checked)}
                            />
                            {mode === 'soc'
                                ? 'Calibrate to a known end SoC (start + end anchors)'
                                : 'Calibrate to known (SoC, elapsed-time) reference points'}
                        </label>
                    )}

                    {usingAnchors && (
                        <div>
                            <p className="text-xs text-secondary mb-1">
                                {mode === 'soc'
                                    ? 'Start SoC anchors the origin; the end SoC calibrates capacity/efficiency.'
                                    : 'Known (SoC, elapsed-time) reference points.'}
                            </p>
                            <div className={`grid ${gridCols} gap-1 text-xs text-secondary px-1 mb-1`}>
                                {cfg.anchorCols.map(c => <span key={c.key}>{c.label}</span>)}
                            </div>
                            <div className="space-y-1">
                                {anchors.map((a, i) => (
                                    <div key={i} className={`grid ${gridCols} gap-1 items-center`}>
                                        {cfg.anchorCols.map(c => (
                                            <input
                                                key={c.key}
                                                type="number"
                                                min={c.min} max={c.max} step={c.step}
                                                placeholder={c.ph}
                                                value={a[c.key]}
                                                onChange={e => {
                                                    const next = [...anchors];
                                                    next[i] = { ...next[i], [c.key]: e.target.value };
                                                    onChangeAnchors(next);
                                                }}
                                                className="form-input form-input"
                                            />
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => onChangeAnchors(anchors.filter((_, j) => j !== i))}
                                            className="text-meta hover:text-red-500 font-bold leading-none"
                                            title="Remove anchor"
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => onChangeAnchors([...anchors, { x: '', y: '' }])}
                                className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                            >+ Add anchor</button>
                        </div>
                    )}

                    {cfg.showShift && (
                        <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                            <input
                                type="checkbox"
                                checked={shiftToZero}
                                onChange={e => onShiftToZeroChange(e.target.checked)}
                            />
                            Shift times so t=0 is at the first data point
                        </label>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={onPreview}
                            disabled={!canPreview}
                            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                        >Preview</button>
                        <button
                            type="button"
                            onClick={onApply}
                            disabled={!preview || applying}
                            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                        >{applying ? 'Applying…' : 'Apply'}</button>
                        {!batteryMissing && usingAnchors && validAnchors.length < cfg.calibMinAnchors && (
                            <span className="text-xs text-meta">Need ≥{cfg.calibMinAnchors} anchors to preview</span>
                        )}
                        {!batteryMissing && !usingAnchors && mode === 'soc' && !startSocOk && (
                            <span className="text-xs text-meta">Enter a start SoC to preview</span>
                        )}
                    </div>

                    {error && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>
                    )}

                    {preview && !error && (
                        <div className="space-y-1">
                            {preview.warnings.length > 0 && (
                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5">
                                    {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                                </div>
                            )}
                            <div className="max-h-64 overflow-y-auto border rounded">
                                <table className="text-xs w-full">
                                    <thead className="bg-[var(--color-surface-sunken)] sticky top-0">
                                        <tr>
                                            {cfg.previewCols.map(([field, label]) => (
                                                <th key={field} className="px-2 py-1 text-left font-medium">{label}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {preview.points.map((p, i) => (
                                            <tr key={i}>
                                                {cfg.previewCols.map(([field, , render]) => (
                                                    <td key={field} className="px-2 py-0.5">{render(p[field])}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-secondary font-medium">
                                Apply will write {preview.points.length} {cfg.write} values to this run.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default function RunsView({ vehicle, canCreate, canEdit, canDelete, canPublish, onAddRun, onUpdateRun, onSetDefaultRun, onDeleteRun, onMergeRunData, onReplaceRunData, onDuplicateRun, onViewChart, onToggleVehicleVisibility, onUpdateVehicle, onDuplicateVehicle, onDeleteVehicle, tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage, onUpdateVehicleSpecs, specCustomFieldSuggestions, vehicles, onCopyRunToVehicle, onViewVehicle, subtab, onSubtabChange }) {
    const { runVotes, loadRunVotes, toggleRunVote, units, manufacturers, addManufacturer, isContributor, addSpecLink, updateSpecLink, deleteSpecLink, updateRunColor, setPairedChargingRun, clearDefaultRun, performanceCounts, testSessions, createTestSession, updateTestSession, deleteTestSession, setRunsSession, searchEpaTestGroups, linkEpaTestGroup, createAndLinkEpaTestGroup, updateEpaMapping, unlinkEpaTestGroup, updateEpaTestGroup } = useAppContext();

    // ── Vehicle edit form state ───────────────────────────────────────────────
    // ── Sub-tabs ──────────────────────────────────────────────────────────────
    // Four independent bodies of data hung off one vehicle, previously stacked
    // into one very long page: a curator scrolled past every charging run to
    // reach EPA. Only the active one mounts, so the Performance and EPA sections
    // no longer fetch on every visit to a vehicle's runs. Lifted to App.jsx
    // (subtab/onSubtabChange props) so it can be persisted in the URL.
    const [showEditVehicle, setShowEditVehicle] = useState(false);
    const [showEditSpecs, setShowEditSpecs] = useState(false);
    const [showViewSpecs, setShowViewSpecs] = useState(false);
    const [vehicleFormData, setVehicleFormData] = useState({
        name: '', make: '', model: '', trim: '', year: '', battery: '', range: '', manufacturer_id: null,
    });
    const [vehicleFormTags, setVehicleFormTags] = useState([]);
    const [vehicleNewTagName, setVehicleNewTagName] = useState('');
    const [vehicleImageUploading, setVehicleImageUploading] = useState(false);

    const openEditVehicle = () => {
        setVehicleFormData({
            name: vehicle.name,
            make: vehicle.make || '',
            model: vehicle.model || '',
            trim: vehicle.trim || '',
            year: vehicle.year || '',
            battery: vehicle.battery || '',
            range: vehicle.range || '',
            manufacturer_id: vehicle.manufacturer?.id ?? null,
        });
        setVehicleFormTags(vehicle.tags || []);
        setVehicleNewTagName('');
        setShowEditVehicle(true);
    };

    const closeEditVehicle = () => {
        setShowEditVehicle(false);
        setVehicleFormTags([]);
        setVehicleNewTagName('');
    };

    const handleVehicleSubmit = async (e) => {
        e.preventDefault();
        await onUpdateVehicle(vehicle.id, vehicleFormData);
        await onSyncVehicleTags(vehicle.id, vehicleFormTags.map(t => t.id));
        closeEditVehicle();
    };

    const handleVehicleImageReady = async (renditions) => {
        if (!renditions) return;
        setVehicleImageUploading(true);
        await onUploadVehicleImage(renditions);
        setVehicleImageUploading(false);
    };

    const vehicleAvailableTags = (tags || []).filter(t => !vehicleFormTags.some(ft => ft.id === t.id));

    // ── Upload / CSV wizard state ────────────────────────────────────────────
    const [showUpload, setShowUpload] = useState(false);
    const [uploadStep, setUploadStep] = useState('file');
    const [csvData, setCsvData] = useState(null);
    const [fieldMapping, setFieldMapping] = useState({});
    const [runMetadata, setRunMetadata] = useState({
        name: '',
        date: new Date().toISOString().split('T')[0],
        softwareVersion: '',
        conditions: '',
        dataFlags: ['charging'],
        source: '',
        startSoc: '',
        endSoc: '',
        speedMph: '',
        distanceMiles: '',
        energyKwh: '',
        chargeEnergyKwh: '',
        temperatureF: '',
        speedBasis: '',
        altitudeFt: '',
        elevationGainFt: '',
        windSpeedMph: '',
        windDirectionDeg: '',
        sourceUrl: '',
    });
    // uploadMode: 'create' (new run) | 'merge' (patch fields into existing rows)
    const [uploadMode, setUploadMode] = useState('create');
    const [mergeTargetRun, setMergeTargetRun] = useState(null);
    // joinKey: which column links incoming rows to existing ones
    const [joinKey, setJoinKey] = useState('soc');
    const [merging, setMerging] = useState(false);
    // Tracks which derived-column offers the user has accepted (range: null | 'epa' | 'measured')
    const [estimations, setEstimations] = useState({ range: null });
    const [csvText, setCsvText]                       = useState('');
    const [noHeaders, setNoHeaders]                   = useState(false);
    const [selectedRangeTestRunId, setSelectedRangeTestRunId] = useState(null);

    // ── Run inline edit state ────────────────────────────────────────────────
    const [editingRunId, setEditingRunId] = useState(null);
    const [editFormData, setEditFormData] = useState({});

    // ── Overflow action menu state ────────────────────────────────────────────
    const [openMenuRunId, setOpenMenuRunId] = useState(null);

    // ── Inherited test link form state ────────────────────────────────────────
    const [showAddLink, setShowAddLink]     = useState(false);
    const [newLinkSourceId, setNewLinkSourceId] = useState('');
    // Which of the source vehicle's runs to inherit, and of which kind. The
    // form used to link every unlinked run at once, so "inherit the charging
    // tests but not the range tests" could only be done by linking the lot and
    // removing what you did not want.
    const [newLinkKind, setNewLinkKind] = useState('all');
    const [newLinkRunIds, setNewLinkRunIds] = useState(null);   // null = all matching // source vehicle id
    // Two independent knobs — see CAPACITY_HELP / EFFICIENCY_HELP.
    const [newLinkEfficiency, setNewLinkEfficiency] = useState('');
    const [newLinkCapacity, setNewLinkCapacity]     = useState('');
    const [newLinkNotes, setNewLinkNotes]       = useState('');
    const [linkSaving, setLinkSaving]           = useState(false);
    // linkId -> string (local edit values, one map per factor)
    const [efficiencyEdits, setEfficiencyEdits] = useState({});
    const [capacityEdits, setCapacityEdits]     = useState({});

    // ── Inline data-table state (edit mode) ──────────────────────────────────
    const [editData, setEditData]               = useState(null);   // null=not fetched, []=loaded
    const [editDataLoading, setEditDataLoading] = useState(false);
    const [editDataDirty, setEditDataDirty]     = useState(false);  // cells modified
    const [showDataTable, setShowDataTable]     = useState(false);  // expand/collapse
    const [savingData, setSavingData]           = useState(false);
    const [editCalculatedFields, setEditCalculatedFields] = useState([]); // which fields are estimated
    const [editCalcKwh, setEditCalcKwh]         = useState(null);   // kWh derived from data_points in edit mode
    const [sortField, setSortField]             = useState(null);   // active sort column key
    const [sortDir, setSortDir]                 = useState('asc');  // 'asc' | 'desc'

    // ── Derive-charging-axis panel state ──────────────────────────────────────
    const [showEstimatePanel, setShowEstimatePanel] = useState(false);
    const [estimateMode, setEstimateMode]           = useState('time'); // 'time' | 'soc' | 'power'
    const [estimateCalibrate, setEstimateCalibrate] = useState(false);  // opt-in anchor calibration
    const [estimateStartSoc, setEstimateStartSoc]   = useState('');     // SoC-mode origin when none populated
    const [estimateLoss, setEstimateLoss]           = useState('5');    // assumed charging loss %, charger→pack
    const [estimateAnchors, setEstimateAnchors]     = useState([]);   // [{x:'', y:''}] — x=domain, y=target
    const [estimateShift, setEstimateShift]         = useState(false);
    const [estimatePreview, setEstimatePreview]     = useState(null); // null | {points, warnings}
    const [estimateApplying, setEstimateApplying]   = useState(false);
    const [estimateError, setEstimateError]         = useState('');

    // ── Per-card lazy kWh check (card view, not edit mode) ───────────────────
    // { [runId]: { kwh: number|null, loading: bool } }
    const [calcKwhByRun, setCalcKwhByRun]       = useState({});
    const [duplicatingRunId, setDuplicatingRunId] = useState(null);
    const [duplicatingVehicle, setDuplicatingVehicle] = useState(false);
    const [exportingRunId, setExportingRunId]     = useState(null);
    const [copyToRun, setCopyToRun]               = useState(null);  // run being copied to another vehicle
    const [copyingToVehicleId, setCopyingToVehicleId] = useState('');

    const {
        pendingDeletes, committedDeletes, undoState, secondsLeft,
        queueDelete, restoreItem, clearQueue, commitDeletes, undoDelete,
    } = useDeleteQueue(onDeleteRun);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const resetUploadState = () => {
        setShowUpload(false);
        setUploadStep('file');
        setCsvData(null);
        setFieldMapping({});
        setRunMetadata({ name: '', date: new Date().toISOString().split('T')[0], softwareVersion: '', conditions: '', dataFlags: ['charging'], source: '', startSoc: '', endSoc: '', speedMph: '', distanceMiles: '', energyKwh: '', chargeEnergyKwh: '', temperatureF: '', speedBasis: '', altitudeFt: '', elevationGainFt: '', windSpeedMph: '', windDirectionDeg: '', sourceUrl: '' });
        setUploadMode('create');
        setMergeTargetRun(null);
        setEstimations({ range: null });
        setJoinKey('soc');
        setMerging(false);
        setCsvText('');
        setNoHeaders(false);
    };

    // ── File upload ───────────────────────────────────────────────────────────

    const autoMapHeaders = (headers) => {
        const autoMapping = {};
        headers.forEach(header => {
            const lower = String(header).toLowerCase();
            if (lower.includes('soc') || lower.includes('state of charge')) autoMapping.soc = header;
            if (lower.includes('charge') && lower.includes('rate')) autoMapping.chargeRate = header;
            // 'timestamp' is more specific — check it before the generic 'time' test
            if (lower.includes('timestamp')) autoMapping.timestamp = header;
            else if (lower.includes('time')) autoMapping.time = header;
            if (lower.includes('range')) autoMapping.range = header;
            if (lower.includes('temp')) autoMapping.temperature = header;
            if (lower.includes('frame')) autoMapping.frame = header;
        });
        return autoMapping;
    };

    /**
     * After field mapping, detect timestamp columns and convert them to elapsed
     * minutes from the first data point. Handles wall-clock datetimes as well as
     * elapsed clock / SMPTE timecode strings (HH:MM:SS, MM:SS, HH:MM:SS:FF) via
     * {@link timestampToMs} — see src/utils/parseElapsedTime.js.
     *
     * Two cases handled:
     *   A. `timestamp` field is mapped (explicit wall-clock/timecode column).
     *      → compute `time` from it if `time` is not already mapped.
     *   B. `time` field is mapped but the first non-null value is a timestamp
     *      string, not a number.
     *      → convert `time` in-place; preserve original string as `timestamp`.
     *
     * Returns { rows, converted: boolean }.
     */
    const applyTimestampConversion = (rows) => {
        const firstWithTs   = rows.find(r => r.timestamp != null);
        const firstWithTime = rows.find(r => r.time != null);

        // Case A: explicit timestamp column mapped
        if (firstWithTs && isTimestampValue(firstWithTs.timestamp)) {
            const t0 = timestampToMs(firstWithTs.timestamp);
            return {
                rows: rows.map(row => {
                    const ms = row.timestamp != null ? timestampToMs(row.timestamp) : null;
                    return {
                        ...row,
                        // Only fill `time` when it wasn't already supplied
                        time: row.time != null ? row.time
                            : ms != null ? roundTo((ms - t0) / 60000, 3) : null,
                    };
                }),
                converted: true,
            };
        }

        // Case B: `time` column contains timestamp strings
        if (firstWithTime && isTimestampValue(firstWithTime.time)) {
            const t0 = timestampToMs(firstWithTime.time);
            return {
                rows: rows.map(row => {
                    const ms = row.time != null ? timestampToMs(row.time) : null;
                    return {
                        ...row,
                        timestamp: row.timestamp ?? row.time,   // save original
                        time: ms != null ? roundTo((ms - t0) / 60000, 3) : null,
                    };
                }),
                converted: true,
            };
        }

        return { rows, converted: false };
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setCsvText(''); // clear any pasted text
        try {
            const result = await parseCSV(file, { noHeaders });
            setCsvData(result);
            setFieldMapping(noHeaders ? {} : autoMapHeaders(result.meta.fields));
            setUploadStep('mapping');
        } catch (error) {
            alert('Error parsing CSV: ' + error.message);
        }
    };

    const handleCsvTextPaste = async (text) => {
        setCsvText(text);
        if (!text.trim()) {
            setCsvData(null);
            setFieldMapping({});
            setUploadStep('file');
            return;
        }
        try {
            const result = await parseCSVText(text, { noHeaders });
            if (result.data.length > 0) {
                setCsvData(result);
                setFieldMapping(noHeaders ? {} : autoMapHeaders(result.meta.fields));
                setUploadStep('mapping');
            }
        } catch (error) {
            alert('Error parsing CSV text: ' + error.message);
        }
    };

    // ── Create-mode import ────────────────────────────────────────────────────

    const handleSaveRecord = () => {
        const { dataFlags, ...metaRest } = runMetadata;
        const run = {
            ...metaRest,
            kind: dataFlags.includes('range') ? 'range' : 'charging',
            data: [],
            uploadDate: new Date().toISOString()
        };
        onAddRun(run);
        resetUploadState();
    };

    // Sort data points by a field, toggling direction on repeated clicks.
    // Actually reorders editData so the new order is persisted on save.
    const handleSortByField = (field) => {
        const newDir = sortField === field && sortDir === 'asc' ? 'desc' : 'asc';
        setSortField(field);
        setSortDir(newDir);
        setEditData(prev => {
            if (!prev) return prev;
            return [...prev].sort((a, b) => {
                const aVal = a[field] ?? (newDir === 'asc' ? Infinity : -Infinity);
                const bVal = b[field] ?? (newDir === 'asc' ? Infinity : -Infinity);
                return newDir === 'asc' ? aVal - bVal : bVal - aVal;
            });
        });
        setEditDataDirty(true);
    };

    // Sort an array of data-point objects by time (primary) then soc (secondary).
    // Used automatically on import to fix out-of-order CSV data.
    const sortPointsByTime = (points) =>
        [...points].sort((a, b) => {
            const tA = a.time ?? Infinity, tB = b.time ?? Infinity;
            if (tA !== tB) return tA - tB;
            return (a.soc ?? Infinity) - (b.soc ?? Infinity);
        });

    const handleImport = () => {
        if (!csvData) return;

        let transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

        // Convert wall-clock timestamps → elapsed minutes if needed
        ({ rows: transformedData } = applyTimestampConversion(transformedData));

        // Sort by time → soc so out-of-order CSV files don't create jumbled charts
        transformedData = sortPointsByTime(transformedData);

        // Apply opted-in estimations
        const calculatedFields = [];
        if (estimations.range) {
            const ratedRange = estimations.range === 'measured' ? effectiveRangeFromTest : vehicle.range;
            if (ratedRange) {
                transformedData = transformedData.map(row => ({
                    ...row,
                    range: row.range != null ? row.range
                        : roundField((parseFloat(row.soc) / 100) * ratedRange, 1),
                }));
                calculatedFields.push('range');
            }
        }

        const { dataFlags, ...metaRest } = runMetadata;
        const run = {
            ...metaRest,
            kind: dataFlags.includes('range') ? 'range' : 'charging',
            data: transformedData,
            fieldMapping,
            calculated_fields: calculatedFields,
            uploadDate: new Date().toISOString()
        };

        onAddRun(run);
        resetUploadState();
    };

    // ── Merge-mode import ─────────────────────────────────────────────────────

    const handleMerge = async () => {
        if (!csvData || !mergeTargetRun) return;

        let transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

        // Convert wall-clock timestamps → elapsed minutes if needed
        ({ rows: transformedData } = applyTimestampConversion(transformedData));

        // Apply opted-in estimations
        if (estimations.range) {
            const ratedRange = estimations.range === 'measured' ? effectiveRangeFromTest : vehicle.range;
            if (ratedRange) {
                transformedData = transformedData.map(row => ({
                    ...row,
                    range: row.range != null ? row.range
                        : roundField((parseFloat(row.soc) / 100) * ratedRange, 1),
                }));
                // Flag range as calculated on the target run
                const current = mergeTargetRun?.calculated_fields || [];
                if (!current.includes('range')) {
                    onUpdateRun(mergeTargetRun.id, { ...mergeTargetRun, calculated_fields: [...current, 'range'] });
                }
            }
        }

        // Determine the effective join key: auto-select when only one is mapped
        const effectiveJoinKey = canJoinBySoc && !canJoinByTime ? 'soc'
                               : !canJoinBySoc && canJoinByTime ? 'time'
                               : joinKey; // user-chosen when both are available

        setMerging(true);
        try {
            const result = await onMergeRunData(mergeTargetRun.id, transformedData, effectiveJoinKey);
            resetUploadState();
            if (result) {
                alert(`Merge complete: ${result.updated} rows updated, ${result.inserted} new rows inserted.`);
            }
        } catch {
            setMerging(false); // leave the panel open so the user can retry
        }
    };

    // ── Edit handlers ─────────────────────────────────────────────────────────

    const handleEditRun = (run) => {
        // Reset per-run data/panel state so a previously-edited run's points
        // don't stick (editData is lazy-loaded only when null).
        setEditData(null);
        setEditDataDirty(false);
        setShowDataTable(false);
        setEditCalcKwh(null);
        setSortField(null);
        setSortDir('asc');
        setShowEstimatePanel(false);
        setEstimateAnchors([]);
        setEstimateStartSoc('');
        setEstimateCalibrate(false);
        setEstimatePreview(null);
        setEstimateError('');

        setEditingRunId(run.id);
        setEditFormData({
            name: run.name,
            date: run.date,
            softwareVersion: run.softwareVersion || run.software_version || '',
            conditions: run.conditions || '',
            dataFlags: inferRunFlags(run),
            source: run.source || '',
            startSoc: run.start_soc ?? '',
            endSoc: run.end_soc ?? '',
            speedMph: run.speed_mph ?? '',
            distanceMiles: run.distance_miles ?? '',
            energyKwh: run.energy_kwh ?? '',
            chargeEnergyKwh: run.charge_energy_kwh ?? '',
            temperatureF: run.temperature_f ?? '',
            speedBasis: run.speed_basis ?? '',
            altitudeFt: run.altitude_ft ?? '',
            elevationGainFt: run.elevation_gain_ft ?? '',
            windSpeedMph: run.avg_wind_speed_mph ?? '',
            windDirectionDeg: run.wind_direction_deg ?? '',
            sourceUrl: run.source_url || '',
        });
        setEditCalculatedFields(run.calculated_fields || []);
    };

    const handleSaveEdit = async (runId) => {
        setSavingData(true);
        try {
            // Convert dataFlags → boolean columns and drop the flags field
            const { dataFlags, ...formRest } = editFormData;
            await onUpdateRun(runId, {
                ...formRest,
                kind: dataFlags.includes('range') ? 'range' : 'charging',
                calculated_fields: editCalculatedFields,
            });
            // Save table data only if the editor made changes
            if (editDataDirty && canEdit(vehicle) && editData !== null) {
                await onReplaceRunData(runId, editData.map((row, i) => ({ ...row, frame: i })));
            }
            // Close the form only on success
            setEditingRunId(null);
            setEditFormData({});
            setEditData(null);
            setEditDataDirty(false);
            setShowDataTable(false);
            setEditCalcKwh(null);
            setShowEstimatePanel(false);
            setEstimateAnchors([]);
            setEstimatePreview(null);
            setEstimateError('');
        } catch (err) {
            alert(`Save failed: ${err?.message ?? err}`);
        } finally {
            setSavingData(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingRunId(null);
        setEditFormData({});
        setEditCalculatedFields([]);
        setEditData(null);
        setEditDataDirty(false);
        setShowDataTable(false);
        setEditCalcKwh(null);
        setShowEstimatePanel(false);
        setEstimateAnchors([]);
        setEstimatePreview(null);
        setEstimateError('');
    };

    // ── Update data (merge mode entry) ────────────────────────────────────────

    const handleUpdateData = (run) => {
        setMergeTargetRun(run);
        setUploadMode('merge');
        setShowUpload(true); onSubtabChange('tests');
        setUploadStep('file');
        setCsvData(null);
        setFieldMapping({});
    };

    // ── Data table helpers (edit mode) ───────────────────────────────────────

    const handleToggleDataTable = async (runId) => {
        if (!showDataTable && editData === null) {
            // First expand: lazy-load the data points
            setShowDataTable(true);
            setEditDataLoading(true);
            try {
                const data = await dataService.getRunData(runId);
                setEditData(data);
                setSortField(null);
                setSortDir('asc');
                // Auto-calculate kWh for charging runs that have time + chargeRate
                setEditCalcKwh(calcKwhFromPoints(data));
            } catch (err) {
                console.error('Error loading run data:', err);
                setEditData([]);
            } finally {
                setEditDataLoading(false);
            }
        } else {
            setShowDataTable(s => !s);
        }
    };

    const handleEditDataCell = (rowIdx, field, value) => {
        const parsed = value === '' ? null : parseFloat(value);
        setEditData(prev => prev.map((row, i) =>
            i === rowIdx ? { ...row, [field]: isNaN(parsed) ? null : parsed } : row
        ));
        setEditDataDirty(true);
    };

    const handleAddDataRow = () => {
        setEditData(prev => [...prev, { soc: null, chargeRate: null, time: null, range: null, temperature: null }]);
        setEditDataDirty(true);
    };

    const handleDeleteDataRow = (rowIdx) => {
        setEditData(prev => prev.filter((_, i) => i !== rowIdx));
        setEditDataDirty(true);
    };

    const handleClearColumn = (field) => {
        setEditData(prev => prev.map(row => ({ ...row, [field]: null })));
        setEditCalculatedFields(prev => prev.filter(f => f !== field));
        setEditDataDirty(true);
    };

    // Fill null range values from SoC × effective range from the selected test run.
    const handleEstimateRangeInEdit = (ratedRange = effectiveRangeFromTest) => {
        if (!editData || !ratedRange) return;
        setEditData(prev => prev.map(row => ({
            ...row,
            range: row.range != null ? row.range
                : (row.soc != null ? roundTo((row.soc / 100) * ratedRange, 1) : null),
        })));
        setEditCalculatedFields(prev => prev.includes('range') ? prev : [...prev, 'range']);
        setEditDataDirty(true);
    };

    // ── Derive charging axis (time / SoC / power) ─────────────────────────────

    // Seed the anchor rows from existing data for the given derive mode.
    const seedAnchorsFor = (mode, data) => {
        const rows = data || [];
        if (mode === 'time') {
            // (SoC, time) pairs from rows carrying both
            const fromData = rows
                .filter(p => p.soc != null && p.time != null)
                .sort((a, b) => a.soc - b.soc)
                .map(p => ({ x: String(p.soc), y: String(p.time) }));
            return fromData.length >= 2 ? fromData : [{ x: '', y: '' }, { x: '', y: '' }];
        }
        if (mode === 'soc') {
            // Start/end (time, SoC) anchors from the time-extent of the data
            const timed = rows.filter(p => p.time != null).sort((a, b) => a.time - b.time);
            if (timed.length >= 2) {
                const first = timed[0], last = timed[timed.length - 1];
                return [
                    { x: String(first.time), y: first.soc != null ? String(first.soc) : '' },
                    { x: String(last.time),  y: last.soc  != null ? String(last.soc)  : '' },
                ];
            }
            return [{ x: '', y: '' }, { x: '', y: '' }];
        }
        return []; // power: no anchors
    };

    const handleSelectEstimateMode = (mode) => {
        setEstimateMode(mode);
        setEstimateAnchors(seedAnchorsFor(mode, editData));
        setEstimatePreview(null);
        setEstimateError('');
    };

    const handleToggleCalibrate = (on) => {
        setEstimateCalibrate(on);
        if (on) setEstimateAnchors(seedAnchorsFor(estimateMode, editData));
        setEstimatePreview(null);
        setEstimateError('');
    };

    // Build the anchor list actually fed to the engine, honouring the
    // "derive from populated data" default vs. opt-in calibration.
    const buildDeriveAnchors = () => {
        if (estimateMode === 'power') return [];
        if (estimateCalibrate) return estimateAnchors;
        if (estimateMode === 'time') return []; // pure physics, t=0 origin
        // SoC origin: prefer the first already-populated SoC, else the typed start SoC.
        const populated = (editData || [])
            .filter(r => r.time != null && r.soc != null)
            .sort((a, b) => a.time - b.time)[0];
        if (populated) return [{ x: populated.time, y: populated.soc }];
        if (estimateStartSoc !== '' && !isNaN(Number(estimateStartSoc))) {
            const times = (editData || []).filter(r => r.time != null).map(r => r.time);
            const x = times.length ? Math.min(...times) : 0;
            return [{ x, y: estimateStartSoc }];
        }
        return []; // engine throws a friendly "provide a start SoC" error
    };

    const handleToggleEstimatePanel = async (runId) => {
        if (showEstimatePanel) {
            setShowEstimatePanel(false);
            return;
        }
        if (editData !== null) {
            setEstimateAnchors(seedAnchorsFor(estimateMode, editData));
        } else {
            // Load data (shared with data-table state)
            setEditDataLoading(true);
            try {
                const data = await dataService.getRunData(runId);
                setEditData(data);
                setSortField(null);
                setSortDir('asc');
                setEditCalcKwh(calcKwhFromPoints(data));
                setEstimateAnchors(seedAnchorsFor(estimateMode, data));
            } catch (err) {
                console.error('Error loading run data for axis derivation:', err);
                setEditData([]);
                setEstimateAnchors(seedAnchorsFor(estimateMode, []));
            } finally {
                setEditDataLoading(false);
            }
        }
        setEstimatePreview(null);
        setEstimateError('');
        setShowEstimatePanel(true);
    };

    const handleEstimatePreview = () => {
        setEstimateError('');
        setEstimatePreview(null);
        try {
            const result = deriveChargingAxis({
                dataPoints:   editData,
                batteryKwh:   vehicle.battery,
                target:       estimateMode,
                anchors:      buildDeriveAnchors(),
                shiftToZero:  estimateShift,
                chargingLoss: estimateLoss === '' ? 0 : Number(estimateLoss) / 100,
            });
            setEstimatePreview(result);
        } catch (err) {
            setEstimateError(err.message);
        }
    };

    // Per-mode apply config: which field is written, the join key, and how to
    // map preview points → merge points / local-row patch.
    const APPLY_CONFIG = {
        time:  { field: 'time',       joinKey: 'soc',  toMerge: p => ({ soc: p.soc, time: p.time }) },
        soc:   { field: 'soc',        joinKey: 'time', toMerge: p => ({ time: p.time, soc: p.soc }) },
        power: { field: 'chargeRate', joinKey: 'soc',  toMerge: p => ({ soc: p.soc, chargeRate: p.chargeRate }) },
    };

    const handleEstimateApply = async (run) => {
        if (!estimatePreview) return;
        const ac = APPLY_CONFIG[estimateMode];
        setEstimateApplying(true);
        try {
            await onMergeRunData(run.id, estimatePreview.points.map(ac.toMerge), ac.joinKey);
            // Mark the derived column as a calculated (estimated) field
            const updated = editCalculatedFields.includes(ac.field)
                ? editCalculatedFields
                : [...editCalculatedFields, ac.field];
            setEditCalculatedFields(updated);
            onUpdateRun(run.id, { calculated_fields: updated });
            // Patch local editData so the data table reflects the new values
            if (editData) {
                const byKey = Object.fromEntries(estimatePreview.points.map(p => [p[ac.joinKey], p[ac.field]]));
                setEditData(prev => prev.map(row =>
                    row[ac.joinKey] != null && byKey[row[ac.joinKey]] !== undefined
                        ? { ...row, [ac.field]: byKey[row[ac.joinKey]] }
                        : row
                ));
            }
            setEstimatePreview(null);
            setEstimateError('');
        } catch (err) {
            setEstimateError('Failed to apply: ' + err.message);
        } finally {
            setEstimateApplying(false);
        }
    };

    // ── Join key logic (merge mode only) ─────────────────────────────────────
    const canJoinBySoc  = uploadMode === 'merge' && !!fieldMapping.soc;
    const canJoinByTime = uploadMode === 'merge' && !!fieldMapping.time;
    // Show radio selector only when the user has a real choice
    const showJoinSelector  = canJoinBySoc && canJoinByTime;
    // Disable confirm when there's no key to join on at all
    const missingJoinKey    = uploadMode === 'merge' && !canJoinBySoc && !canJoinByTime;

    // ── Derived-column offer logic ────────────────────────────────────────────
    // Range test runs available for measured-range estimation.
    // Requires a range run with distance_miles; start_soc/end_soc are optional —
    // if absent we treat the test as a full 0→100% run (a safe approximation).
    const rangeTestRuns = (vehicle?.runs ?? [])
        .filter(r => isRangeRun(r) && r.distance_miles > 0
            && (r.start_soc == null || r.end_soc == null || r.start_soc !== r.end_soc))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    const selectedRangeTestRun = rangeTestRuns.find(r => r.id === selectedRangeTestRunId) ?? rangeTestRuns[0] ?? null;
    const effectiveRangeFromTest = selectedRangeTestRun
        ? (() => {
            const hasSoc = selectedRangeTestRun.start_soc != null && selectedRangeTestRun.end_soc != null;
            const socDelta = hasSoc ? Math.abs(selectedRangeTestRun.start_soc - selectedRangeTestRun.end_soc) : 100;
            return Math.round(selectedRangeTestRun.distance_miles * 100 / socDelta);
        })()
        : null;
    const offerRangeEstimateTest = !!fieldMapping.soc && !fieldMapping.range && rangeTestRuns.length > 0;

    const roundField = roundTo;

    // ── kWh calculator from data_points ──────────────────────────────────────
    // Trapezoidal integration of chargeRate (kW) over time.
    // Time-unit auto-detection: if max time_value > 300 assume seconds, else minutes.
    // Returns rounded kWh, or null if insufficient data.
    const calcKwhFromPoints = (points) => {
        const pts = points.filter(p => p.chargeRate != null && p.time != null);
        if (pts.length < 2) return null;
        const sorted = [...pts].sort((a, b) => a.time - b.time);
        const maxTime = sorted[sorted.length - 1].time;
        const toHours = maxTime > 300 ? 1 / 3600 : 1 / 60;
        let kwh = 0;
        for (let i = 1; i < sorted.length; i++) {
            const dt = (sorted[i].time - sorted[i - 1].time) * toHours;
            const avgKw = (sorted[i].chargeRate + sorted[i - 1].chargeRate) / 2;
            if (dt > 0 && avgKw >= 0) kwh += avgKw * dt;
        }
        return kwh < 0.1 ? null : roundTo(kwh, 1);
    };

    // ── On-demand kWh comparison for card view (non-edit) ────────────────────
    const handleCheckKwh = async (run) => {
        setCalcKwhByRun(prev => ({ ...prev, [run.id]: { loading: true } }));
        try {
            const data = await dataService.getRunData(run.id);
            const kwh = calcKwhFromPoints(data);
            setCalcKwhByRun(prev => ({ ...prev, [run.id]: { kwh, loading: false } }));
        } catch {
            setCalcKwhByRun(prev => ({ ...prev, [run.id]: { kwh: null, loading: false, error: true } }));
        }
    };

    // ── Duplicate run ─────────────────────────────────────────────────────────
    const handleDuplicateRun = async (run) => {
        setDuplicatingRunId(run.id);
        try {
            await onDuplicateRun(run.id);
        } finally {
            setDuplicatingRunId(null);
        }
    };

    // ── Copy run to another vehicle ───────────────────────────────────────────
    const handleCopyToConfirm = async () => {
        if (!copyToRun || !copyingToVehicleId) return;
        await onCopyRunToVehicle(copyToRun, Number(copyingToVehicleId));
        setCopyToRun(null);
        setCopyingToVehicleId('');
    };

    // Vehicles the current user can edit, excluding the current vehicle
    const copyTargetVehicles = (vehicles || []).filter(v =>
        v.id !== vehicle.id && canEdit(v)
    );

    // ── Export run data to CSV ────────────────────────────────────────────────
    const handleExportCsv = async (run) => {
        setExportingRunId(run.id);
        try {
            const points = await dataService.getRunData(run.id);
            const csv = Papa.unparse(points.map(p => ({
                frame:       p.frame,
                soc:         p.soc,
                charge_rate: p.chargeRate,
                time:        p.time,
                range:       p.range,
                temperature: p.temperature,
            })));
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${run.name.replace(/[^a-z0-9]/gi, '_')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setExportingRunId(null);
        }
    };

    // ── Derived state ─────────────────────────────────────────────────────────

    const availableFields  = csvData?.meta.fields || [];
    const allDisplayRuns   = (vehicle.runs || []).filter(r => !committedDeletes.has(r.id));
    const displayRuns      = allDisplayRuns.filter(r => !r._inherited);

    // Runs of one session sit together under a heading that names the outing.
    // A flat pile said nothing about which two runs were the same test event,
    // which is the entire reason sessions exist.
    const runGroups = useMemo(() => groupRunsBySession(displayRuns), [displayRuns]);

    // The real SoC span of each charging run, from its data points. The stored
    // start_soc/end_soc are a leftover of the 046 split and describe the
    // discharge, so a charging card would otherwise read its own session
    // backwards — see DataService.getSocRanges.
    const [socRanges, setSocRanges] = useState({});
    const chargingRunKey = displayRuns
        .filter(r => runKindFrom(r) === 'charging')
        .map(r => r.id).join(',');
    useEffect(() => {
        const ids = chargingRunKey ? chargingRunKey.split(',') : [];
        if (!ids.length) return;
        let cancelled = false;
        dataService.getSocRanges(ids)
            .then(ranges => { if (!cancelled) setSocRanges(prev => ({ ...prev, ...ranges })); })
            .catch(() => { /* the card falls back to its stored fields */ });
        return () => { cancelled = true; };
    }, [chargingRunKey]);
    const [collapsedSessions, setCollapsedSessions] = useState(() => new Set());
    const [editingSessionId, setEditingSessionId] = useState(null);
    const toggleSessionGroup = (key) => setCollapsedSessions(prev => {
        const next = new Set(prev);
        const k = String(key);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
    });
    const inheritedRuns    = allDisplayRuns.filter(r => r._inherited);
    const barVisible       = pendingDeletes.size > 0 || !!undoState;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            {/* Vehicle summary header */}
            <div className="card py-3 px-4 flex items-center gap-4 mb-6">
                <div className="list-thumbnail">
                    {displayImageUrl(vehicle)
                        ? <img src={displayImageUrl(vehicle)} alt={vehicle.name} decoding="async" className="w-full h-full object-cover" />
                        : <span>🚗</span>
                    }
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg leading-tight">{vehicle.name}</h3>
                    <p className="text-secondary text-sm">{[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}</p>
                    <div className="text-sm text-secondary mt-0.5 flex flex-wrap gap-x-3">
                        {vehicle.battery && <span>Battery: {vehicle.battery} kWh</span>}
                        {vehicle.range && <span>Range: {vehicle.range} mi</span>}
                    </div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0 items-stretch w-28">
                    {(() => {
                        const isPublic = vehicle.visibility === 'public';
                        const base = 'w-full flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition';
                        return canPublish() ? (
                            <button
                                onClick={() => onToggleVehicleVisibility(vehicle.id, isPublic ? 'private' : 'public')}
                                className={`${base} ${isPublic ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200' : 'bg-[var(--color-surface-sunken)] text-secondary border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'}`}
                            >
                                {isPublic ? '🌐 Public' : '🔒 Private'}
                            </button>
                        ) : (
                            <span className={`${base} ${isPublic ? 'bg-green-100 text-green-700 border-green-300' : 'bg-[var(--color-surface-sunken)] text-secondary border-[var(--color-border)]'}`}>
                                {isPublic ? '🌐 Public' : '🔒 Private'}
                            </span>
                        );
                    })()}
                    {canEdit(vehicle) && (
                        <button onClick={openEditVehicle} className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--color-surface-sunken)] text-secondary hover:bg-[var(--color-surface-muted)] transition">
                            Edit
                        </button>
                    )}
                    {canEdit(vehicle) ? (
                        <button onClick={() => setShowEditSpecs(true)} className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">
                            Specs
                        </button>
                    ) : vehicle.specs && Object.keys(vehicle.specs).length > 0 && (
                        <button onClick={() => setShowViewSpecs(true)} className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">
                            Specs
                        </button>
                    )}
                    {canEdit(vehicle) && (
                        <button
                            onClick={async () => { setDuplicatingVehicle(true); await onDuplicateVehicle(vehicle.id); setDuplicatingVehicle(false); }}
                            disabled={duplicatingVehicle}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50 flex items-center gap-1"
                        >
                            {duplicatingVehicle ? <><span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Copying…</> : '⧉ Copy'}
                        </button>
                    )}
                    {canDelete(vehicle) && (
                        <button
                            onClick={() => { if (window.confirm(`Delete "${vehicle.name}" and all its tests?`)) onDeleteVehicle(vehicle.id); }}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition"
                        >
                            Delete
                        </button>
                    )}
                </div>
            </div>

            <div className="admin-subtabs">
                {SUBTABS.map(t => {
                    const count = t.count?.({ displayRuns, inheritedRuns, vehicle, performanceCounts });
                    return (
                        <button
                            key={t.id}
                            className={`btn-subtab ${subtab === t.id ? 'active' : ''}`}
                            onClick={() => onSubtabChange(t.id)}
                        >
                            {t.label}
                            {count != null && <span className="text-xs text-secondary ml-1.5">{count}</span>}
                        </button>
                    );
                })}
            </div>

            {subtab === 'tests' && (<>
            <SectionHeader
                title="Charging & Range Tests"
                info={<InfoIcon text={TESTS_SECTION_HELP} position="right" className="ml-1" />}
                actions={canCreate && (
                    <SectionAction onClick={() => {
                        // Toggles, as it always has: a second click cancels
                        // rather than reopening a wizard that is already open.
                        if (showUpload && uploadMode === 'create') {
                            resetUploadState();
                        } else {
                            setUploadMode('create');
                            setMergeTargetRun(null);
                            setShowUpload(true);
                            setUploadStep('file');
                            setCsvData(null);
                            setFieldMapping({});
                        }
                    }}>
                        {showUpload && uploadMode === 'create' ? 'Cancel' : '+ Add new record'}
                    </SectionAction>
                )}
            />

            {showUpload && (
                <div className="card mb-6">
                    {/* ── Merge-mode banner ── */}
                    {uploadMode === 'merge' && mergeTargetRun && (
                        <div className="merge-target-banner">
                            <div>
                                <span className="text-sm font-semibold text-blue-800">Adding data to: </span>
                                <span className="text-sm text-blue-700">{mergeTargetRun.name}</span>
                            </div>
                            <button onClick={resetUploadState} className="text-blue-500 hover:text-blue-700 text-sm">
                                Cancel
                            </button>
                        </div>
                    )}

                    {uploadStep === 'file' && (
                        <div>
                            <h3 className="section-title mb-4">
                                {uploadMode === 'merge' ? 'Upload Additional Data' : 'Add new record'}
                            </h3>
                            <div className="space-y-4">
                                {/* Only show metadata inputs in create mode */}
                                {uploadMode === 'create' && (
                                    <>
                                        {/* Role — exactly one. A run is a charging test or a range test. */}
                                        <div>
                                            <p className="text-xs text-secondary mb-1">Data type</p>
                                            <div className="data-type-flags">
                                                {DATA_FLAGS.map(({ key, label, pillStyle, desc }) => {
                                                    const active = runMetadata.dataFlags.includes(key);
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            title={desc}
                                                            onClick={() => setRunMetadata(m => ({ ...m, dataFlags: [key] }))}
                                                            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${active ? pillStyle : 'bg-[var(--color-surface-sunken)] text-meta border-[var(--color-border)] hover:border-[var(--color-border)]'}`}
                                                        >
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Core metadata */}
                                        <input
                                            placeholder="Name (e.g., Highway Test - Winter 2024)"
                                            value={runMetadata.name}
                                            onChange={(e) => setRunMetadata({...runMetadata, name: e.target.value})}
                                            className="form-input form-input w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                        {/* Attribution belongs to the test, not to one of its roles.
                                            It used to be two fields inside the role panels — a
                                            charging URL and a range URL — because the schema had two
                                            columns. Migration 052 made it one. */}
                                        <input
                                            type="url"
                                            placeholder="Source URL (where this test was published)"
                                            value={runMetadata.sourceUrl}
                                            onChange={(e) => setRunMetadata({...runMetadata, sourceUrl: e.target.value})}
                                            className="form-input form-input w-full"
                                        />

                                        {/* Charging energy field (create mode) */}
                                        {runMetadata.dataFlags.includes('charging') && (
                                            <div className="data-subpanel p-3">
                                                <p className="text-sm font-semibold text-secondary mb-2">Charging Energy <span className="font-normal text-meta">(optional)</span></p>
                                                <input
                                                    type="number"
                                                    placeholder="Energy added (kWh)"
                                                    title="Energy measured at charger or vehicle — energy in"
                                                    value={runMetadata.chargeEnergyKwh}
                                                    onChange={(e) => setRunMetadata({...runMetadata, chargeEnergyKwh: e.target.value})}
                                                    className="form-input form-input w-full"
                                                />
                                                <p className="text-xs text-meta mt-1">
                                                    Energy measured at charger or vehicle — <em>energy in</em>
                                                </p>
                                            </div>
                                        )}

                                        {/* Range test fields */}
                                        {runMetadata.dataFlags.includes('range') && (
                                            <div className="data-subpanel p-4 space-y-3">
                                                <p className="text-sm font-semibold text-secondary">Range Test Details</p>
                                                <div className="form-grid gap-3">
                                                    <input
                                                        placeholder="Source (e.g., Out of Spec)"
                                                        value={runMetadata.source}
                                                        onChange={(e) => setRunMetadata({...runMetadata, source: e.target.value})}
                                                        className="form-input form-input col-span-2"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Start SoC (%)"
                                                        value={runMetadata.startSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, startSoc: e.target.value})}
                                                        className="form-input form-input"
                                                        min="0" max="100"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="End SoC (%)"
                                                        value={runMetadata.endSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, endSoc: e.target.value})}
                                                        className="form-input form-input"
                                                        min="0" max="100"
                                                    />
                                                    {runMetadata.startSoc !== '' && runMetadata.endSoc !== '' &&
                                                     parseFloat(runMetadata.startSoc) < parseFloat(runMetadata.endSoc) && (
                                                        <p className="col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                                            ⚠ Start SoC is lower than End SoC — for a range test the vehicle depletes, so Start should be higher (e.g. 95% → 5%). Did you swap them?
                                                        </p>
                                                    )}
                                                    <input
                                                        type="number"
                                                        placeholder="Speed (mph)"
                                                        value={runMetadata.speedMph}
                                                        onChange={(e) => setRunMetadata({...runMetadata, speedMph: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Distance (miles)"
                                                        value={runMetadata.distanceMiles}
                                                        onChange={(e) => setRunMetadata({...runMetadata, distanceMiles: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Energy consumed (kWh)"
                                                        title="Energy consumed on the drive — energy out"
                                                        value={runMetadata.energyKwh}
                                                        onChange={(e) => setRunMetadata({...runMetadata, energyKwh: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Ambient temp (°F)"
                                                        value={runMetadata.temperatureF}
                                                        onChange={(e) => setRunMetadata({...runMetadata, temperatureF: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <select
                                                        value={runMetadata.speedBasis || ''}
                                                        onChange={(e) => setRunMetadata({...runMetadata, speedBasis: e.target.value})}
                                                        className="form-input form-input"
                                                        title="Steady: the car was held at this speed. Mixed: this is an average over a varying-speed cycle, so speed correction is skipped — aero energy goes as the mean of v², not the square of the mean."
                                                    >
                                                        <option value="">Speed basis: unknown</option>
                                                        <option value="steady">Steady — held at setpoint</option>
                                                        <option value="mixed">Mixed cycle — average speed</option>
                                                    </select>
                                                    <input
                                                        type="number"
                                                        placeholder="Test altitude (ft)"
                                                        title="Elevation the test was run at — drives air density and so aero drag. Not the same as elevation gain."
                                                        value={runMetadata.altitudeFt}
                                                        onChange={(e) => setRunMetadata({...runMetadata, altitudeFt: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Elevation gain (ft)"
                                                        title="Net climb over the route — drives the potential-energy term. Not the same as test altitude."
                                                        value={runMetadata.elevationGainFt}
                                                        onChange={(e) => setRunMetadata({...runMetadata, elevationGainFt: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Avg wind speed (mph)"
                                                        value={runMetadata.windSpeedMph}
                                                        onChange={(e) => setRunMetadata({...runMetadata, windSpeedMph: e.target.value})}
                                                        className="form-input form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Wind dir. vs travel (0-360°)"
                                                        title="Direction relative to travel: 0° = tailwind, 180° = headwind, 90/270° = crosswind"
                                                        value={runMetadata.windDirectionDeg}
                                                        onChange={(e) => setRunMetadata({...runMetadata, windDirectionDeg: e.target.value})}
                                                        className="form-input form-input"
                                                        min="0" max="360"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div>
                                    <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer mb-2">
                                        <input
                                            type="checkbox"
                                            checked={noHeaders}
                                            onChange={e => {
                                                setNoHeaders(e.target.checked);
                                                setCsvData(null);
                                                setCsvText('');
                                                setFieldMapping({});
                                                setUploadStep('file');
                                            }}
                                            className="rounded"
                                        />
                                        CSV has no header row (use column numbers)
                                    </label>
                                    <div className="csv-drop-zone">
                                        <label className="cursor-pointer">
                                            <span className="text-blue-600 font-medium">Click to upload CSV file</span>
                                            <span className="block text-xs text-meta mt-1">Optional — attach data points to this record</span>
                                            <input
                                                type="file"
                                                accept=".csv"
                                                className="hidden"
                                                onChange={handleFileUpload}
                                            />
                                        </label>
                                    </div>
                                    <div className="mt-3">
                                        <p className="text-xs text-meta mb-1">Or paste CSV text directly:</p>
                                        <textarea
                                            rows={4}
                                            placeholder={"soc,chargeRate,time\n50,100,0\n80,75,15\n…"}
                                            value={csvText}
                                            onChange={e => handleCsvTextPaste(e.target.value)}
                                            className="form-input form-input w-full font-mono resize-y"
                                        />
                                    </div>
                                </div>
                                {uploadMode === 'create' && (
                                    <div className="form-actions">
                                        <button
                                            onClick={handleSaveRecord}
                                            disabled={!runMetadata.name}
                                            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Save record
                                        </button>
                                        <button onClick={resetUploadState} className="btn btn-secondary">
                                            Cancel
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {uploadStep === 'mapping' && (
                        <div>
                            <h3 className="section-title mb-4">Map CSV Fields</h3>
                            <p className="text-secondary mb-4">Match your CSV columns to standard fields. We've auto-detected some for you.</p>

                            {/* In create mode, allow editing metadata here too */}
                            {uploadMode === 'create' && (
                                <div className="mb-6 p-4 bg-[var(--color-surface-muted)] rounded">
                                    <h4 className="font-semibold mb-3">Test Metadata</h4>
                                    <div className="space-y-3">
                                        <input
                                            placeholder="Name (e.g., Highway Test - Winter 2024)"
                                            value={runMetadata.name}
                                            onChange={(e) => setRunMetadata({...runMetadata, name: e.target.value})}
                                            className="form-input form-input w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="form-input form-input w-full"
                                        />
                                    </div>
                                </div>
                            )}

                            <h4 className="font-semibold mb-3">Field Mapping</h4>
                            <div className="space-y-3">
                                {[
                                    ['soc',         'SoC (%)'],
                                    ['chargeRate',  'Charge Rate (kW)'],
                                    ['timestamp',   'Timestamp (wall clock)'],
                                    ['time',        'Elapsed Time (min/s)'],
                                    ['range',       'Range (mi/km)'],
                                    ['temperature', 'Temperature'],
                                    ['frame',       'Frame #'],
                                ].map(([field, label]) => (
                                    <div key={field} className="field-mapping-row">
                                        <label className="w-44 font-medium">{label}:</label>
                                        <select
                                            value={fieldMapping[field] || ''}
                                            onChange={(e) => setFieldMapping({...fieldMapping, [field]: e.target.value})}
                                            className="form-input form-input flex-1"
                                        >
                                            <option value="">-- Not mapped --</option>
                                            {availableFields.map((f, i) => (
                                                <option key={f} value={f}>
                                                    {noHeaders && f.startsWith('col_') ? `Column ${i + 1}` : f}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>

                            {/* Timestamp conversion notice */}
                            {(() => {
                                const tsMapped  = !!fieldMapping.timestamp;
                                const timeMapped = !!fieldMapping.time;
                                // Peek at first row to detect timestamp strings in the time column
                                const firstRow  = csvData?.data?.[0];
                                const timeColTs = timeMapped && firstRow &&
                                    isTimestampValue(firstRow[fieldMapping.time]);
                                if (!tsMapped && !timeColTs) return null;
                                return (
                                    <p className="mt-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                                        📅 Timestamps detected — will be converted to elapsed minutes from the first data point
                                        {tsMapped && !timeMapped && ' (Elapsed Time will be derived automatically)'}
                                    </p>
                                );
                            })()}

                            {/* ── Derived-column offers ── */}
                            {offerRangeEstimateTest && (
                                <div className="mt-5 space-y-3">
                                    {/* Measured range from test data */}
                                    {offerRangeEstimateTest && (
                                        <div className={`estimation-panel ${estimations.range === 'measured' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-semibold ${estimations.range === 'measured' ? 'text-green-800' : 'text-amber-800'}`}>
                                                    {estimations.range === 'measured' ? '✓ Range will be estimated (test data)' : '📏 Estimate from measured range test'}
                                                </p>
                                                {rangeTestRuns.length > 1 && (
                                                    <select
                                                        value={selectedRangeTestRunId ?? rangeTestRuns[0]?.id ?? ''}
                                                        onChange={e => setSelectedRangeTestRunId(Number(e.target.value))}
                                                        onClick={e => e.stopPropagation()}
                                                        className="form-input mt-1 p-1 w-full max-w-xs"
                                                    >
                                                        {rangeTestRuns.map(r => {
                                                            const hasSoc = r.start_soc != null && r.end_soc != null;
                                                            const socDelta = hasSoc ? Math.abs(r.start_soc - r.end_soc) : 100;
                                                            const eff = Math.round(r.distance_miles * 100 / socDelta);
                                                            return <option key={r.id} value={r.id}>{r.name} — {eff} mi effective{!hasSoc ? ' (est.)' : ''}</option>;
                                                        })}
                                                    </select>
                                                )}
                                                <p className={`text-xs mt-0.5 ${estimations.range === 'measured' ? 'text-green-700' : 'text-amber-700'}`}>
                                                    {estimations.range === 'measured'
                                                        ? `range = SoC% × ${effectiveRangeFromTest} mi (${selectedRangeTestRun?.name})`
                                                        : `${selectedRangeTestRun?.name}: ${selectedRangeTestRun?.distance_miles} mi @ ${selectedRangeTestRun?.start_soc}→${selectedRangeTestRun?.end_soc}% SoC → ${effectiveRangeFromTest} mi effective`}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setEstimations(prev => ({ ...prev, range: prev.range === 'measured' ? null : 'measured' }))}
                                                className={`shrink-0 text-xs px-3 py-1 rounded border transition-colors ${
                                                    estimations.range === 'measured'
                                                        ? 'bg-white text-green-700 border-green-300 hover:bg-green-100'
                                                        : 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
                                                }`}
                                            >
                                                {estimations.range === 'measured' ? 'Undo' : 'Use test data'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Join key selector — merge mode only */}
                            {uploadMode === 'merge' && (
                                <div className={`join-key-panel ${missingJoinKey ? 'bg-red-50 border-red-200' : showJoinSelector ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
                                    {missingJoinKey ? (
                                        <p className="text-sm font-semibold text-red-700">
                                            ⚠ Map at least one of <strong>SoC</strong> or <strong>Time</strong> — it's needed to link incoming rows to existing ones.
                                        </p>
                                    ) : showJoinSelector ? (
                                        <>
                                            <p className="text-sm font-semibold text-yellow-800 mb-2">
                                                Both SoC and Time are mapped — which should be used to link rows?
                                            </p>
                                            <div className="flex gap-6">
                                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                                    <input type="radio" name="joinKey" value="soc" checked={joinKey === 'soc'} onChange={() => setJoinKey('soc')} />
                                                    <span className="font-medium">SoC</span>
                                                    <span className="text-secondary">(charging curves, SoC-based data)</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                                    <input type="radio" name="joinKey" value="time" checked={joinKey === 'time'} onChange={() => setJoinKey('time')} />
                                                    <span className="font-medium">Time</span>
                                                    <span className="text-secondary">(time-series, e.g. Time+Power → Time+SoC)</span>
                                                </label>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-green-800">
                                            ✓ Rows will be linked by <strong>{canJoinBySoc ? 'SoC' : 'Time'}</strong>.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="form-actions mt-6">
                                <button
                                    onClick={() => setUploadStep('file')}
                                    className="btn btn-secondary"
                                >
                                    Back
                                </button>
                                {uploadMode === 'create' ? (
                                    <button
                                        onClick={handleImport}
                                        className="btn btn-primary"
                                    >
                                        Import Run
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleMerge}
                                        disabled={merging || missingJoinKey}
                                        className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {merging ? 'Merging…' : 'Merge into Run'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-4">
                {runGroups.map(group => {
                  const collapsed = collapsedSessions.has(String(group.key));
                  const session   = group.sessionId != null
                      ? (testSessions || []).find(x => String(x.id) === String(group.sessionId)) ?? null
                      : null;
                  return (
                    <div
                        key={group.key}
                        className={`session-group${session ? '' : ' is-unassigned'}${collapsed ? ' is-collapsed' : ''}`}
                    >
                    <SessionGroupHeader
                        session={session}
                        vehicle={vehicle}
                        vehicles={vehicles}
                        runsHere={group.runs.length}
                        collapsed={collapsed}
                        onToggle={() => toggleSessionGroup(group.key)}
                        onEdit={session && canEdit(vehicle) ? () => setEditingSessionId(session.id) : null}
                        onViewVehicle={onViewVehicle}
                    />
                    {!collapsed && (
                    <div className="session-group-body">
                    {group.runs.map(run => {
                  // Ensure vote data is loaded for this run (no-op if already loaded)
                  if (!runVotes[run.id]) loadRunVotes([run.id]);
                  const votes = runVotes[run.id] ?? { vouch: 0, flag: 0, myVote: null };
                  const isPending = pendingDeletes.has(run.id);
                  return (
                    <div
                        key={run.id}
                        className={`card${isPending ? ' opacity-60 border-2 border-red-200' : ''}`}
                    >
                        {editingRunId === run.id ? (
                            <div>
                                <h3 className="section-title mb-4">Edit Record</h3>
                                <div className="space-y-3">
                                    {/* Role — exactly one. A run is a charging test or a range test. */}
                                    <div>
                                        <p className="text-xs text-secondary mb-1">Data type</p>
                                        <div className="data-type-flags">
                                            {DATA_FLAGS.map(({ key, label, pillStyle, desc }) => {
                                                const active = (editFormData.dataFlags || ['charging']).includes(key);
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        title={desc}
                                                        onClick={() => setEditFormData(f => ({ ...f, dataFlags: [key] }))}
                                                        className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${active ? pillStyle : 'bg-[var(--color-surface-sunken)] text-meta border-[var(--color-border)] hover:border-[var(--color-border)]'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <input
                                        placeholder="Name"
                                        value={editFormData.name}
                                        onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                        className="form-input form-input w-full"
                                    />
                                    <input
                                        type="date"
                                        value={editFormData.date}
                                        onChange={(e) => setEditFormData({...editFormData, date: e.target.value})}
                                        className="form-input form-input w-full"
                                    />
                                    <input
                                        placeholder="Software Version"
                                        value={editFormData.softwareVersion}
                                        onChange={(e) => setEditFormData({...editFormData, softwareVersion: e.target.value})}
                                        className="form-input form-input w-full"
                                    />
                                    <input
                                        placeholder="Notes"
                                        value={editFormData.conditions}
                                        onChange={(e) => setEditFormData({...editFormData, conditions: e.target.value})}
                                        className="form-input form-input w-full"
                                    />
                                    {/* One field for both roles since migration 052 — see the
                                        matching note on the create form. */}
                                    <input
                                        type="url"
                                        placeholder="Source URL (where this test was published)"
                                        value={editFormData.sourceUrl ?? ''}
                                        onChange={(e) => setEditFormData({...editFormData, sourceUrl: e.target.value})}
                                        className="form-input form-input w-full"
                                    />
                                    {/* Range test fields */}
                                    {(editFormData.dataFlags || ['charging']).includes('range') && (
                                        <div className="data-subpanel p-4 space-y-3">
                                            <p className="text-sm font-semibold text-secondary">Range Test Details</p>
                                            <div className="form-grid gap-3">
                                                <input
                                                    placeholder="Source (e.g., Out of Spec)"
                                                    value={editFormData.source}
                                                    onChange={(e) => setEditFormData({...editFormData, source: e.target.value})}
                                                    className="form-input form-input col-span-2"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Start SoC (%)"
                                                    value={editFormData.startSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, startSoc: e.target.value})}
                                                    className="form-input form-input"
                                                    min="0" max="100"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="End SoC (%)"
                                                    value={editFormData.endSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, endSoc: e.target.value})}
                                                    className="form-input form-input"
                                                    min="0" max="100"
                                                />
                                                {editFormData.startSoc !== '' && editFormData.endSoc !== '' &&
                                                 parseFloat(editFormData.startSoc) < parseFloat(editFormData.endSoc) && (
                                                    <p className="col-span-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                                        ⚠ Start SoC is lower than End SoC — for a range test the vehicle depletes, so Start should be higher (e.g. 95% → 5%). Did you swap them?
                                                    </p>
                                                )}
                                                <input
                                                    type="number"
                                                    placeholder="Speed (mph)"
                                                    value={editFormData.speedMph}
                                                    onChange={(e) => setEditFormData({...editFormData, speedMph: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Distance (miles)"
                                                    value={editFormData.distanceMiles}
                                                    onChange={(e) => setEditFormData({...editFormData, distanceMiles: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Energy consumed (kWh)"
                                                    title="Energy consumed on the drive — energy out"
                                                    value={editFormData.energyKwh}
                                                    onChange={(e) => setEditFormData({...editFormData, energyKwh: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Ambient temp (°F)"
                                                    value={editFormData.temperatureF}
                                                    onChange={(e) => setEditFormData({...editFormData, temperatureF: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <select
                                                    value={editFormData.speedBasis || ''}
                                                    onChange={(e) => setEditFormData({...editFormData, speedBasis: e.target.value})}
                                                    className="form-input form-input"
                                                    title="Steady: the car was held at this speed. Mixed: this is an average over a varying-speed cycle, so speed correction is skipped — aero energy goes as the mean of v², not the square of the mean."
                                                >
                                                    <option value="">Speed basis: unknown</option>
                                                    <option value="steady">Steady — held at setpoint</option>
                                                    <option value="mixed">Mixed cycle — average speed</option>
                                                </select>
                                                <input
                                                    type="number"
                                                    placeholder="Test altitude (ft)"
                                                    title="Elevation the test was run at — drives air density and so aero drag. Not the same as elevation gain."
                                                    value={editFormData.altitudeFt}
                                                    onChange={(e) => setEditFormData({...editFormData, altitudeFt: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Elevation gain (ft)"
                                                    title="Net climb over the route — drives the potential-energy term. Not the same as test altitude."
                                                    value={editFormData.elevationGainFt}
                                                    onChange={(e) => setEditFormData({...editFormData, elevationGainFt: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Avg wind speed (mph)"
                                                    value={editFormData.windSpeedMph}
                                                    onChange={(e) => setEditFormData({...editFormData, windSpeedMph: e.target.value})}
                                                    className="form-input form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Wind dir. vs travel (0-360°)"
                                                    title="Direction relative to travel: 0° = tailwind, 180° = headwind, 90/270° = crosswind"
                                                    value={editFormData.windDirectionDeg}
                                                    onChange={(e) => setEditFormData({...editFormData, windDirectionDeg: e.target.value})}
                                                    className="form-input form-input"
                                                    min="0" max="360"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Charging energy field — shows energy_kwh for charging runs */}
                                    {(editFormData.dataFlags || ['charging']).includes('charging') && (
                                        <div className="data-subpanel p-3">
                                            <p className="text-sm font-semibold text-secondary mb-2">Charging Energy</p>
                                            <input
                                                type="number"
                                                placeholder="Energy added (kWh)"
                                                value={editFormData.chargeEnergyKwh}
                                                onChange={(e) => setEditFormData({...editFormData, chargeEnergyKwh: e.target.value})}
                                                className="form-input form-input w-full"
                                            />
                                            <p className="text-xs text-meta mt-1">
                                                Energy measured at charger or vehicle — <em>energy in</em> (not equal to energy used driving due to charging losses)
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <div className="form-actions mt-4">
                                    <button
                                        onClick={() => handleSaveEdit(run.id)}
                                        disabled={savingData}
                                        className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {savingData ? 'Saving…' : 'Save Changes'}
                                    </button>
                                    <button
                                        onClick={handleCancelEdit}
                                        disabled={savingData}
                                        className="btn btn-secondary disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                </div>

                                {/* Derive charging axis (time / SoC / power) from any two of the three */}
                                {canEdit(vehicle) && (editFormData.dataFlags || ['charging']).includes('charging') && (
                                    <div className="mt-4 border-t pt-3">
                                        <button
                                            type="button"
                                            onClick={() => handleToggleEstimatePanel(run.id)}
                                            className="text-sm text-secondary hover:text-[var(--color-text-primary)] flex items-center gap-1"
                                        >
                                            <span className="font-semibold">
                                                {showEstimatePanel ? '▴ Derive charging axis (time / SoC / power)' : '▾ Derive charging axis (time / SoC / power)'}
                                            </span>
                                        </button>
                                        {showEstimatePanel && (
                                            <DeriveAxisPanel
                                                vehicle={vehicle}
                                                editData={editData}
                                                editDataLoading={editDataLoading}
                                                mode={estimateMode}
                                                onChangeMode={handleSelectEstimateMode}
                                                calibrate={estimateCalibrate}
                                                onChangeCalibrate={handleToggleCalibrate}
                                                startSoc={estimateStartSoc}
                                                onChangeStartSoc={setEstimateStartSoc}
                                                chargingLoss={estimateLoss}
                                                onChangeChargingLoss={setEstimateLoss}
                                                anchors={estimateAnchors}
                                                onChangeAnchors={setEstimateAnchors}
                                                shiftToZero={estimateShift}
                                                onShiftToZeroChange={setEstimateShift}
                                                preview={estimatePreview}
                                                applying={estimateApplying}
                                                error={estimateError}
                                                onPreview={handleEstimatePreview}
                                                onApply={() => handleEstimateApply(run)}
                                            />
                                        )}
                                    </div>
                                )}

                                {/* ── Data table toggle ── */}
                                <div className="mt-4 border-t pt-3">
                                    <button
                                        onClick={() => handleToggleDataTable(run.id)}
                                        className="text-sm text-secondary hover:text-[var(--color-text-primary)] flex items-center gap-1"
                                    >
                                        <span className="font-semibold">{showDataTable ? '▴ Hide data' : '▾ Show data'}</span>
                                        {editData !== null && !editDataLoading && (
                                            <span className="text-xs text-meta">({editData.length} rows)</span>
                                        )}
                                        {editDataDirty && (
                                            <span className="ml-1 text-xs text-orange-500 font-medium">● unsaved changes</span>
                                        )}
                                    </button>

                                    {showDataTable && (
                                        <div className="mt-3">
                                            {/* Range estimation offer — shown when range is absent but SoC exists */}
                                            {(() => {
                                                const epaRange = vehicle?.range ? parseFloat(vehicle.range) : null;
                                                const hasAnyOption = effectiveRangeFromTest || epaRange;
                                                if (!canEdit(vehicle) || editDataLoading || editData === null) return null;
                                                if (!editData.some(r => r.soc != null)) return null;
                                                if (!editData.every(r => r.range == null)) return null;
                                                if (!hasAnyOption) return null;
                                                return (
                                                    <div className="mb-3 p-3 rounded-lg border bg-blue-50 border-blue-200">
                                                        <p className="text-xs text-blue-800 font-semibold mb-2">ℹ No range data — estimate from SoC%:</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {effectiveRangeFromTest && (() => {
                                                                const hasSocMeta = selectedRangeTestRun?.start_soc != null && selectedRangeTestRun?.end_soc != null;
                                                                const tip = hasSocMeta
                                                                    ? `From: ${selectedRangeTestRun?.name} — ${selectedRangeTestRun?.distance_miles} mi @ ${selectedRangeTestRun?.start_soc}→${selectedRangeTestRun?.end_soc}% SoC`
                                                                    : `From: ${selectedRangeTestRun?.name} — ${selectedRangeTestRun?.distance_miles} mi (no SoC metadata; assuming 0→100%)`;
                                                                return (
                                                                    <button
                                                                        onClick={() => handleEstimateRangeInEdit(effectiveRangeFromTest)}
                                                                        className="text-xs px-3 py-1 rounded border bg-amber-600 text-white border-amber-600 hover:bg-amber-700 transition-colors"
                                                                        title={tip}
                                                                    >
                                                                        Measured ({effectiveRangeFromTest} mi / 100%){!hasSocMeta && ' *'}
                                                                    </button>
                                                                );
                                                            })()}
                                                            {epaRange && (
                                                                <button
                                                                    onClick={() => handleEstimateRangeInEdit(epaRange)}
                                                                    className="text-xs px-3 py-1 rounded border bg-blue-600 text-white border-blue-600 hover:bg-blue-700 transition-colors"
                                                                    title={`Use vehicle's EPA-rated range (${epaRange} mi) as the 100% SoC baseline`}
                                                                >
                                                                    EPA ({epaRange} mi)
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            {/* Energy sanity — charging runs only, once data is loaded.
                                                Entered "energy added" is charger-side; it should exceed the
                                                SoC-implied pack energy (ΔSoC × capacity) by the charging loss.
                                                Green when that excess is 0 to +10% of capacity. */}
                                            {!editDataLoading && editData != null && (editFormData.dataFlags || ['charging']).includes('charging') && (() => {
                                                const cap    = vehicle?.battery ? Number(vehicle.battery) : null;
                                                const manual = editFormData.chargeEnergyKwh !== '' ? parseFloat(editFormData.chargeEnergyKwh) : NaN;
                                                const hasManual = !isNaN(manual) && manual > 0;
                                                const socs   = (editData || []).filter(r => r.soc != null).map(r => Number(r.soc));
                                                const dSoC   = socs.length >= 2 ? Math.max(...socs) - Math.min(...socs) : null;
                                                const packE  = (cap && dSoC != null) ? roundTo(cap * dSoC / 100, 1) : null;
                                                const excess = (cap && packE != null && hasManual) ? (manual - packE) / cap * 100 : null;
                                                const good   = excess != null && excess >= 0 && excess <= 10;
                                                const tone   = excess == null ? 'bg-[var(--color-surface-muted)] border-[var(--color-border)]'
                                                             : good ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200';
                                                return (
                                                    <div className={`mb-3 p-3 rounded-lg border flex flex-wrap items-center gap-3 ${tone}`}>
                                                        <span className="text-xs text-secondary">
                                                            {editCalcKwh != null && <>⚡ <strong>Data points → {editCalcKwh} kWh</strong> · </>}
                                                            {packE != null
                                                                ? <>pack ≈ {packE} kWh <span className="text-secondary">({dSoC}% × {cap} kWh)</span></>
                                                                : <span className="text-secondary">add SoC data + battery capacity to validate energy</span>}
                                                            {hasManual && <span className="text-secondary"> · entered {manual} kWh</span>}
                                                        </span>
                                                        {excess != null && good && (
                                                            <span className="text-xs bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 rounded-full font-medium">
                                                                ✓ +{excess.toFixed(1)}% vs pack (within losses)
                                                            </span>
                                                        )}
                                                        {excess != null && !good && (
                                                            <span className="text-xs bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full font-medium">
                                                                ⚠️ {excess >= 0 ? '+' : ''}{excess.toFixed(1)}% vs pack {excess < 0 ? '(below SoC-implied)' : '(>10% of capacity)'}
                                                            </span>
                                                        )}
                                                        {packE != null && !hasManual && (
                                                            <span className="text-xs text-meta">Enter energy added above to validate</span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                            {editDataLoading ? (
                                                <p className="text-sm text-secondary py-4 text-center">Loading…</p>
                                            ) : (
                                                <>
                                                    <div className="overflow-auto rounded border" style={{ maxHeight: 360 }}>
                                                        <table className="w-full text-xs border-collapse">
                                                            <thead className="bg-[var(--color-surface-muted)] sticky top-0 z-10 border-b">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 text-left text-secondary font-medium w-8">#</th>
                                                                    {/* Read-only timestamp column — only rendered when data has timestamps */}
                                                                    {editData?.some(r => r.timestamp != null) && (
                                                                        <th className="px-2 py-1.5 text-left text-secondary font-medium whitespace-nowrap">
                                                                            Timestamp
                                                                        </th>
                                                                    )}
                                                                    {[['soc','SoC (%)'],['chargeRate','kW'],['time','Time'],['range','Range'],['temperature','Temp']].map(([field, label]) => {
                                                                        const isEst      = editCalculatedFields.includes(field);
                                                                        const isActive   = sortField === field;
                                                                        const indicator  = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                                                                        return (
                                                                        <th key={field} className="px-2 py-1.5 text-left text-secondary font-medium">
                                                                            <div className="flex flex-col gap-0.5">
                                                                                <button
                                                                                    onClick={() => handleSortByField(field)}
                                                                                    title={`Sort by ${label}`}
                                                                                    className={`text-left hover:text-[var(--color-text-primary)] transition-colors ${isActive ? 'text-blue-600 font-semibold' : ''}`}
                                                                                >
                                                                                    {label}{indicator}
                                                                                </button>
                                                                                <div className="flex items-center gap-1">
                                                                                    <button
                                                                                        onClick={() => setEditCalculatedFields(prev =>
                                                                                            isEst
                                                                                                ? prev.filter(f => f !== field)
                                                                                                : [...prev, field]
                                                                                        )}
                                                                                        title={isEst ? 'Estimated — click to mark as actual' : 'Actual — click to mark as estimated'}
                                                                                        className={`text-[10px] font-normal rounded px-1 leading-tight w-fit transition-colors ${
                                                                                            isEst
                                                                                                ? 'text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100'
                                                                                                : 'text-green-700 bg-green-50 border border-green-200 hover:bg-green-100'
                                                                                        }`}
                                                                                    >
                                                                                        {isEst ? '~est' : 'act'}
                                                                                    </button>
                                                                                    {canEdit(vehicle) && editData?.some(r => r[field] != null) && (
                                                                                        <button
                                                                                            onClick={() => handleClearColumn(field)}
                                                                                            title={`Clear all ${label} values`}
                                                                                            className="text-[10px] font-normal rounded px-1 leading-tight w-fit text-meta border border-transparent hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
                                                                                        >
                                                                                            ×clr
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </th>
                                                                        );
                                                                    })}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(editData || []).map((row, i) => (
                                                                    <tr key={i} className={`border-t ${i % 2 !== 0 ? 'bg-[var(--color-surface-muted)]' : ''}`}>
                                                                        {/* Row # + delete button share the first cell */}
                                                                        <td className="px-1 py-0.5 text-meta select-none whitespace-nowrap">
                                                                            <div className="flex items-center gap-1">
                                                                                {canEdit(vehicle) && (
                                                                                    <button
                                                                                        onClick={() => handleDeleteDataRow(i)}
                                                                                        className="w-5 h-5 flex items-center justify-center rounded text-meta hover:text-red-500 hover:bg-red-50 transition-colors leading-none flex-shrink-0"
                                                                                        title="Remove row"
                                                                                    >×</button>
                                                                                )}
                                                                                <span className="text-[11px]">{i + 1}</span>
                                                                            </div>
                                                                        </td>
                                                                        {/* Timestamp cell — read-only, only rendered when column is visible */}
                                                                        {editData?.some(r => r.timestamp != null) && (
                                                                            <td className="px-2 py-0.5 text-secondary whitespace-nowrap text-[11px] font-mono select-all">
                                                                                {row.timestamp
                                                                                    ? new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                                                                    : <span className="text-meta">—</span>}
                                                                            </td>
                                                                        )}
                                                                        {['soc','chargeRate','time','range','temperature'].map(field => (
                                                                            <td key={field} className="px-1 py-0.5">
                                                                                <input
                                                                                    type="number"
                                                                                    disabled={!canEdit(vehicle)}
                                                                                    value={row[field] ?? ''}
                                                                                    onChange={e => handleEditDataCell(i, field, e.target.value)}
                                                                                    placeholder="—"
                                                                                    className="form-input data-cell-input"
                                                                                />
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    {canEdit(vehicle) && (
                                                        <button
                                                            onClick={handleAddDataRow}
                                                            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                                                        >
                                                            + Add row
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <RunCard
                                run={run}
                                votes={votes}
                                isPending={isPending}
                                vehicle={vehicle}
                                vehicles={vehicles}
                                units={units}
                                socRange={socRanges[run.id]}
                                testSessions={testSessions}
                                copyTargetVehicles={copyTargetVehicles}
                                calcKwhByRun={calcKwhByRun}
                                canEdit={canEdit}
                                canCreate={canCreate}
                                isContributor={isContributor}
                                openMenuRunId={openMenuRunId}
                                setOpenMenuRunId={setOpenMenuRunId}
                                exportingRunId={exportingRunId}
                                duplicatingRunId={duplicatingRunId}
                                toggleRunVote={toggleRunVote}
                                setRunsSession={setRunsSession}
                                createTestSession={createTestSession}
                                updateTestSession={updateTestSession}
                                deleteTestSession={deleteTestSession}
                                setPairedChargingRun={setPairedChargingRun}
                                clearDefaultRun={clearDefaultRun}
                                onSetDefaultRun={onSetDefaultRun}
                                handleEditRun={handleEditRun}
                                restoreItem={restoreItem}
                                queueDelete={queueDelete}
                                handleExportCsv={handleExportCsv}
                                handleDuplicateRun={handleDuplicateRun}
                                setCopyToRun={setCopyToRun}
                                setCopyingToVehicleId={setCopyingToVehicleId}
                                handleUpdateData={handleUpdateData}
                                onUpdateRun={onUpdateRun}
                                handleCheckKwh={handleCheckKwh}
                            />
                        )}
                    </div>
                  );
                    })}
                    </div>
                    )}
                    </div>
                  );
                })}
            </div>

            {editingSessionId != null && (
                <SessionEditModal
                    session={(testSessions || []).find(x => String(x.id) === String(editingSessionId))}
                    vehicles={vehicles}
                    onSave={updateTestSession}
                    onDelete={deleteTestSession}
                    onClose={() => setEditingSessionId(null)}
                />
            )}

            {displayRuns.length === 0 && !showUpload && (
                <div className="empty-state">
                    <p className="text-lg">No tests yet. Add a record to get started!</p>
                </div>
            )}
            </>)}

            {/* ── Inherited Tests ───────────────────────────────────────────── */}
            {/* A tab that renders nothing reads as broken rather than empty. */}
            {subtab === 'inherited' && (
                <div className="mt-6">
                    <SectionHeader
                        title="Inherited Tests"
                        info={<InfoIcon text={INHERITED_SECTION_HELP} position="right" className="ml-1" />}
                        actions={isContributor && canEdit(vehicle) && !showAddLink && (
                            <SectionAction onClick={() => setShowAddLink(true)}>
                                + Add Inherited Link
                            </SectionAction>
                        )}
                    />
                </div>
            )}
            {subtab === 'inherited' && inheritedRuns.length === 0 && !(isContributor && canEdit(vehicle)) && (
                <div className="empty-state">
                    <p className="text-lg">No inherited tests.</p>
                    <p className="text-sm text-secondary mt-1">
                        A vehicle can borrow another's tests when they share a battery or a body — sign in as a contributor to link some.
                    </p>
                </div>
            )}
            {subtab === 'inherited' && (inheritedRuns.length > 0 || (isContributor && canEdit(vehicle))) && (
                <div className="mt-6">

                    {/* Existing inherited runs */}
                    {inheritedRuns.length > 0 && (
                        <div className="space-y-2 mb-3">
                            {inheritedRuns.map(run => {
                                const srcName = run._sourceVehicleName || `Vehicle #${run._sourceVehicleId}`;
                                // The vehicle OBJECT, so the name can be a link.
                                // Absent when the source is not in the loaded
                                // list, and VehicleLink falls back to text.
                                const srcVehicle = (vehicles || [])
                                    .find(v => String(v.id) === String(run._sourceVehicleId));
                                const linkId = run._specLinkId;
                                const isChargingLink = runKindFrom(run) === 'charging';
                                const runColor = run.color || '#9ca3af';

                                // Both knobs, saved the same way. `edits` holds the in-progress
                                // string so a half-typed "1." is not parsed and written.
                                const eff = run._efficiencyFactor;
                                const cap = run._capacityFactor;
                                const factors = [
                                    {
                                        key: 'capacity', label: 'Capacity', stored: cap,
                                        edits: capacityEdits, setEdits: setCapacityEdits,
                                        field: 'capacityFactor',
                                        title: isChargingLink
                                            ? `${CAPACITY_HELP} ${CHARGING_SCALE_WARNING}`
                                            : CAPACITY_HELP,
                                    },
                                    {
                                        key: 'efficiency', label: 'Efficiency', stored: eff,
                                        edits: efficiencyEdits, setEdits: setEfficiencyEdits,
                                        field: 'efficiencyFactor',
                                        title: isChargingLink
                                            ? `${EFFICIENCY_HELP} ${EFFICIENCY_ON_CHARGING}`
                                            : EFFICIENCY_HELP,
                                    },
                                ];
                                const saveFactor = async (f, raw) => {
                                    const next = raw === '' ? null : parseFloat(raw);
                                    if (next === (f.stored ?? null)) return;
                                    try {
                                        await updateSpecLink(linkId, { [f.field]: next });
                                        f.setEdits(prev => { const n = { ...prev }; delete n[linkId]; return n; });
                                    } catch (_) { /* error shown by context */ }
                                };
                                return (
                                    <div key={run.id} className="card border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                                        <div className="run-card-header">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <RunKindPill run={run} />
                                                    <h3 className="section-title">
                                                        {run.name}
                                                        <RunSourceLinks run={run} className="text-sm font-normal" />
                                                    </h3>
                                                    {run.isDefault && (
                                                        <span className="text-xs px-2 py-1 rounded font-semibold" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}>Default</span>
                                                    )}
                                                    <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5">Estimated</span>
                                                </div>
                                                <div className="run-meta">
                                                    {/* The source is the one thing on this card you
                                                        cannot act on from here: the run is read-only,
                                                        its data lives on another vehicle, and every
                                                        question about it — is the factor right, what
                                                        did the original actually measure — is answered
                                                        over there. Landing on Charging & Range rather
                                                        than the tab you left, because the source OWNS
                                                        this run and would not list it under Inherited. */}
                                                    <p className="text-secondary">Inherited from:{' '}
                                                        <VehicleLink
                                                            vehicle={srcVehicle}
                                                            name={srcName}
                                                            onView={(v) => { onViewVehicle?.(v); onSubtabChange?.('tests'); }}
                                                            className="font-medium text-secondary"
                                                            title={`View ${srcName} tests & data`}
                                                        />
                                                    </p>
                                                    <p>Date: {run.date}</p>
                                                    {(run.softwareVersion || run.software_version) && <p>Software: {run.softwareVersion || run.software_version}</p>}
                                                    {run.conditions && <p>Notes: {run.conditions}</p>}
                                                    <RunSpecRows run={run} units={units} fieldMeta={FIELD_META} />
                                                </div>
                                            </div>
                                            <div className="run-actions">
                                                {/* Row 1: Default | Remove */}
                                                <div className="run-actions-row">
                                                    {isContributor && canEdit(vehicle) ? (
                                                        <button
                                                            onClick={() => run.isDefault
                                                                ? updateSpecLink(linkId, { useAsDefault: false })
                                                                : updateSpecLink(linkId, { useAsDefault: true }, vehicle.id)
                                                            }
                                                            title={run.isDefault ? 'Click to clear default' : 'Set as default for charts'}
                                                            className={`btn btn-toggle${run.isDefault ? ' active' : ''}`}
                                                        >
                                                            {run.isDefault ? <>Default <span className="btn-toggle-clear">×</span></> : 'Set as Default'}
                                                        </button>
                                                    ) : run.isDefault ? (
                                                        <span className="btn btn-toggle active">Default</span>
                                                    ) : null}
                                                    {isContributor && canEdit(vehicle) && (
                                                        <button
                                                            onClick={() => deleteSpecLink(linkId)}
                                                            className="btn btn-danger text-sm"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Row 2: Color Picker | Scale × */}
                                                <div className="run-actions-row flex-wrap">
                                                    <label className="flex items-center gap-1 text-xs text-secondary">
                                                        <input
                                                            type="color"
                                                            value={runColor}
                                                            onChange={e => updateRunColor(vehicle.id, run.id, e.target.value)}
                                                            className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                                                            title="Change color"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={runColor}
                                                            onChange={e => updateRunColor(vehicle.id, run.id, e.target.value)}
                                                            onBlur={e => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) updateRunColor(vehicle.id, run.id, runColor); }}
                                                            className="form-input w-20 .5 font-mono text-secondary"
                                                            placeholder="#9ca3af"
                                                            maxLength={7}
                                                        />
                                                    </label>
                                                    {factors.map(f => (isContributor && canEdit(vehicle) ? (
                                                        <FactorInput
                                                            key={f.key}
                                                            label={f.label}
                                                            title={f.title}
                                                            value={f.edits[linkId] ?? (f.stored != null ? String(f.stored) : '')}
                                                            onChange={v => f.setEdits(prev => ({ ...prev, [linkId]: v }))}
                                                            onCommit={() => saveFactor(f, f.edits[linkId] ?? (f.stored != null ? String(f.stored) : ''))}
                                                        />
                                                    ) : (
                                                        f.stored !== 1 && f.stored != null && (
                                                            <span key={f.key} className="text-xs font-mono text-secondary" title={f.title}>
                                                                {f.label.toLowerCase()} ×{f.stored}
                                                            </span>
                                                        )
                                                    )))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add link form */}
                    {showAddLink && (() => {
                        // Run IDs already linked to this vehicle
                        const alreadyLinkedRunIds = new Set(
                            (vehicle.spec_links || []).map(l => Number(l.source_run_id))
                        );
                        // Source vehicles: any vehicle with at least one non-inherited, not-yet-linked run
                        const sourceVehicles = (vehicles || [])
                            .filter(v =>
                                Number(v.id) !== Number(vehicle.id) &&
                                (v.runs || []).some(r => !r._inherited && !alreadyLinkedRunIds.has(Number(r.id)))
                            )
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                        const selectedSrc = newLinkSourceId
                            ? (vehicles || []).find(v => Number(v.id) === parseInt(newLinkSourceId, 10))
                            : null;
                        const candidates = selectedSrc
                            ? linkableRuns(selectedSrc, alreadyLinkedRunIds, newLinkKind)
                            : [];
                        const counts = selectedSrc ? linkableCounts(selectedSrc, alreadyLinkedRunIds) : { all: 0, charging: 0, range: 0 };
                        // null means "everything matching the filter", so the
                        // default behaviour is unchanged until a box is unticked.
                        const isPicked = (id) => newLinkRunIds === null || newLinkRunIds.includes(Number(id));
                        const runsToLink = candidates.filter(r => isPicked(r.id));
                        const togglePick = (id) => setNewLinkRunIds(prev => {
                            const base = prev === null ? candidates.map(r => Number(r.id)) : prev;
                            const n = Number(id);
                            return base.includes(n) ? base.filter(x => x !== n) : [...base, n];
                        });

                        // Capacity is a ratio of two recorded packs, so it can be
                        // offered outright. Blank when either vehicle has no
                        // battery figure — a silent 1.0 would be indistinguishable
                        // from "same pack".
                        const capacityRatio = (() => {
                            const src = packKwh(selectedSrc, vehicles);
                            const tgt = packKwh(vehicle, vehicles);
                            return src && tgt ? tgt / src : null;
                        })();
                        const suggestCapacity = () => {
                            if (capacityRatio) setNewLinkCapacity(capacityRatio.toFixed(3));
                        };

                        // EPA range ratio is capacity × efficiency, so the capacity
                        // already accounted for has to come back out before this
                        // fills the efficiency box. Filling the whole ratio here is
                        // the bug #185 flagged: on a Standard/Long Range pair, where
                        // the extra range is only a bigger pack, it silently scaled
                        // inherited EFFICIENCY by the capacity ratio too.
                        const suggestEfficiency = () => {
                            if (!selectedSrc) return;
                            const srcRange = parseFloat(selectedSrc.range);
                            const tgtRange = parseFloat(vehicle.range);
                            if (!srcRange || !tgtRange) return;
                            const entered = parseFloat(newLinkCapacity);
                            const cap = entered > 0 ? entered : (capacityRatio ?? 1);
                            setNewLinkEfficiency(((tgtRange / srcRange) / cap).toFixed(3));
                        };

                        const handleAdd = async () => {
                            if (!newLinkSourceId || runsToLink.length === 0) return;
                            setLinkSaving(true);
                            try {
                                for (const run of runsToLink) {
                                    await addSpecLink({
                                        targetVehicleId: vehicle.id,
                                        sourceRunId: run.id,
                                        efficiencyFactor: newLinkEfficiency ? parseFloat(newLinkEfficiency) : null,
                                        capacityFactor:   newLinkCapacity   ? parseFloat(newLinkCapacity)   : null,
                                        notes: newLinkNotes.trim() || null,
                                    });
                                }
                                setNewLinkSourceId('');
                                setNewLinkEfficiency('');
                                setNewLinkCapacity('');
                                setNewLinkNotes('');
                                setNewLinkKind('all');
                                setNewLinkRunIds(null);
                                setShowAddLink(false);
                            } finally {
                                setLinkSaving(false);
                            }
                        };

                        return (
                            <div className="spec-link-add-form">
                                <div className="flex gap-2 flex-wrap">
                                    <select
                                        value={newLinkSourceId}
                                        onChange={e => { setNewLinkSourceId(e.target.value); setNewLinkEfficiency(''); setNewLinkCapacity(''); setNewLinkRunIds(null); setNewLinkKind('all'); }}
                                        className="form-input form-input flex-1 min-w-48"
                                    >
                                        <option value="">Source vehicle…</option>
                                        {sourceVehicles.map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                </div>
                                {sourceVehicles.length === 0 && (
                                    <p className="text-xs text-meta mt-1">
                                        No other vehicles have unlinked tests.
                                    </p>
                                )}
                                {selectedSrc && runsToLink.length === 0 && (
                                    <p className="text-xs text-meta mt-1">
                                        All tests from {selectedSrc.name} are already linked.
                                    </p>
                                )}
                                {selectedSrc && counts.all > 0 && (
                                    <div className="spec-link-picker">
                                        {/* Kind first: it answers the question the
                                            curator actually has — does this trim
                                            share the battery, or the body? */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-label">Inherit:</span>
                                            {[
                                                { key: 'all',      label: `All (${counts.all})` },
                                                { key: 'charging', label: `Charging only (${counts.charging})` },
                                                { key: 'range',    label: `Range only (${counts.range})` },
                                            ].map(opt => (
                                                <button
                                                    key={opt.key}
                                                    type="button"
                                                    onClick={() => { setNewLinkKind(opt.key); setNewLinkRunIds(null); }}
                                                    className={`btn text-xs ${newLinkKind === opt.key ? 'btn-primary' : 'btn-secondary'}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                            <span className="text-meta text-xs select-none">·</span>
                                            <button type="button" className="run-bulk-link"
                                                onClick={() => setNewLinkRunIds(null)}>all</button>
                                            <span className="text-meta text-xs select-none">/</span>
                                            <button type="button" className="run-bulk-link"
                                                onClick={() => setNewLinkRunIds([])}>none</button>
                                        </div>

                                        {candidates.length === 0 ? (
                                            <p className="text-xs text-meta mt-1 italic">
                                                No {newLinkKind === 'all' ? '' : `${newLinkKind} `}tests left to link from {selectedSrc.name}.
                                            </p>
                                        ) : (
                                            <div className="spec-link-run-list">
                                                {candidates.map(r => (
                                                    <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={isPicked(r.id)}
                                                            onChange={() => togglePick(r.id)}
                                                            className="w-4 h-4 shrink-0"
                                                        />
                                                        <span className={`spec-link-kind-pill is-${runKindFrom(r)}`}>
                                                            {runKindFrom(r) === 'charging' ? '⚡' : '📏'}
                                                        </span>
                                                        <span className="truncate">{r.name}</span>
                                                        {r.date && <span className="text-xs text-meta shrink-0">{r.date}</span>}
                                                    </label>
                                                ))}
                                            </div>
                                        )}

                                        <p className="text-xs text-secondary mt-1">
                                            {runsToLink.length === 0
                                                ? 'Nothing selected — pick at least one test.'
                                                : `Will link ${runsToLink.length} test${runsToLink.length !== 1 ? 's' : ''}.`}
                                        </p>
                                    </div>
                                )}
                                <div className="flex gap-2 mt-2 flex-wrap items-center">
                                    <input
                                        type="number"
                                        placeholder="Capacity (blank = 1.0)"
                                        value={newLinkCapacity}
                                        onChange={e => setNewLinkCapacity(e.target.value)}
                                        step="0.001"
                                        min="0.001"
                                        className="form-input form-input w-44"
                                        title={runsToLink.some(r => runKindFrom(r) === 'charging')
                                            ? `${CAPACITY_HELP} ${CHARGING_SCALE_WARNING}`
                                            : CAPACITY_HELP}
                                    />
                                    <button
                                        type="button"
                                        onClick={suggestCapacity}
                                        disabled={!capacityRatio}
                                        className="btn btn-secondary text-xs whitespace-nowrap disabled:opacity-40"
                                        title={capacityRatio
                                            ? `Fill from the two battery specs (${capacityRatio.toFixed(3)}×)`
                                            : 'Needs a battery figure on both vehicles'}
                                    >
                                        From battery
                                    </button>
                                    <input
                                        type="number"
                                        placeholder="Efficiency (blank = 1.0)"
                                        value={newLinkEfficiency}
                                        onChange={e => setNewLinkEfficiency(e.target.value)}
                                        step="0.001"
                                        min="0.001"
                                        className="form-input form-input w-44"
                                        title={EFFICIENCY_HELP}
                                    />
                                    <button
                                        type="button"
                                        onClick={suggestEfficiency}
                                        disabled={!selectedSrc}
                                        className="btn btn-secondary text-xs whitespace-nowrap disabled:opacity-40"
                                        title="Fill from the EPA range ratio, divided by the capacity above — what is left once the bigger pack is accounted for"
                                    >
                                        From EPA
                                    </button>
                                    <input
                                        type="text"
                                        placeholder="Notes (optional)"
                                        value={newLinkNotes}
                                        onChange={e => setNewLinkNotes(e.target.value)}
                                        className="form-input form-input flex-1 min-w-40"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAdd}
                                        disabled={!newLinkSourceId || runsToLink.length === 0 || linkSaving}
                                        className="btn btn-primary text-sm disabled:opacity-40"
                                    >
                                        {linkSaving ? 'Linking…' : `Link ${runsToLink.length > 0 ? runsToLink.length + ' ' : ''}Test${runsToLink.length !== 1 ? 's' : ''}`}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setShowAddLink(false); setNewLinkSourceId(''); setNewLinkEfficiency(''); setNewLinkCapacity(''); setNewLinkNotes(''); }}
                                        className="btn btn-secondary text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            <DeleteQueueBar
                pendingCount={pendingDeletes.size}
                onClearQueue={clearQueue}
                onCommit={commitDeletes}
                undoState={undoState}
                secondsLeft={secondsLeft}
                onUndo={undoDelete}
                noun="test"
            />

            {/* Edit Specs modal (contributors/owners) */}
            {showEditSpecs && (
                <EditSpecsForm
                    vehicle={vehicle}
                    specCustomFieldSuggestions={specCustomFieldSuggestions}
                    onSave={onUpdateVehicleSpecs}
                    onClose={() => setShowEditSpecs(false)}
                />
            )}

            {/* View Specs modal (read-only, all users) */}
            {showViewSpecs && (
                <ViewSpecsModal
                    vehicle={vehicle}
                    onClose={() => setShowViewSpecs(false)}
                />
            )}

            {/* Edit vehicle modal */}
            {showEditVehicle && (
                <div className="modal-overlay" onClick={closeEditVehicle}>
                    <div className="modal-panel rounded-xl shadow-2xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <LazyBoundary>
                            <EditVehicleForm
                                formData={vehicleFormData}
                                onFormChange={setVehicleFormData}
                                editingId={vehicle.id}
                                formTags={vehicleFormTags}
                                onAddTag={(tag) => { if (!vehicleFormTags.some(t => t.id === tag.id)) setVehicleFormTags(prev => [...prev, tag]); }}
                                onRemoveTag={(tagId) => setVehicleFormTags(prev => prev.filter(t => t.id !== tagId))}
                                newTagName={vehicleNewTagName}
                                onNewTagNameChange={setVehicleNewTagName}
                                onCreateTag={async () => {
                                    const trimmed = vehicleNewTagName.trim();
                                    if (!trimmed) return;
                                    const existing = (tags || []).find(t => t.name.toLowerCase() === trimmed.toLowerCase());
                                    const tag = existing || await onCreateTag(trimmed);
                                    if (tag && !vehicleFormTags.some(t => t.id === tag.id)) setVehicleFormTags(prev => [...prev, tag]);
                                    setVehicleNewTagName('');
                                }}
                                tags={tags || []}
                                availableTagsForForm={vehicleAvailableTags}
                                editingVehicle={vehicle}
                                imageUploading={vehicleImageUploading}
                                onImageReady={handleVehicleImageReady}
                                onSubmit={handleVehicleSubmit}
                                onCancel={closeEditVehicle}
                                manufacturers={manufacturers}
                                onAddManufacturer={addManufacturer}
                            />
                        </LazyBoundary>
                    </div>
                </div>
            )}

            {/* Copy to vehicle modal */}
            {copyToRun && (
                <div className="modal-overlay">
                    <div className="copy-to-modal-panel">
                        <div className="modal-header px-5 py-4 border-b">
                            <h3 className="font-semibold text-base">Copy test to another vehicle</h3>
                            <p className="text-xs text-secondary mt-0.5">"{copyToRun.name}" will be copied as an independent run</p>
                        </div>
                        <div className="px-5 py-4">
                            <label className="block text-sm font-medium mb-2">Select destination vehicle</label>
                            <select
                                value={copyingToVehicleId}
                                onChange={e => setCopyingToVehicleId(e.target.value)}
                                className="form-input form-input w-full"
                            >
                                <option value="" disabled>Choose a vehicle…</option>
                                {copyTargetVehicles.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="px-5 py-4 border-t flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setCopyToRun(null); setCopyingToVehicleId(''); }}
                                className="btn btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyToConfirm}
                                disabled={!copyingToVehicleId}
                                className="btn btn-primary text-sm disabled:opacity-40"
                            >
                                Copy test
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Performance Testing (acceleration / braking) ──────────────── */}
            {/* Above EPA: both are independently-measured test data, so they sit
                next to the charging/range runs, while EPA is certification
                reference data and reads last. */}
            {subtab === 'performance' && (
                <PerformanceVehicleSection
                    vehicle={vehicle}
                    canEdit={isContributor && canEdit(vehicle)}
                />
            )}

            {/* ── EPA Testing Data ──────────────────────────────────────────── */}
            {subtab === 'epa' && (
                <EpaVehicleSection
                    vehicle={vehicle}
                    canEdit={isContributor && canEdit(vehicle)}
                    searchEpaTestGroups={searchEpaTestGroups}
                    onLink={linkEpaTestGroup}
                    onCreate={createAndLinkEpaTestGroup}
                    onUnlink={unlinkEpaTestGroup}
                    onUpdateConfidence={updateEpaMapping}
                    onUpdateDisplayName={(testGroupId, name) =>
                        updateEpaTestGroup(testGroupId, { display_name: name || null })
                    }
                />
            )}
        </div>
    );
}
