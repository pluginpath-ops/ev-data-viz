const ROLES = ['user', 'contributor', 'admin'];

const roleBadgeStyle = {
    admin:       { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' },
    contributor: { backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' },
    user:        { backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' },
};

/**
 * Admin sub-tab: user list + role assignment, plus the role-permission legend.
 * State lives in the parent AdminView; this is a presentational component.
 */
export default function RolesPermissions({ users, loading, saving, currentUserId, onRoleChange }) {
    return (
        <>
            {loading ? (
                <div className="empty-state">Loading users…</div>
            ) : users.length === 0 ? (
                <div className="empty-state">No users found.</div>
            ) : (
                <div className="card p-0 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-[var(--color-surface-muted)] text-left">
                                <th className="px-4 py-3 font-semibold text-secondary">Email</th>
                                <th className="px-4 py-3 font-semibold text-secondary">Joined</th>
                                <th className="px-4 py-3 font-semibold text-secondary">Role</th>
                                <th className="px-4 py-3 font-semibold text-secondary">Change Role</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t hover:bg-[var(--color-surface-muted)] transition">
                                    <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{u.email}</td>
                                    <td className="px-4 py-3 text-secondary">
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
                                            <span className="text-xs text-meta italic">can't change own role</span>
                                        ) : (
                                            <div className="flex gap-1 flex-wrap">
                                                {ROLES.map(role => (
                                                    <button
                                                        key={role}
                                                        onClick={() => onRoleChange(u.id, role)}
                                                        disabled={u.role === role || saving === u.id}
                                                        className={`px-2.5 py-1 rounded border text-xs font-medium transition ${
                                                            u.role === role
                                                                ? 'opacity-40 cursor-default'
                                                                : 'bg-[var(--color-surface-input)] hover:bg-[var(--color-surface-sunken)] border-[var(--color-border)] text-secondary'
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
        </>
    );
}
