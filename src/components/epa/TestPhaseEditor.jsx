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
import InfoIcon from '../InfoIcon';
import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, PROC_FTP75 } from '../../constants/epa';
import { suggestPhaseType } from '../../utils/phaseTypes';

const PROC_OPTIONS = [
    { v: PROC_MCT,     label: '77 — Multi-Cycle Test' },
    { v: PROC_CD_HWY,  label: '84 — CD Highway' },
    { v: PROC_CD_UDDS, label: '81 — CD UDDS' },
    { v: PROC_FTP75,   label: '2 — FTP-75' },
];
const PHASE_TYPES   = ['UDDS', 'HWY', 'SS', 'Cold-UDDS', 'US06', 'SC03'];
const SOURCE_OPTS   = ['csv', 'j1634', 'csi_pdf', 'manual'];
const ORIGINATORS   = ['MFR', 'EPA'];


const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

function PhaseRow({ phase, canEdit, onSave, onDelete }) {
    const consumption = (() => {
        const e = num(phase.dc_energy_kwh), d = num(phase.distance_mi);
        return e != null && d != null && d > 0 ? (e / d * 1000).toFixed(0) : null; // Wh/mi
    })();
    const set = (field) => (val) => onSave({ ...phase, [field]: val });

    return (
        <tr className="border-t border-[var(--color-border)]">
            <td className="py-1 pr-2 text-faint font-mono">{phase.phase_index}</td>
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
                <InlineNum value={phase.distance_mi} canEdit={canEdit} step="0.001" onSave={set('distance_mi')} />
            </td>
            <td className="py-1 pr-2">
                <InlineNum value={phase.dc_energy_kwh} canEdit={canEdit} step="0.001" onSave={set('dc_energy_kwh')} />
            </td>
            <td className="py-1 pr-2 text-right font-mono text-muted">{consumption ? `${consumption} Wh/mi` : '—'}</td>
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
    const distSum  = phases.reduce((s, p) => s + (num(p.distance_mi) ?? 0), 0);
    const totalDc  = num(test.total_dc_energy_kwh);
    const sumMismatch = totalDc != null && phaseSum > 0 && Math.abs(phaseSum - totalDc) / totalDc > 0.05;
    const bags = num(test.bags_phases_conducted);
    const bagMismatch = bags != null && bags !== phases.length;
    // When a bag count is declared and no phases exist yet, offer to add them all at once.
    const addCount = (phases.length === 0 && bags != null && bags > 1) ? bags : 1;
    // Fill Total DC + Total distance from the sum of all phases.
    const canSumPhases = phaseSum > 0 || distSum > 0;
    const fillTotalsFromPhases = () => onSaveTest({
        id: test.id,
        total_dc_energy_kwh: phaseSum > 0 ? Math.round(phaseSum * 1000) / 1000 : null,
        total_distance_mi:   distSum  > 0 ? Math.round(distSum  * 1000) / 1000 : null,
    });

    return (
        <div className="border rounded-lg p-3 mb-2 border-[var(--color-border)]">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    {canEdit ? (
                        <select
                            value={test.procedure_code ?? ''}
                            onChange={e => onSaveTest({ id: test.id, procedure_code: e.target.value ? Number(e.target.value) : null })}
                            className="form-input text-xs py-0.5"
                            title="77 = Multi-Cycle Test (preferred — city + highway + totals in one run). 84 = Charge Depleting Highway (fallback). 81 = Charge Depleting UDDS (stored only). 2 = FTP-75."
                        >
                            <option value="">Procedure…</option>
                            {PROC_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                    ) : (
                        <span className="text-xs font-semibold">proc {test.procedure_code ?? '—'}</span>
                    )}
                    <span className="font-mono text-xs text-faint">{test.test_number}</span>
                </div>
                {canEdit && (
                    <button onClick={() => onDeleteTest(test)} className="btn btn-secondary text-xs py-0.5 px-2">Delete test</button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs mb-2">
                <CuratorField label="Test number" tooltip="EPA test identifier (e.g. VRIV10093452)." value={test.test_number} canEdit={canEdit} onSave={saveField('test_number')} />
                <CuratorField label="Lab ID" tooltip="Physical lab (e.g. FEV Michigan, EPA Ann Arbor). Lab-to-lab variation of ~1–2% is normal." value={test.lab_id} canEdit={canEdit} onSave={saveField('lab_id')} />
                <EnumField label="Originator" tooltip="MFR (manufacturer's contracted lab, e.g. FEV) or EPA (Ann Arbor confirmatory). Prefer EPA-run tests when both exist." value={test.originator} options={ORIGINATORS} canEdit={canEdit} onSave={saveField('originator')} />
                <EnumField label="Source" tooltip="Where this test's detail came from: CSV import, J1634 calculator sheet, CSI PDF, or manual entry." value={test.source} options={SOURCE_OPTS} canEdit={canEdit} onSave={saveField('source')} />
                <CuratorField label="Test date" type="text" placeholder="YYYY-MM-DD" tooltip="Date of this specific test run." value={test.test_date} canEdit={canEdit} onSave={saveField('test_date')} />
                <CuratorField label="Total distance" type="number" step="0.001" unit="mi" tooltip="Total miles over the full depletion run." value={test.total_distance_mi} canEdit={canEdit} onSave={saveField('total_distance_mi')} />
                <CuratorField label="AC recharge" used type="number" step="0.001" unit="kWh" tooltip="AC-side energy to refill the pack; includes charger losses. Often blank in CSI PDFs — nullable. Required for measured charger efficiency." value={test.ac_recharge_kwh} canEdit={canEdit} onSave={saveField('ac_recharge_kwh')} />
                <CuratorField label="Total DC" used type="number" step="0.001" unit="kWh" tooltip="Total battery-side energy discharged over the full depletion. Must include SS segments (~78% of total). Anchors useable capacity and charger efficiency." value={test.total_dc_energy_kwh} canEdit={canEdit} onSave={saveField('total_dc_energy_kwh')} />
                <CuratorField label="Bags/phases" type="number" tooltip="Number of Charge Depleting bags/phases conducted — expected phase count for verification. Your entered phases should match this." value={test.bags_phases_conducted} canEdit={canEdit} onSave={saveField('bags_phases_conducted')} />
                <CuratorField label="Recharge V" type="number" step="0.1" unit="V" tooltip="AC supply voltage during recharge (e.g. 240V). Context for the recharge measurement." value={test.recharge_voltage} canEdit={canEdit} onSave={saveField('recharge_voltage')} />
            </div>

            {/* Phases */}
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-faint text-[10px] uppercase tracking-wide text-left">
                        <th className="font-semibold pr-2" title="Position in the test sequence (Bag/Phase number). Identity comes from procedure order, not the data.">#</th>
                        <th className="font-semibold pr-2" title="UDDS / HWY / SS / Cold-UDDS / US06 / SC03. SS = steady-state depletion at a lab-chosen speed — stored for energy totals but NOT a valid efficiency anchor.">Phase</th>
                        <th className="font-semibold pr-2" title="Actual distance driven for this phase (miles).">Dist (mi)</th>
                        <th className="font-semibold pr-2" title="Integrated DC KW-HRS: battery-side energy for this phase — what actually left the battery. This is what efficiency derivation uses.">DC Energy (kWh)</th>
                        <th className="font-semibold pr-2 text-right" title="Energy ÷ distance (Wh/mi). HWY phases at ~48.3 mph average are the efficiency anchor.">Consumption</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {phases.map(p => (
                        <PhaseRow key={p.id} phase={p} canEdit={canEdit}
                            onSave={handleSavePhase} onDelete={onDeletePhase} />
                    ))}
                    {phases.length === 0 && (
                        <tr><td colSpan={6} className="py-1 text-faint italic text-[11px]">No phases yet. Add the HWY phase to enable measured η.</td></tr>
                    )}
                </tbody>
            </table>
            {canEdit && (
                <div className="flex items-center gap-4 mt-1">
                    <button
                        onClick={() => onAddPhase(test, addCount)}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        {addCount > 1 ? `+ Add ${addCount} phases` : '+ Add phase'}
                    </button>
                    {canSumPhases && (
                        <button
                            onClick={fillTotalsFromPhases}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            title={`Set Total DC (${phaseSum.toFixed(2)} kWh) and Total distance (${distSum.toFixed(2)} mi) from the sum of all phases`}
                        >
                            Σ Fill totals from phases
                        </button>
                    )}
                </div>
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

function EnumField({ label, value, options, tooltip, canEdit, onSave }) {
    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-muted flex items-center gap-1">
                {label}
                {tooltip && <InfoIcon text={tooltip} position="right" />}
            </span>
            <span className="flex items-center gap-1 shrink-0">
                {canEdit ? (
                    <select value={value ?? ''} onChange={e => onSave(e.target.value || null)}
                        className="form-input text-xs py-0.5 px-1 w-28">
                        <option value="">—</option>
                        {options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                ) : <span className="font-mono text-xs text-right w-28">{value ?? '—'}</span>}
                <span className="w-10 shrink-0" />
            </span>
        </div>
    );
}

export default function TestPhaseEditor({ tests, canEdit, onSaveTest, onDeleteTest, onSavePhase, onDeletePhase, onAddTest, onAddPhase }) {
    const sorted = [...(tests || [])].sort((a, b) => (a.procedure_code ?? 99) - (b.procedure_code ?? 99));
    return (
        <div>
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Tests &amp; Phases
            </div>
            {sorted.map(t => (
                <TestCard key={t.id} test={t} canEdit={canEdit}
                    onSaveTest={onSaveTest} onDeleteTest={onDeleteTest}
                    onSavePhase={onSavePhase} onDeletePhase={onDeletePhase} onAddPhase={onAddPhase} />
            ))}
            {sorted.length === 0 && (
                <p className="text-xs text-faint italic mb-2">No tests entered. Add a Multi-Cycle Test (proc 77) and its HWY phase to compute a measured η.</p>
            )}
            {canEdit && (
                <button onClick={onAddTest} className="btn btn-secondary text-xs py-1 px-2">+ Add test</button>
            )}
        </div>
    );
}
