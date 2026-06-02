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
import { useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import CuratorField from './CuratorField';
import DerivedValues from './DerivedValues';
import TestPhaseEditor from './TestPhaseEditor';
import AuditHistory from './AuditHistory';
import { EPA_EXPLAINERS } from '../../utils/epaExplainers';

function Section({ title, children }) {
    return (
        <div className="mb-4">
            <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold">{title}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">{children}</div>
        </div>
    );
}

export default function EpaCuratorEditor({ testGroupId, canEdit }) {
    const {
        getEpaTestGroupFull, updateEpaTestGroup,
        saveEpaCoefficientSet, saveEpaTest, deleteEpaTest,
        saveEpaPhase, deleteEpaPhase, logEpaFieldEdit, getEpaAuditForGroup,
    } = useAppContext();

    const [group, setGroup]   = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]   = useState(null);
    const [citation, setCitation] = useState(''); // optional source for subsequent edits

    const reload = useCallback(async () => {
        try {
            const g = await getEpaTestGroupFull(testGroupId);
            setGroup(g);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [getEpaTestGroupFull, testGroupId]);

    useEffect(() => { reload(); }, [reload]);

    if (loading) return <p className="text-xs text-gray-400 italic py-2">Loading curator data…</p>;
    if (error)   return <p className="text-xs text-red-500 py-2">Error: {error}</p>;
    if (!group)  return null;

    const primary = (group.epa_coefficient_sets || []).find(s => s.is_primary)
        || (group.epa_coefficient_sets || [])[0] || null;

    // Provenance helpers
    const gOv = (f) => group.overrides?.[f]?.source;
    const cOv = (f) => primary?.overrides?.[f]?.source;

    const audit = (tableName, rowId, field, prior, next) =>
        logEpaFieldEdit?.({ tableName, rowId, field, priorValue: prior, newValue: next,
            sourceCitation: citation.trim() || null });

    // ── Save handlers (mark source:'manual' + audit + reload) ───────────────────
    const saveGroup = async (field, value) => {
        const prior = group[field];
        const overrides = { ...(group.overrides || {}), [field]: { source: 'manual', at: new Date().toISOString() } };
        await updateEpaTestGroup(testGroupId, { [field]: value, overrides });
        audit('epa_test_groups', testGroupId, field, prior, value);
        await reload();
    };

    const saveCoeff = async (field, value) => {
        const base = primary || { test_group_id: testGroupId, category: 'City/Highway', is_primary: true };
        const prior = base[field];
        const overrides = { ...(base.overrides || {}), [field]: { source: 'manual', at: new Date().toISOString() } };
        const saved = await saveEpaCoefficientSet({ ...(primary?.id ? { id: primary.id } : {}), test_group_id: testGroupId, category: base.category, is_primary: true, [field]: value, overrides });
        audit('epa_coefficient_sets', saved?.id ?? primary?.id ?? testGroupId, field, prior, value);
        await reload();
    };

    const saveTest = async (row) => {
        await saveEpaTest(row.id ? row : { ...row, test_group_id: testGroupId });
        await reload();
    };
    const removeTest = async (t) => { await deleteEpaTest(t.id); await reload(); };
    const addTest = async () => {
        await saveEpaTest({ test_group_id: testGroupId, procedure_code: 77, source: 'manual' });
        await reload();
    };
    const savePhase = async (row) => { await saveEpaPhase(row); await reload(); };
    const removePhase = async (p) => { await deleteEpaPhase(p.id); await reload(); };
    const addPhase = async (test) => {
        const next = (test.epa_test_phases || []).reduce((m, p) => Math.max(m, p.phase_index), 0) + 1;
        await saveEpaPhase({ test_id: test.id, phase_index: next, phase_type: 'HWY' });
        await reload();
    };

    return (
        <div className="border-t border-gray-100 dark:border-slate-700 mt-3 pt-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] text-gray-400 italic">
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
                    <span className="text-gray-500 dark:text-slate-400 shrink-0">Source citation</span>
                    <input
                        type="text"
                        value={citation}
                        onChange={e => setCitation(e.target.value)}
                        placeholder="e.g. J1634 sheet p.3 / CSI PDF — applied to edits below"
                        className="form-input text-xs py-0.5 flex-1"
                    />
                </div>
            )}

            {/* Section 1: Identity */}
            <Section title="Identity & Configuration">
                <CuratorField label="Model year" type="number" value={group.model_year} canEdit={canEdit} overrideSource={gOv('model_year')} onSave={v => saveGroup('model_year', v)} />
                <CuratorField label="Manufacturer" value={group.make} canEdit={canEdit} overrideSource={gOv('make')} onSave={v => saveGroup('make', v)} />
                <CuratorField label="Carline" value={group.epa_carline_name} canEdit={canEdit} overrideSource={gOv('epa_carline_name')} onSave={v => saveGroup('epa_carline_name', v)} />
                <CuratorField label="Config #" value={group.vehicle_config_number} canEdit={canEdit} overrideSource={gOv('vehicle_config_number')} onSave={v => saveGroup('vehicle_config_number', v)} />
                <CuratorField label="Drive" value={group.drive} canEdit={canEdit} overrideSource={gOv('drive')} onSave={v => saveGroup('drive', v)} />
                <CuratorField label="Evap family" value={group.evap_family} canEdit={canEdit} overrideSource={gOv('evap_family')} onSave={v => saveGroup('evap_family', v)} />
                <CuratorField label="Fuel category" value={group.fuel_type} canEdit={canEdit} overrideSource={gOv('fuel_type')} onSave={v => saveGroup('fuel_type', v)} />
            </Section>

            {/* Section 2: Road load */}
            <Section title="Road Load & Weight">
                <CuratorField label="Test weight" type="number" unit="lbs" value={primary?.equiv_test_weight_lbs} canEdit={canEdit} overrideSource={cOv('equiv_test_weight_lbs')} onSave={v => saveCoeff('equiv_test_weight_lbs', v)} />
                <span />
                <CuratorField label="Target A" type="number" step="0.0001" unit="lbf" tooltip={EPA_EXPLAINERS.roadLoad} value={primary?.target_a} canEdit={canEdit} overrideSource={cOv('target_a')} onSave={v => saveCoeff('target_a', v)} />
                <CuratorField label="Set A" type="number" step="0.0001" unit="lbf" value={primary?.set_a} canEdit={canEdit} overrideSource={cOv('set_a')} onSave={v => saveCoeff('set_a', v)} />
                <CuratorField label="Target B" type="number" step="0.000001" unit="lbf/mph" value={primary?.target_b} canEdit={canEdit} overrideSource={cOv('target_b')} onSave={v => saveCoeff('target_b', v)} />
                <CuratorField label="Set B" type="number" step="0.000001" unit="lbf/mph" value={primary?.set_b} canEdit={canEdit} overrideSource={cOv('set_b')} onSave={v => saveCoeff('set_b', v)} />
                <CuratorField label="Target C" type="number" step="0.00000001" unit="lbf/mph²" value={primary?.target_c} canEdit={canEdit} overrideSource={cOv('target_c')} onSave={v => saveCoeff('target_c', v)} />
                <CuratorField label="Set C" type="number" step="0.00000001" unit="lbf/mph²" value={primary?.set_c} canEdit={canEdit} overrideSource={cOv('set_c')} onSave={v => saveCoeff('set_c', v)} />
            </Section>

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

            {/* Section 6: Range & label */}
            <Section title="Range & Label Values">
                <CuratorField label="CD range combined (calc)" type="number" step="0.1" unit="mi" value={group.cd_range_combined_calc} canEdit={canEdit} overrideSource={gOv('cd_range_combined_calc')} onSave={v => saveGroup('cd_range_combined_calc', v)} />
                <CuratorField label="CD range highway (calc)" type="number" step="0.1" unit="mi" value={group.cd_range_hwy_calc} canEdit={canEdit} overrideSource={gOv('cd_range_hwy_calc')} onSave={v => saveGroup('cd_range_hwy_calc', v)} />
                <CuratorField label="Label range (published)" type="number" step="0.1" unit="mi" value={group.label_range_published} canEdit={canEdit} overrideSource={gOv('label_range_published')} onSave={v => saveGroup('label_range_published', v)} />
                <CuratorField label="Label combined MPGe" type="number" step="0.1" value={group.label_combined_mpge} canEdit={canEdit} overrideSource={gOv('label_combined_mpge')} onSave={v => saveGroup('label_combined_mpge', v)} />
                <CuratorField label="Label highway MPGe" type="number" step="0.1" value={group.label_hwy_mpge} canEdit={canEdit} overrideSource={gOv('label_hwy_mpge')} onSave={v => saveGroup('label_hwy_mpge', v)} />
                <CuratorField label="Derived 5-cycle coeff." type="number" step="0.0001" value={group.derived_5cycle_coefficient} canEdit={canEdit} overrideSource={gOv('derived_5cycle_coefficient')} onSave={v => saveGroup('derived_5cycle_coefficient', v)} />
            </Section>

            {/* Section 7: Battery & powertrain */}
            <Section title="Battery & Powertrain Assumptions">
                <CuratorField label="Useable battery" type="number" step="0.001" unit="kWh" value={group.useable_kwh} canEdit={canEdit} overrideSource={gOv('useable_kwh')} onSave={v => saveGroup('useable_kwh', v)} />
                <CuratorField label="Total voltage" type="number" step="0.1" unit="V" value={group.total_voltage} canEdit={canEdit} overrideSource={gOv('total_voltage')} onSave={v => saveGroup('total_voltage', v)} />
                <CuratorField label="Specific energy" type="number" step="0.1" unit="Wh/kg" value={group.battery_specific_energy} canEdit={canEdit} overrideSource={gOv('battery_specific_energy')} onSave={v => saveGroup('battery_specific_energy', v)} />
                <CuratorField label="Accessory load" type="number" step="1" unit="W" placeholder="300" value={group.accessory_load_w_override} canEdit={canEdit} overrideSource={gOv('accessory_load_w_override')} onSave={v => saveGroup('accessory_load_w_override', v)} />
                <CuratorField label="Charger eff. override" type="number" step="0.001" placeholder="0.90" value={group.charger_efficiency_override} canEdit={canEdit} overrideSource={gOv('charger_efficiency_override')} onSave={v => saveGroup('charger_efficiency_override', v)} />
            </Section>

            {/* Section 8: Derived values */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                <DerivedValues group={group} />
            </div>

            {/* Audit trail */}
            <AuditHistory group={group} getEpaAuditForGroup={getEpaAuditForGroup} />
        </div>
    );
}
