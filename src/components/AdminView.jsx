import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import LazyBoundary from './LazyBoundary';
import { ImportTableauModal, EpaImportModal, EpaPdfImportModal } from './lazyComponents';
import EpaDataCard from './EpaDataCard';
import RolesPermissions from './admin/RolesPermissions';
import ConstantsKnobs from './admin/ConstantsKnobs';
import InterfaceSettings from './admin/InterfaceSettings';
import FeGuideImport from './admin/FeGuideImport';

const SUBTABS = [
    { id: 'roles',     label: 'Roles & Permissions' },
    { id: 'epa',       label: 'EPA Data' },
    { id: 'feguide',   label: 'Fuel Economy Guide' },
    { id: 'constants', label: 'Model Constants' },
    { id: 'interface', label: 'Interface Settings' },
];

const SUBTITLES = {
    roles:     'Manage registered users and their roles.',
    epa:       'Browse, edit, link, and delete imported EPA test groups.',
    feguide:   'Import EPA\'s published label figures, one guide per model year.',
    constants: 'Tune the EPA model math (local sandbox).',
    interface: 'Site-wide appearance settings.',
};

export default function AdminView({ getUsersForAdmin, setUserRole, currentUserId }) {
    const {
        exportData, importData, importTableauSessions,
        importEpaTestGroups, getEpaTestGroupsAdmin, deleteEpaTestGroup, updateEpaTestGroup,
        importEpaCsiGroups, getExistingEpaTestGroupIds,
        vehicles,
    } = useAppContext();
    const [subtab, setSubtab]         = useState('roles');
    const [users, setUsers]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [saving, setSaving]         = useState(null);
    const [error, setError]           = useState(null);
    const [showImportMenu, setShowImportMenu] = useState(false);
    const [showTableauModal, setShowTableauModal] = useState(false);
    const [showEpaModal, setShowEpaModal]         = useState(false);
    const [showEpaPdfModal, setShowEpaPdfModal]   = useState(false);
    const jsonImportRef = useRef();

    useEffect(() => {
        load();
    }, []);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const data = await getUsersForAdmin();
            setUsers(data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleRoleChange(userId, newRole) {
        setSaving(userId);
        try {
            await setUserRole(userId, newRole);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
        } catch (e) {
            setError('Failed to update role: ' + e.message);
        } finally {
            setSaving(null);
        }
    }

    return (
        <div>
            {showTableauModal && (
                <LazyBoundary>
                    <ImportTableauModal
                        vehicles={vehicles}
                        onImport={importTableauSessions}
                        onClose={() => setShowTableauModal(false)}
                    />
                </LazyBoundary>
            )}
            {showEpaModal && (
                <LazyBoundary>
                    <EpaImportModal
                        vehicles={vehicles}
                        onImport={importEpaTestGroups}
                        onClose={() => setShowEpaModal(false)}
                    />
                </LazyBoundary>
            )}
            {showEpaPdfModal && (
                <LazyBoundary>
                    <EpaPdfImportModal
                        onImport={importEpaCsiGroups}
                        getExistingIds={getExistingEpaTestGroupIds}
                        onClose={() => setShowEpaPdfModal(false)}
                    />
                </LazyBoundary>
            )}

            <div className="flex justify-between items-center mb-4">
                <div>
                    <h2 className="page-title">Admin Panel</h2>
                    <p className="text-secondary mt-1">{SUBTITLES[subtab]}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportData} className="btn btn-secondary text-sm">
                        ↓ Export Data
                    </button>
                    <div className="relative">
                        <button className="btn btn-primary text-sm" onClick={() => setShowImportMenu(m => !m)}>
                            Import ▾
                        </button>
                        {showImportMenu && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowImportMenu(false)} />
                                <div className="dropdown-menu w-44">
                                    <label className="dropdown-item cursor-pointer" onClick={() => setShowImportMenu(false)}>
                                        📄 App JSON
                                        <input ref={jsonImportRef} type="file" accept=".json" className="hidden"
                                            onChange={e => { e.target.files[0] && importData(e.target.files[0]); e.target.value = ''; }} />
                                    </label>
                                    <button className="dropdown-item w-full text-left"
                                        onClick={() => { setShowImportMenu(false); setShowTableauModal(true); }}>
                                        📊 Tableau CSV
                                    </button>
                                    <button className="dropdown-item w-full text-left"
                                        onClick={() => { setShowImportMenu(false); setShowEpaModal(true); }}>
                                        ⚡ EPA Test Car Data (CSV)
                                    </button>
                                    <button className="dropdown-item w-full text-left"
                                        onClick={() => { setShowImportMenu(false); setShowEpaPdfModal(true); }}>
                                        📑 EPA Lab PDF (CSI)
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    {subtab === 'roles' && (
                        <button onClick={load} className="btn btn-secondary text-sm" disabled={loading}>
                            {loading ? 'Loading…' : '↻ Refresh'}
                        </button>
                    )}
                </div>
            </div>

            <div className="admin-subtabs">
                {SUBTABS.map(t => (
                    <button
                        key={t.id}
                        className={`btn-chart-mode ${subtab === t.id ? 'active' : ''}`}
                        onClick={() => setSubtab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                    ⚠️ {error}
                </div>
            )}

            {subtab === 'roles' && (
                <RolesPermissions
                    users={users}
                    loading={loading}
                    saving={saving}
                    currentUserId={currentUserId}
                    onRoleChange={handleRoleChange}
                />
            )}

            {subtab === 'epa' && (
                <EpaDataCard
                    getEpaTestGroupsAdmin={getEpaTestGroupsAdmin}
                    deleteEpaTestGroup={deleteEpaTestGroup}
                    updateEpaTestGroup={updateEpaTestGroup}
                />
            )}

            {subtab === 'feguide' && <FeGuideImport />}

            {subtab === 'constants' && <ConstantsKnobs />}

            {subtab === 'interface' && <InterfaceSettings />}
        </div>
    );
}
