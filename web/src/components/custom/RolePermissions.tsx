import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { AlertCircle, Check, Edit2, Plus, Shield, Trash2, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

interface Folder {
  folderId: string;
  name: string;
}

interface UserLite {
  userId: string;
  fullName: string;
  email: string;
}

interface PermissionGrant {
  permissionId: string;
  folderId: string;
  folderName: string;
  userId: string;
  userName: string;
  role: string;
  grantedAt: string;
}

interface RolePermission {
  role: string;
  viewOnly: boolean;
  downloadReadOnly: boolean;
  upload: boolean;
  updatePermission: boolean;
  approve: boolean;
  reject: boolean;
  adminForceUnlock: boolean;
}

// Values match HasPermissionForMethod() in api/Middleware/RBACMiddleware.cs —
// only the labels shown here are friendlier names for the same underlying roles.
const ROLE_OPTIONS = [
  { value: 'Writer', label: 'Folder Member' },
  { value: 'Manager', label: 'Folder Owner' },
  { value: 'QA', label: 'Quality' },
  { value: 'Admin', label: 'Full Access' },
];

// Rendered as checkmarked tags per role card, and as checkboxes in the Edit
// modal. Editing these changes real access — see RolePermissionsController /
// RBACMiddleware (view/download/upload/update) and ApprovalsController
// (approve/reject gate the QA and Manager decision endpoints).
const PERMISSION_KEYS = ['viewOnly', 'downloadReadOnly', 'upload', 'updatePermission', 'approve', 'reject', 'adminForceUnlock'] as const;
const PERMISSION_LABELS: Record<typeof PERMISSION_KEYS[number], string> = {
  viewOnly: 'View Only',
  downloadReadOnly: 'Download (Read-Only)',
  upload: 'Upload',
  updatePermission: 'Update',
  approve: 'Approve',
  reject: 'Reject',
  adminForceUnlock: 'Admin / Force-Unlock',
};

const ROLE_CARD_META: Record<string, { label: string; description: string }> = {
  Admin: { label: 'Full Access', description: 'Full access to all folders, documents, and admin settings' },
  QA: { label: 'Quality', description: 'Reviews documents at QA stages of the C-Doc workflow' },
  Writer: { label: 'Folder Member', description: 'Can view, download, and upload within assigned folders' },
  Manager: { label: 'Folder Owner', description: 'Owns the folder — same access as a member, plus deletion' },
};
const ROLE_CARD_ORDER = ['Admin', 'QA', 'Writer', 'Manager'];

const roleLabel = (role: string): string => ROLE_OPTIONS.find(r => r.value === role)?.label ?? role;

const getRoleBadge = (role: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  const map: Record<string, any> = {
    Admin: 'error',
    Manager: 'warning',
    QA: 'warning',
    Writer: 'info',
    Reader: 'default',
  };
  return map[role] || 'default';
};

export function RolePermissions() {
  const { showSuccess, showError } = useToast();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, RolePermission>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showGrantForm, setShowGrantForm] = useState(false);
  const [newGrant, setNewGrant] = useState({ folderId: '', userId: '', role: 'Writer' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [revokeConfirm, setRevokeConfirm] = useState<{ permissionId?: string; label?: string }>({});

  const [editingRole, setEditingRole] = useState<RolePermission | null>(null);
  const [editPermissions, setEditPermissions] = useState<Record<typeof PERMISSION_KEYS[number], boolean>>({
    viewOnly: false, downloadReadOnly: false, upload: false, updatePermission: false, approve: false, reject: false, adminForceUnlock: false,
  });
  const [isSavingRole, setIsSavingRole] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [foldersRes, usersRes, rolePermsRes] = await Promise.all([
        apiClient.getFolders(),
        apiClient.getUsers({ activeOnly: false }),
        apiClient.getRolePermissions(),
      ]);
      const folderList: Folder[] = foldersRes.data || [];
      const userList: UserLite[] = usersRes.data || [];
      setFolders(folderList);
      setUsers(userList);
      setRolePermissions(Object.fromEntries((rolePermsRes.data || []).map((rp: RolePermission) => [rp.role, rp])));

      const permissionsPerFolder = await Promise.all(
        folderList.map(f => apiClient.getFolderPermissions(f.folderId))
      );

      const flattened: PermissionGrant[] = permissionsPerFolder.flatMap((res, idx) =>
        (res.data || []).map((p: any) => ({
          permissionId: p.permissionId,
          folderId: folderList[idx].folderId,
          folderName: folderList[idx].name,
          userId: p.userId,
          userName: p.user?.fullName || 'Unknown user',
          role: p.role,
          grantedAt: p.grantedAt,
        }))
      );

      setGrants(flattened);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    grants.forEach(g => { counts[g.role] = (counts[g.role] || 0) + 1; });
    return counts;
  }, [grants]);

  const handleGrant = async () => {
    if (!newGrant.folderId || !newGrant.userId) {
      showError('Select a folder and a user');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.grantPermission(newGrant.folderId, newGrant.userId, newGrant.role);
      showSuccess('Permission granted');
      setShowGrantForm(false);
      setNewGrant({ folderId: '', userId: '', role: 'Writer' });
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to grant permission');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditRole = (role: RolePermission) => {
    setEditingRole(role);
    setEditPermissions({
      viewOnly: role.viewOnly,
      downloadReadOnly: role.downloadReadOnly,
      upload: role.upload,
      updatePermission: role.updatePermission,
      approve: role.approve,
      reject: role.reject,
      adminForceUnlock: role.adminForceUnlock,
    });
  };

  const handleSaveRolePermissions = async () => {
    if (!editingRole) return;
    setIsSavingRole(true);
    try {
      const res = await apiClient.updateRolePermission(editingRole.role, editPermissions);
      setRolePermissions((prev) => ({ ...prev, [editingRole.role]: res.data }));
      showSuccess(`${roleLabel(editingRole.role)} permissions updated`);
      setEditingRole(null);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update role permissions');
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeConfirm.permissionId) return;
    try {
      await apiClient.revokePermission(revokeConfirm.permissionId);
      showSuccess('Permission revoked');
      setRevokeConfirm({});
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to revoke permission');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Roles</h2>
        <SkeletonTable />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Roles</h2>
        <Card className="border-l-4 border-l-red-600">
          <CardBody>
            <p className="text-red-700 dark:text-red-400 font-medium">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={loadData}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Roles</h2>
        <p className="text-sm text-gray-500 dark:text-navy-400">Define roles and manage access permissions</p>
      </div>

      {/* Folder Permissions — shown first */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-serif font-bold tracking-tight text-navy-900 dark:text-white">Folder Permissions</h3>
          <Button
            variant="primary"
            size="sm"
            className="flex items-center gap-2"
            onClick={() => setShowGrantForm(true)}
            disabled={folders.length === 0 || users.length === 0}
          >
            <Plus className="w-4 h-4" />
            Grant Permission
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card className="border-l-4 border-l-navy-700">
            <CardBody className="text-center">
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Total Grants</p>
              <p className="text-3xl font-bold text-navy-900 dark:text-white mt-1">{grants.length}</p>
            </CardBody>
          </Card>
          <Card className="border-l-4 border-l-navy-700">
            <CardBody className="text-center">
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Folders</p>
              <p className="text-3xl font-bold text-navy-900 dark:text-white mt-1">{folders.length}</p>
            </CardBody>
          </Card>
          {ROLE_OPTIONS.map(r => (
            <Card key={r.value} className="border-l-4 border-l-navy-700">
              <CardBody className="text-center">
                <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{r.label}</p>
                <p className="text-3xl font-bold text-navy-900 dark:text-white mt-1">{roleCounts[r.value] || 0}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        {/* Grants Table */}
        <div className="overflow-hidden rounded-[5px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
          <table className="w-full text-sm bg-white dark:bg-navy-900">
            <thead className="border-b border-[#e2e8f0] bg-[#f7f9fc] dark:border-white/10 dark:bg-slate-950">
              <tr className="text-left text-xs uppercase text-[#64748b] dark:text-slate-400">
                <th className="px-6 py-4 font-semibold text-sm tracking-wide">Folder</th>
                <th className="px-6 py-4 font-semibold text-sm tracking-wide">User</th>
                <th className="px-6 py-4 font-semibold text-sm tracking-wide">Role</th>
                <th className="px-6 py-4 font-semibold text-sm tracking-wide">Granted</th>
                <th className="px-6 py-4 font-semibold text-sm tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-navy-800">
              {grants.length > 0 ? (
                grants.map((grant, idx) => (
                  <tr
                    key={grant.permissionId}
                    className={`${
                      idx % 2 === 0
                        ? 'bg-white dark:bg-navy-900'
                        : 'bg-gray-50 dark:bg-navy-950/60'
                    } hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
                  >
                    <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white">{grant.folderName}</td>
                    <td className="px-6 py-4 text-gray-700 dark:text-navy-200">{grant.userName}</td>
                    <td className="px-6 py-4">
                      <Badge status={getRoleBadge(grant.role)} size="sm" variant="outline">
                        {roleLabel(grant.role)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-700 dark:text-navy-200 text-sm">
                      {new Date(grant.grantedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setRevokeConfirm({ permissionId: grant.permissionId, label: `${grant.userName} on ${grant.folderName}` })}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                        title="Revoke permission"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-navy-400">
                    No folder permissions granted yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-serif font-bold tracking-tight text-navy-900 dark:text-white">Role Permissions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {ROLE_CARD_ORDER.map((roleValue) => {
            const meta = ROLE_CARD_META[roleValue];
            const permission = rolePermissions[roleValue];
            if (!permission) return null;
            return (
            <Card key={roleValue} className="overflow-hidden">
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-navy-800 dark:text-navy-300">
                      <Shield className="h-4 w-4" />
                    </span>
                    <h4 className="font-serif font-bold text-navy-900 dark:text-white">{meta.label}</h4>
                  </div>
                  <button
                    onClick={() => openEditRole(permission)}
                    className="p-1.5 hover:bg-gray-200 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                    title={`Edit ${meta.label} permissions`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-navy-400">{meta.description}</p>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-navy-500">Permissions</p>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_KEYS.map((key) => permission[key] && (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                      >
                        <Check className="h-3 w-3" />
                        {PERMISSION_LABELS[key]}
                      </span>
                    ))}
                    {PERMISSION_KEYS.every((key) => !permission[key]) && (
                      <span className="text-xs text-gray-400 dark:text-navy-500">No permissions</span>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
            );
          })}
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">How permissions work</h4>
        <p className="text-sm text-blue-800 dark:text-blue-400">
          Access is granted per folder, not as a global role. A user with no grant on a folder cannot see documents inside it.
          Folder Member can view, download, and upload; Folder Owner can also delete; Quality reviews documents at QA stages; Full Access can manage the folder itself.
        </p>
      </div>

      {/* Grant Permission Modal */}
      {showGrantForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Grant Permission</h3>
              <button onClick={() => setShowGrantForm(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Folder</label>
                <select
                  value={newGrant.folderId}
                  onChange={(e) => setNewGrant({ ...newGrant, folderId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Select a folder...</option>
                  {folders.map(f => (
                    <option key={f.folderId} value={f.folderId}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">User</label>
                <select
                  value={newGrant.userId}
                  onChange={(e) => setNewGrant({ ...newGrant, userId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Select a user...</option>
                  {users.map(u => (
                    <option key={u.userId} value={u.userId}>{u.fullName} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Role</label>
                <select
                  value={newGrant.role}
                  onChange={(e) => setNewGrant({ ...newGrant, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setShowGrantForm(false)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleGrant} isLoading={isSubmitting}>
                Grant
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {revokeConfirm.permissionId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Revoke Permission</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-gray-700 dark:text-gray-300">
                Revoke access for <span className="font-semibold text-navy-900 dark:text-blue-300">{revokeConfirm.label}</span>?
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setRevokeConfirm({})}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRevoke}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Role Permissions Modal */}
      {editingRole && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Edit {roleLabel(editingRole.role)} Permissions</h3>
              <button onClick={() => setEditingRole(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  This changes real access for every user holding this role on any folder — not just what's displayed.
                </p>
              </div>
              <div className="space-y-2">
                {PERMISSION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editPermissions[key]}
                      onChange={(e) => setEditPermissions((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-navy-200">{PERMISSION_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setEditingRole(null)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleSaveRolePermissions} isLoading={isSavingRole}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
