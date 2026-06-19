/**
 * The EPA curator form (Sections 1–8) for one test group, shown inline in
 * Tests & Data. Lazy-loads the full hierarchy (coefficient sets, tests,
 * phases) and edits the SHARED reference records — two vehicles linked to the
 * same test group edit the same data (a hint is shown in the header).
 *
 * On every edit it: writes the value, marks the field source:'manual' in the
 * row's `overrides`, and appends an audit-trail entry. Derivations (Section 8)
 * recompute live from the edited model.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import CuratorField from './CuratorField';
import DerivedValues from './DerivedValues';
import TestPhaseEditor from './TestPhaseEditor';
import AuditHistory from './AuditHistory';
import { ASSUMED_CHARGER_EFF, DEFAULT_ACCESSORY_W } from '../../constants/epa';

function Section({ title, children }) {
    return (
        <div className="mb-4">
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">{title}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">{children}</div>
        </div>
    );
}

// Field tooltips, verbatim from LocalDev/curator-fields-spec.md.
const TIP = {
    model_year:        'EPA active model year. May differ from marketing year.',
    make:              'Certificate Manufacturer Name — the certifying manufacturer entity.',
    carline:           "EPA's model name (Represented Test Vehicle Model) — frequently differs from the marketing name. Preserve verbatim.",
    config:            'Specific tested configuration. One test group can cover multiple configs (e.g. different wheel/tire packages).',
    drive:             'Test Drive Description — F/R/A/4 (front, rear, all-wheel, 4-wheel drive).',
    evap_family:       'Certified Evaporative Family code. Blank for BEVs — its absence is itself a BEV indicator.',
    fuel_category:     'Vehicle Fuel Category — Electricity / gasoline / diesel / etc. Determines which result units apply.',
    weight:            'Equivalent Test Weight: curb weight + 300 lb, rounded. Dyno inertia value; differs from curb weight.',
    target_a:          'Target Coefficient A (lbf): constant road-load term, dominated by rolling resistance. From EPA-accepted coastdown. Default for calculations.',
    target_b:          'Target Coefficient B (lbf/mph): linear road-load term.',
    target_c:          'Target Coefficient C (lbf/mph²): quadratic term, dominated by aerodynamic drag.',
    set_abc:           'Set Coefficients: what was actually programmed on the dyno. Usually matches Target; kept when they differ. Target is the default for calculations.',
    cd_range_combined: 'Charge Depleting Range (Calculated): unadjusted combined range from the test, before real-world derating.',
    cd_range_hwy:      'Charge Depleting Range Highway (Calculated): unadjusted highway range.',
    label_range:       'The window-sticker range after adjustment. Published ÷ computed combined range reveals the effective adjustment factor.',
    label_combined:    'Published combined efficiency, AC-side, at 33.7 kWh/gal. City-weighted (55/45) — flatters EVs. Not comparable across label methods.',
    label_hwy:         'Highway-only label MPGe (proc 84). Useful secondary metric; not the combined value.',
    derived_5cycle:    'Present if the cert used a vehicle-specific 5-cycle adjustment rather than the default 0.7. Blank suggests the conservative 0.7 default.',
    useable_kwh:       'Useable kWh — distinct from nameplate/gross. Drives range-mode chart. Cross-check against total DC discharged to depletion.',
    total_voltage:     'Pack voltage. With amp-hours, an alternate route to capacity.',
    specific_energy:   'Wh/kg. Fallback capacity estimate when capacity is blank.',
    accessory_load:    `Default ${DEFAULT_ACCESSORY_W} W. Constant parasitic draw assumed in the efficiency back-solve. Override only with documented cause.`,
    charger_override:  `Default derived from Total DC ÷ AC Recharge (≈0.84 measured for R2). Falls back to ${ASSUMED_CHARGER_EFF} when AC recharge is unavailable. Override to pin a known value.`,
};

export default function EpaCuratorEditor({ testGroupId, canEdit, onDirtyChange }) {
    const {
        getEpaTestGroupFull, updateEpaTestGroup,
        saveEpaCoefficientSet, saveEpaTest, deleteEpaTest,
        saveEpaPhase, deleteEpaPhase, logEpaFieldEdit, getEpaAuditForGroup,
    } = useAppContext();

    const [dbGroup, setDbGroup] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [citation, setCitation] = useState(''); // optional source for subsequent edits
    const [saving, setSaving]   = useState(false);

    // Buffered scalar-field edits — gated behind Save (structural add/delete of
    // tests & phases stay live). Shape:
    //   group:  { [field]: value }
    //   coeff:  { [field]: value }          (primary coefficient set)
    //   tests:  { [testId]:  { [field]: value } }
    //   phases: { [phaseId]: { [field]: value } }
    const [edits, setEdits] = useState({ group: {}, coeff: {}, tests: {}, phases: {} });
    const resetEdits = () => setEdits({ group: {}, coeff: {}, tests: {}, phases: {} });

    const reload = useCallback(async () => {
        try {
            setDbGroup(await getEpaTestGroupFull(testGroupId));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [getEpaTestGroupFull, testGroupId]);

    useEffect(() => { reload(); }, [reload]);

    const dirty =
        Object.keys(edits.group).length > 0 ||
        Object.keys(edits.coeff).length > 0 ||
        Object.values(edits.tests).some(o => Object.keys(o).length) ||
        Object.values(edits.phases).some(o => Object.keys(o).length);

    // Warn before leaving/refreshing the tab with unsaved buffered edits.
    useEffect(() => {
        if (!dirty) return;
        const h = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [dirty]);

    // Surface dirty state to the parent so it can guard collapse/navigation.
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    // Display view = DB truth with buffered edits overlaid. Drives every field
    // value AND the live derived-value/curve preview, so you see impact before Save.
    const group = useMemo(() => {
        if (!dbGroup) return null;
        const hasPrimary = (dbGroup.epa_coefficient_sets || []).some(s => s.is_primary);
        const sets = (dbGroup.epa_coefficient_sets || []).map((s, i) =>
            (s.is_primary || (!hasPrimary && i === 0)) ? { ...s, ...edits.coeff } : s);
        const tests = (dbGroup.epa_tests || []).map(t => ({
            ...t,
            ...(edits.tests[t.id] || {}),
            epa_test_phases: (t.epa_test_phases || []).map(p => ({ ...p, ...(edits.phases[p.id] || {}) })),
        }));
        return { ...dbGroup, ...edits.group, epa_coefficient_sets: sets, epa_tests: tests };
    }, [dbGroup, edits]);

    if (loading) return <p className="text-xs text-faint italic py-2">Loading curator data…</p>;
    if (error)   return <p className="text-xs text-red-500 py-2">Error: {error}</p>;
    if (!group)  return null;

    const primary    = (group.epa_coefficient_sets || []).find(s => s.is_primary)    || (group.epa_coefficient_sets || [])[0]    || null;
    const primaryRaw = (dbGroup.epa_coefficient_sets || []).find(s => s.is_primary) || (dbGroup.epa_coefficient_sets || [])[0] || null;
    // Additional (non-primary) coefficient sets captured from the PDF (Cold-CO, US06).
    const otherSets = (group.epa_coefficient_sets || []).filter(s => s !== primary && (s.target_a != null || s.set_a != null));
    const coef = (v) => (v == null ? '—' : String(v));

    // Provenance: 'pending' for unsaved buffered edits, else the saved source.
    const gOv = (f) => (f in edits.group) ? 'pending' : dbGroup.overrides?.[f]?.source;
    const cOv = (f) => (f in edits.coeff) ? 'pending' : primaryRaw?.overrides?.[f]?.source;

    const now = () => new Date().toISOString();
    const audit = (tableName, rowId, field, prior, next) =>
        logEpaFieldEdit?.({ tableName, rowId, field, priorValue: prior, newValue: next,
            sourceCitation: citation.trim() || null });

    // ── Buffered field edits (no DB write until Save) ───────────────────────────
    const saveGroup = (field, value) => setEdits(e => ({ ...e, group: { ...e.group, [field]: value } }));
    const saveCoeff = (field, value) => setEdits(e => ({ ...e, coeff: { ...e.coeff, [field]: value } }));
    const saveTest = (row) => {
        const { id, ...fields } = row;
        if (id == null) return;
        setEdits(e => ({ ...e, tests: { ...e.tests, [id]: { ...(e.tests[id] || {}), ...fields } } }));
    };
    const savePhase = (row) => {
        const { id, phase_type, dc_energy_kwh, distance_mi } = row;
        if (id == null) return;
        setEdits(e => ({ ...e, phases: { ...e.phases, [id]: { ...(e.phases[id] || {}), phase_type, dc_energy_kwh, distance_mi } } }));
    };

    // ── Structural ops stay live (immediate DB write + reload) ──────────────────
    const dropTestEdits  = (id) => setEdits(e => { const tests = { ...e.tests }; delete tests[id]; return { ...e, tests }; });
    const dropPhaseEdits = (id) => setEdits(e => { const phases = { ...e.phases }; delete phases[id]; return { ...e, phases }; });
    const addTest = async () => {
        await saveEpaTest({ test_group_id: testGroupId, procedure_code: 77, source: 'manual' });
        await reload();
    };
    const removeTest = async (t) => {
        (t.epa_test_phases || []).forEach(p => dropPhaseEdits(p.id));
        dropTestEdits(t.id);
        await deleteEpaTest(t.id);
        await reload();
    };
    const removePhase = async (p) => { dropPhaseEdits(p.id); await deleteEpaPhase(p.id); await reload(); };

    // ── Save / Discard the buffered field edits ─────────────────────────────────
    const handleSave = async () => {
        setSaving(true);
        try {
            const gf = edits.group;
            if (Object.keys(gf).length) {
                const overrides = { ...(dbGroup.overrides || {}) };
                Object.keys(gf).forEach(f => { overrides[f] = { source: 'manual', at: now() }; });
                await updateEpaTestGroup(testGroupId, { ...gf, overrides });
                Object.keys(gf).forEach(f => audit('epa_test_groups', testGroupId, f, dbGroup[f], gf[f]));
            }
            const cf = edits.coeff;
            if (Object.keys(cf).length) {
                const base = primaryRaw || { category: 'City/Highway', is_primary: true };
                const overrides = { ...(base.overrides || {}) };
                Object.keys(cf).forEach(f => { overrides[f] = { source: 'manual', at: now() }; });
                const saved = await saveEpaCoefficientSet({
                    ...(primaryRaw?.id ? { id: primaryRaw.id } : {}),
                    test_group_id: testGroupId, category: base.category || 'City/Highway', is_primary: true,
                    ...cf, overrides,
                });
                Object.keys(cf).forEach(f => audit('epa_coefficient_sets', saved?.id ?? primaryRaw?.id, f, base[f], cf[f]));
            }
            for (const [id, fields] of Object.entries(edits.tests)) {
                if (Object.keys(fields).length) await saveEpaTest({ id: Number(id), ...fields });
            }
            for (const [id, fields] of Object.entries(edits.phases)) {
                if (Object.keys(fields).length) await saveEpaPhase({ id: Number(id), ...fields });
            }
            resetEdits();
            await reload();
        } catch (e) {
            setError('Save failed: ' + e.message);
        } finally {
            setSaving(false);
        }
    };
    // Add `count` phases (default 1) with no type set, so distance-entry can
    // auto-suggest it. count>1 is used by the "Add X phases" bulk action.
    const addPhase = async (test, count = 1) => {
        let next = (test.epa_test_phases || []).reduce((m, p) => Math.max(m, p.phase_index), 0) + 1;
        for (let i = 0; i < count; i++) {
            await saveEpaPhase({ test_id: test.id, phase_index: next++, phase_type: null });
        }
        await reload();
    };

    return (
        <div className="border-t border-[var(--color-border)] mt-3 pt-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] text-faint italic">
                    Editing shared EPA reference data — changes apply to every vehicle linked to this test group.
                </p>
                <a
                    href="https://dis.epa.gov/otaqpub/publist1.jsp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
                    title="EPA Annual Certification Data — source of truth for test groups, coefficients, and lab reports"
                >
                    EPA source data ↗
                </a>
            </div>

            {/* Optional source citation applied to subsequent edits' audit entries */}
            {canEdit && (
                <div className="flex items-center gap-2 mb-3 text-xs">
                    <span className="text-muted shrink-0">Source citation</span>
                    <input
                        type="text"
                        value={citation}
                        onChange={e => setCitation(e.target.value)}
                        placeholder="e.g. J1634 sheet p.3 / CSI PDF — applied to edits below"
                        className="form-input text-xs py-0.5 flex-1"
                    />
                </div>
            )}

            {/* Save / Discard — fixed bottom action bar (shown only when dirty),
                matching the app's delete-queue paradigm. */}
            {canEdit && dirty && (
                <div className="fixed-action-bar z-50 bg-amber-50 dark:bg-slate-800 border-t-2 border-amber-200 dark:border-slate-600">
                    <div className="page-container py-3 flex items-center gap-4">
                        <span className="font-medium flex-1 text-amber-800 dark:text-amber-300">
                            ✎ Unsaved curator edits
                            <span className="font-normal text-amber-700/70 dark:text-slate-400 text-sm ml-2">
                                (adding/removing tests &amp; phases saves immediately)
                            </span>
                        </span>
                        <button onClick={resetEdits} disabled={saving} className="btn btn-secondary text-sm disabled:opacity-40">
                            Discard
                        </button>
                        <button onClick={handleSave} disabled={saving} className="btn btn-primary text-sm disabled:opacity-40">
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                </div>
            )}

            {/* Section 1: Identity */}
            <Section title="Identity & Configuration">
                <CuratorField label="Model year" type="number" tooltip={TIP.model_year} value={group.model_year} canEdit={canEdit} overrideSource={gOv('model_year')} onSave={v => saveGroup('model_year', v)} />
                <CuratorField label="Manufacturer" tooltip={TIP.make} value={group.make} canEdit={canEdit} overrideSource={gOv('make')} onSave={v => saveGroup('make', v)} />
                <CuratorField label="Carline" tooltip={TIP.carline} value={group.epa_carline_name} canEdit={canEdit} overrideSource={gOv('epa_carline_name')} onSave={v => saveGroup('epa_carline_name', v)} />
                <CuratorField label="Config #" tooltip={TIP.config} value={group.vehicle_config_number} canEdit={canEdit} overrideSource={gOv('vehicle_config_number')} onSave={v => saveGroup('vehicle_config_number', v)} />
                <CuratorField label="Drive" tooltip={TIP.drive} value={group.drive} canEdit={canEdit} overrideSource={gOv('drive')} onSave={v => saveGroup('drive', v)} />
                <CuratorField label="Evap family" tooltip={TIP.evap_family} value={group.evap_family} canEdit={canEdit} overrideSource={gOv('evap_family')} onSave={v => saveGroup('evap_family', v)} />
                <CuratorField label="Fuel category" tooltip={TIP.fuel_category} value={group.fuel_type} canEdit={canEdit} overrideSource={gOv('fuel_type')} onSave={v => saveGroup('fuel_type', v)} />
            </Section>

            {/* Section 2: Road load (Target A/B/C drive the curve & η) */}
            <Section title={`Road Load & Weight — ${primary?.category || 'City/Highway'} (primary, drives the curve)`}>
                <CuratorField label="Test weight" type="number" unit="lbs" tooltip={TIP.weight} value={primary?.equiv_test_weight_lbs} canEdit={canEdit} overrideSource={cOv('equiv_test_weight_lbs')} onSave={v => saveCoeff('equiv_test_weight_lbs', v)} />
                <span />
                <CuratorField label="Target A" used type="number" step="0.0001" unit="lbf" tooltip={TIP.target_a} value={primary?.target_a} canEdit={canEdit} overrideSource={cOv('target_a')} onSave={v => saveCoeff('target_a', v)} />
                <CuratorField label="Set A" type="number" step="0.0001" unit="lbf" tooltip={TIP.set_abc} value={primary?.set_a} canEdit={canEdit} overrideSource={cOv('set_a')} onSave={v => saveCoeff('set_a', v)} />
                <CuratorField label="Target B" used type="number" step="0.000001" unit="lbf/mph" tooltip={TIP.target_b} value={primary?.target_b} canEdit={canEdit} overrideSource={cOv('target_b')} onSave={v => saveCoeff('target_b', v)} />
                <CuratorField label="Set B" type="number" step="0.000001" unit="lbf/mph" tooltip={TIP.set_abc} value={primary?.set_b} canEdit={canEdit} overrideSource={cOv('set_b')} onSave={v => saveCoeff('set_b', v)} />
                <CuratorField label="Target C" used type="number" step="0.00000001" unit="lbf/mph²" tooltip={TIP.target_c} value={primary?.target_c} canEdit={canEdit} overrideSource={cOv('target_c')} onSave={v => saveCoeff('target_c', v)} />
                <CuratorField label="Set C" type="number" step="0.00000001" unit="lbf/mph²" tooltip={TIP.set_abc} value={primary?.set_c} canEdit={canEdit} overrideSource={cOv('set_c')} onSave={v => saveCoeff('set_c', v)} />
            </Section>

            {/* Additional coefficient sets (Cold CO / US06) — captured from the PDF,
                shown for reference. The steady-state curve uses the City/Highway set. */}
            {otherSets.length > 0 && (
                <div className="mb-4">
                    <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Other Coefficient Sets
                        <span className="normal-case font-normal"> — reference only (Cold-CO / US06; not used by the curve)</span>
                    </div>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-faint text-[10px] uppercase tracking-wide text-left">
                                <th className="font-semibold pr-3">Category</th>
                                <th className="font-semibold pr-3">Target A / B / C</th>
                                <th className="font-semibold">Set A / B / C</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono">
                            {otherSets.map(s => (
                                <tr key={s.id ?? s.category} className="border-t border-[var(--color-border)]">
                                    <td className="pr-3 py-0.5 font-sans">{s.category}</td>
                                    <td className="pr-3">{coef(s.target_a)} / {coef(s.target_b)} / {coef(s.target_c)}</td>
                                    <td className="text-muted">{coef(s.set_a)} / {coef(s.set_b)} / {coef(s.set_c)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Sections 3–5: Tests & phases */}
            <div className="mb-4">
                <TestPhaseEditor
                    tests={group.epa_tests}
                    canEdit={canEdit}
                    onSaveTest={saveTest}
                    onDeleteTest={removeTest}
                    onAddTest={addTest}
                    onSavePhase={savePhase}
                    onDeletePhase={removePhase}
                    onAddPhase={addPhase}
                />
            </div>

            {/* Section 6: Range & label (CD combined + published feed the adj factor) */}
            <Section title="Range & Label Values">
                <CuratorField label="CD range combined (calc)" used type="number" step="0.1" unit="mi" tooltip={TIP.cd_range_combined} value={group.cd_range_combined_calc} canEdit={canEdit} overrideSource={gOv('cd_range_combined_calc')} onSave={v => saveGroup('cd_range_combined_calc', v)} />
                <CuratorField label="CD range highway (calc)" type="number" step="0.1" unit="mi" tooltip={TIP.cd_range_hwy} value={group.cd_range_hwy_calc} canEdit={canEdit} overrideSource={gOv('cd_range_hwy_calc')} onSave={v => saveGroup('cd_range_hwy_calc', v)} />
                <CuratorField label="Label range (published)" used type="number" step="0.1" unit="mi" tooltip={TIP.label_range} value={group.label_range_published} canEdit={canEdit} overrideSource={gOv('label_range_published')} onSave={v => saveGroup('label_range_published', v)} />
                <CuratorField label="Label combined MPGe" type="number" step="0.1" tooltip={TIP.label_combined} value={group.label_combined_mpge} canEdit={canEdit} overrideSource={gOv('label_combined_mpge')} onSave={v => saveGroup('label_combined_mpge', v)} />
                <CuratorField label="Label highway MPGe" type="number" step="0.1" tooltip={TIP.label_hwy} value={group.label_hwy_mpge} canEdit={canEdit} overrideSource={gOv('label_hwy_mpge')} onSave={v => saveGroup('label_hwy_mpge', v)} />
                <CuratorField label="Derived 5-cycle coeff." type="number" step="0.0001" tooltip={TIP.derived_5cycle} value={group.derived_5cycle_coefficient} canEdit={canEdit} overrideSource={gOv('derived_5cycle_coefficient')} onSave={v => saveGroup('derived_5cycle_coefficient', v)} />
            </Section>

            {/* Section 7: Battery & powertrain (useable/accessory/charger feed derivations) */}
            <Section title="Battery & Powertrain Assumptions">
                <CuratorField label="Useable battery" used type="number" step="0.001" unit="kWh" tooltip={TIP.useable_kwh} value={group.useable_kwh} canEdit={canEdit} overrideSource={gOv('useable_kwh')} onSave={v => saveGroup('useable_kwh', v)} />
                <CuratorField label="Total voltage" type="number" step="0.1" unit="V" tooltip={TIP.total_voltage} value={group.total_voltage} canEdit={canEdit} overrideSource={gOv('total_voltage')} onSave={v => saveGroup('total_voltage', v)} />
                <CuratorField label="Specific energy" type="number" step="0.1" unit="Wh/kg" tooltip={TIP.specific_energy} value={group.battery_specific_energy} canEdit={canEdit} overrideSource={gOv('battery_specific_energy')} onSave={v => saveGroup('battery_specific_energy', v)} />
                <CuratorField label="Accessory load" used type="number" step="1" unit="W" placeholder={String(DEFAULT_ACCESSORY_W)} tooltip={TIP.accessory_load} value={group.accessory_load_w_override} canEdit={canEdit} overrideSource={gOv('accessory_load_w_override')} onSave={v => saveGroup('accessory_load_w_override', v)} />
                <CuratorField label="Charger eff. override" used type="number" step="0.001" placeholder={String(ASSUMED_CHARGER_EFF)} tooltip={TIP.charger_override} value={group.charger_efficiency_override} canEdit={canEdit} overrideSource={gOv('charger_efficiency_override')} onSave={v => saveGroup('charger_efficiency_override', v)} />
            </Section>

            {/* Section 8: Derived values */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                <DerivedValues group={group} />
            </div>
            <p className="text-[10px] text-faint mt-1">
                <span className="text-indigo-500">∗</span> feeds a derived calculation below.
            </p>

            {/* Audit trail */}
            <AuditHistory group={group} getEpaAuditForGroup={getEpaAuditForGroup} />
        </div>
    );
}
