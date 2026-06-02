/**
 * Sections 3–5 editor: per-test records, their energy totals, and the child
 * phase list. This is where the curator enters DC-side phase energy — adding a
 * proc-77 (or proc-84) HWY phase is what flips the derived η from estimated to
 * measured.
 *
 * Inline sanity checks (spec): phase DC sum vs Total DC, phase count vs the
 * declared Bags/Phases Conducted, plus per-phase derived consumption.
 */
import { useState } from 'react';
import CuratorField from './CuratorField';
import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, PROC_FTP75 } from '../../utils/epaDerivations';

const PROC_OPTIONS = [
    { v: PROC_MCT,     label: '77 — Multi-Cycle Test' },
    { v: PROC_CD_HWY,  label: '84 — CD Highway' },
    { v: PROC_CD_UDDS, label: '81 — CD UDDS' },
    { v: PROC_FTP75,   label: '2 — FTP-75' },
];
const PHASE_TYPES   = ['UDDS', 'HWY', 'SS', 'Cold-UDDS', 'US06', 'SC03'];
const SOURCE_OPTS   = ['csv', 'j1634', 'csi_pdf', 'manual'];
const ORIGINATORS   = ['MFR', 'EPA'];

// Standard cycle distances (miles) for phase-type auto-suggestion.
const HWFET_MI  = 10.26;
const UDDS_MI   = 7.45;
const DIST_TOL  = 0.7;   // ± tolerance around the standard distance

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

/**
 * Suggest a phase type from its distance (curator can always override):
 *   ~10.26 mi → HWY, ~7.45 mi → UDDS, a bag ≫10× its neighbors → SS.
 * Returns a type string or null when nothing matches confidently.
 *
 * @param {number} distanceMi
 * @param {number[]} otherDistances  distances of the test's other phases
 */
export function suggestPhaseType(distanceMi, otherDistances = []) {
    const d = num(distanceMi);
    if (d == null || d <= 0) return null;
    // SS: a depletion bag far longer than its shortest neighbor.
    const others = otherDistances.map(num).filter(x => x != null && x > 0);
    if (others.length && d >= 10 * Math.min(...others)) return 'SS';
    if (Math.abs(d - HWFET_MI) <= DIST_TOL) return 'HWY';
    if (Math.abs(d - UDDS_MI)  <= DIST_TOL) return 'UDDS';
    return null;
}

function PhaseRow({ phase, canEdit, onSave, onDelete }) {
    const consumption = (() => {
        const e = num(phase.dc_energy_kwh), d = num(phase.distance_mi);
        return e != null && d != null && d > 0 ? (e / d * 1000).toFixed(0) : null; // Wh/mi
    })();
    const set = (field) => (val) => onSave({ ...phase, [field]: val });

    return (
        <tr className="border-t border-gray-100 dark:border-slate-700">
            <td className="py-1 pr-2 text-gray-400 font-mono">{phase.phase_index}</td>
            <td className="py-1 pr-2">
                {canEdit ? (
                    <select
                        value={phase.phase_type ?? ''}
                        onChange={e => onSave({ ...phase, phase_type: e.target.value || null })}
                        className="form-input text-xs py-0.5 px-1 w-24"
                    >
                        <option value="">—</option>
                        {PHASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                ) : (phase.phase_type ?? '—')}
            </td>
            <td className="py-1 pr-2">
                <InlineNum value={phase.dc_energy_kwh} canEdit={canEdit} step="0.001" onSave={set('dc_energy_kwh')} />
            </td>
            <td className="py-1 pr-2">
                <InlineNum value={phase.distance_mi} canEdit={canEdit} step="0.001" onSave={set('distance_mi')} />
            </td>
            <td className="py-1 pr-2 text-right font-mono text-gray-500">{consumption ? `${consumption} Wh/mi` : '—'}</td>
            <td className="py-1 text-right">
                {canEdit && (
                    <button onClick={() => onDelete(phase)} className="text-red-500 hover:text-red-600 text-xs" title="Delete phase">✕</button>
                )}
            </td>
        </tr>
    );
}

function InlineNum({ value, canEdit, step, onSave }) {
    const [draft, setDraft] = useState(null);
    if (!canEdit) return <span className="font-mono text-right">{value ?? '—'}</span>;
    return (
        <input
            type="number" step={step}
            value={draft !== null ? draft : (value ?? '')}
            onFocus={() => setDraft(value != null ? String(value) : '')}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { const v = draft; setDraft(null); if (v !== null && String(value ?? '') !== v.trim()) onSave(v.trim() === '' ? null : Number(v)); }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setDraft(null); }}
            className="form-input text-xs py-0.5 px-1 w-24 text-right font-mono"
        />
    );
}

function TestCard({ test, canEdit, onSaveTest, onDeleteTest, onSavePhase, onDeletePhase, onAddPhase }) {
    const phases = [...(test.epa_test_phases || [])].sort((a, b) => a.phase_index - b.phase_index);
    const saveField = (field) => (val) => onSaveTest({ id: test.id, [field]: val });

    // Auto-suggest the phase type from distance when the curator hasn't set one
    // (never overrides an explicit choice). Uses sibling distances for the SS case.
    const handleSavePhase = (row) => {
        if (!row.phase_type && row.distance_mi != null) {
            const others = phases.filter(p => p.id !== row.id).map(p => p.distance_mi);
            const suggested = suggestPhaseType(row.distance_mi, others);
            if (suggested) { onSavePhase({ ...row, phase_type: suggested }); return; }
        }
        onSavePhase(row);
    };

    // Sanity: phase DC sum vs declared total; phase count vs declared bags.
    const phaseSum = phases.reduce((s, p) => s + (num(p.dc_energy_kwh) ?? 0), 0);
    const totalDc  = num(test.total_dc_energy_kwh);
    const sumMismatch = totalDc != null && phaseSum > 0 && Math.abs(phaseSum - totalDc) / totalDc > 0.05;
    const bags = num(test.bags_phases_conducted);
    const bagMismatch = bags != null && bags !== phases.length;

    return (
        <div className="border rounded-lg p-3 mb-2 border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    {canEdit ? (
                        <select
                            value={test.procedure_code ?? ''}
                            onChange={e => onSaveTest({ id: test.id, procedure_code: e.target.value ? Number(e.target.value) : null })}
                            className="form-input text-xs py-0.5"
                        >
                            <option value="">Procedure…</option>
                            {PROC_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                    ) : (
                        <span className="text-xs font-semibold">proc {test.procedure_code ?? '—'}</span>
                    )}
                    <span className="font-mono text-xs text-gray-400">{test.test_number}</span>
                </div>
                {canEdit && (
                    <button onClick={() => onDeleteTest(test)} className="btn btn-secondary text-xs py-0.5 px-2">Delete test</button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs mb-2">
                <CuratorField label="Test number" value={test.test_number} canEdit={canEdit} onSave={saveField('test_number')} />
                <CuratorField label="Lab ID" value={test.lab_id} canEdit={canEdit} onSave={saveField('lab_id')} />
                <EnumField label="Originator" value={test.originator} options={ORIGINATORS} canEdit={canEdit} onSave={saveField('originator')} />
                <EnumField label="Source" value={test.source} options={SOURCE_OPTS} canEdit={canEdit} onSave={saveField('source')} />
                <CuratorField label="Test date" type="text" placeholder="YYYY-MM-DD" value={test.test_date} canEdit={canEdit} onSave={saveField('test_date')} />
                <CuratorField label="Total DC" type="number" step="0.001" unit="kWh" value={test.total_dc_energy_kwh} canEdit={canEdit} onSave={saveField('total_dc_energy_kwh')} />
                <CuratorField label="AC recharge" type="number" step="0.001" unit="kWh" value={test.ac_recharge_kwh} canEdit={canEdit} onSave={saveField('ac_recharge_kwh')} />
                <CuratorField label="Total distance" type="number" step="0.001" unit="mi" value={test.total_distance_mi} canEdit={canEdit} onSave={saveField('total_distance_mi')} />
                <CuratorField label="Bags/phases" type="number" value={test.bags_phases_conducted} canEdit={canEdit} onSave={saveField('bags_phases_conducted')} />
                <CuratorField label="Recharge V" type="number" step="0.1" unit="V" value={test.recharge_voltage} canEdit={canEdit} onSave={saveField('recharge_voltage')} />
            </div>

            {/* Phases */}
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-gray-400 text-[10px] uppercase tracking-wide text-left">
                        <th className="font-semibold pr-2">#</th>
                        <th className="font-semibold pr-2">Phase</th>
                        <th className="font-semibold pr-2">DC (kWh)</th>
                        <th className="font-semibold pr-2">Dist (mi)</th>
                        <th className="font-semibold pr-2 text-right">Consumption</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {phases.map(p => (
                        <PhaseRow key={p.id} phase={p} canEdit={canEdit}
                            onSave={handleSavePhase} onDelete={onDeletePhase} />
                    ))}
                    {phases.length === 0 && (
                        <tr><td colSpan={6} className="py-1 text-gray-400 italic text-[11px]">No phases yet. Add the HWY phase to enable measured η.</td></tr>
                    )}
                </tbody>
            </table>
            {canEdit && (
                <button onClick={() => onAddPhase(test)} className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 hover:underline">
                    + Add phase
                </button>
            )}

            {/* Inline sanity */}
            {(sumMismatch || bagMismatch) && (
                <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 space-y-0.5">
                    {sumMismatch && <div>⚠ Phase DC sum {phaseSum.toFixed(2)} kWh ≠ Total DC {totalDc} kWh (&gt;5%)</div>}
                    {bagMismatch && <div>⚠ {phases.length} phase(s) entered vs {bags} declared</div>}
                </div>
            )}
        </div>
    );
}

function EnumField({ label, value, options, canEdit, onSave }) {
    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-gray-500 dark:text-slate-400">{label}</span>
            {canEdit ? (
                <select value={value ?? ''} onChange={e => onSave(e.target.value || null)}
                    className="form-input text-xs py-0.5 px-1 w-28">
                    <option value="">—</option>
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : <span className="font-mono text-xs">{value ?? '—'}</span>}
        </div>
    );
}

export default function TestPhaseEditor({ tests, canEdit, onSaveTest, onDeleteTest, onSavePhase, onDeletePhase, onAddTest, onAddPhase }) {
    const sorted = [...(tests || [])].sort((a, b) => (a.procedure_code ?? 99) - (b.procedure_code ?? 99));
    return (
        <div>
            <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Tests &amp; Phases
            </div>
            {sorted.map(t => (
                <TestCard key={t.id} test={t} canEdit={canEdit}
                    onSaveTest={onSaveTest} onDeleteTest={onDeleteTest}
                    onSavePhase={onSavePhase} onDeletePhase={onDeletePhase} onAddPhase={onAddPhase} />
            ))}
            {sorted.length === 0 && (
                <p className="text-xs text-gray-400 italic mb-2">No tests entered. Add a Multi-Cycle Test (proc 77) and its HWY phase to compute a measured η.</p>
            )}
            {canEdit && (
                <button onClick={onAddTest} className="btn btn-secondary text-xs py-1 px-2">+ Add test</button>
            )}
        </div>
    );
}
