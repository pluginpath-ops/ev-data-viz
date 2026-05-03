import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import ImportTableauModal from './ImportTableauModal';
import EpaImportModal from './EpaImportModal';
import EpaDataCard from './EpaDataCard';

const ROLES = ['user', 'contributor', 'admin'];

const roleBadgeStyle = {
    admin:       { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
    contributor: { backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' },
    user:        { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' },
};

export default function AdminView({ getUsersForAdmin, setUserRole, currentUserId }) {
    const {
        exportData, importData, importTableauSessions,
        importEpaTestGroups, getEpaTestGroupsAdmin, deleteEpaTestGroup, updateEpaLabelMethod, updateEpaTestGroup,
        vehicles,
    } = useAppContext();
    const [users, setUsers]           = useState([]);
    const [loading, setLoading]       = useState(true);
    const [saving, setSaving]         = useState(null);
    const [error, setError]           = useState(null);
    const [showImportMenu, setShowImportMenu] = useState(false);
    const [showTableauModal, setShowTableauModal] = useState(false);
    const [showEpaModal, setShowEpaModal]         = useState(false);
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
                <ImportTableauModal
                    vehicles={vehicles}
                    onImport={importTableauSessions}
                    onClose={() => setShowTableauModal(false)}
                />
            )}
            {showEpaModal && (
                <EpaImportModal
                    vehicles={vehicles}
                    onImport={importEpaTestGroups}
                    onClose={() => setShowEpaModal(false)}
                />
            )}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="page-title">Admin Panel</h2>
                    <p className="text-gray-500 mt-1">Manage registered users and their roles.</p>
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
                                        ⚡ EPA Test Car Data
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    <button onClick={load} className="btn btn-secondary text-sm" disabled={loading}>
                        {loading ? 'Loading…' : '↻ Refresh'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                    ⚠️ {error}
                </div>
            )}

            {loading ? (
                <div className="empty-state">Loading users…</div>
            ) : users.length === 0 ? (
                <div className="empty-state">No users found.</div>
            ) : (
                <div className="card p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-gray-50 text-left">
                                <th className="px-4 py-3 font-semibold text-gray-600">Email</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Joined</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Role</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Change Role</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t hover:bg-gray-50/50 transition">
                                    <td className="px-4 py-3 font-medium text-gray-800">{u.email}</td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {new Date(u.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span
                                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                            style={roleBadgeStyle[u.role] || roleBadgeStyle.user}
                                        >
                                            {u.role}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {u.id === currentUserId ? (
                                            <span className="text-xs text-gray-400 italic">can't change own role</span>
                                        ) : (
                                            <div className="flex gap-1 flex-wrap">
                                                {ROLES.map(role => (
                                                    <button
                                                        key={role}
                                                        onClick={() => handleRoleChange(u.id, role)}
                                                        disabled={u.role === role || saving === u.id}
                                                        className={`px-2.5 py-1 rounded border text-xs font-medium transition ${
                                                            u.role === role
                                                                ? 'opacity-40 cursor-default'
                                                                : 'bg-white hover:bg-gray-100 border-gray-300 text-gray-700'
                                                        }`}
                                                    >
                                                        {saving === u.id && u.role !== role ? '…' : role}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-6 p-4 rounded-lg border bg-amber-50 border-amber-200">
                <p className="text-sm text-amber-800 font-semibold mb-1">Role permissions</p>
                <ul className="text-xs text-amber-700 space-y-1">
                    <li><strong>admin</strong> — full access: edit/delete any vehicle or test, manage users, toggle visibility, change site settings</li>
                    <li><strong>contributor</strong> — edit any public vehicle or test, plus anything they submitted; can toggle visibility</li>
                    <li><strong>user</strong> — edit only vehicles and tests they submitted; visibility locked</li>
                    <li><em>Unauthenticated</em> — read-only access to public content</li>
                </ul>
            </div>

            <EpaDataCard
                getEpaTestGroupsAdmin={getEpaTestGroupsAdmin}
                deleteEpaTestGroup={deleteEpaTestGroup}
                updateEpaLabelMethod={updateEpaLabelMethod}
                updateEpaTestGroup={updateEpaTestGroup}
            />
        </div>
    );
}
