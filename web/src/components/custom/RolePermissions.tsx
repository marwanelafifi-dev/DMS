import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Plus, Trash2, X } from 'lucide-react';
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

// Matches HasPermissionForMethod() in api/Middleware/RBACMiddleware.cs
const ROLE_OPTIONS = ['Reader', 'Writer', 'Manager', 'QA', 'Admin'];

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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showGrantForm, setShowGrantForm] = useState(false);
  const [newGrant, setNewGrant] = useState({ folderId: '', userId: '', role: 'Reader' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [revokeConfirm, setRevokeConfirm] = useState<{ permissionId?: string; label?: string }>({});

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [foldersRes, usersRes] = await Promise.all([
        apiClient.getFolders(),
        apiClient.getUsers({ activeOnly: false }),
      ]);
      const folderList: Folder[] = foldersRes.data || [];
      const userList: UserLite[] = usersRes.data || [];
      setFolders(folderList);
      setUsers(userList);

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
      setNewGrant({ folderId: '', userId: '', role: 'Reader' });
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to grant permission');
    } finally {
      setIsSubmitting(false);
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
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Folder Permissions</h2>
        <SkeletonTable />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Folder Permissions</h2>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Folder Permissions</h2>
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="text-center">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Managers</p>
            <p className="text-3xl font-bold text-navy-900 dark:text-white mt-1">{roleCounts['Manager'] || 0}</p>
          </CardBody>
        </Card>
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="text-center">
            <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Readers</p>
            <p className="text-3xl font-bold text-navy-900 dark:text-white mt-1">{roleCounts['Reader'] || 0}</p>
          </CardBody>
        </Card>
      </div>

      {/* Grants Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm">
        <table className="w-full text-sm bg-white dark:bg-navy-800">
          <thead className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900">
            <tr className="text-left text-white">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Folder</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">User</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Role</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Granted</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-700">
            {grants.length > 0 ? (
              grants.map((grant, idx) => (
                <tr
                  key={grant.permissionId}
                  className={`${
                    idx % 2 === 0
                      ? 'bg-white dark:bg-navy-800'
                      : 'bg-gray-50 dark:bg-navy-850'
                  } hover:bg-gray-100 dark:hover:bg-navy-700/50 transition-colors`}
                >
                  <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white">{grant.folderName}</td>
                  <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{grant.userName}</td>
                  <td className="px-6 py-4">
                    <Badge status={getRoleBadge(grant.role)} size="sm" variant="outline">
                      {grant.role}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-sm">
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
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                  No folder permissions granted yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">How permissions work</h4>
        <p className="text-sm text-blue-800 dark:text-blue-400">
          Access is granted per folder, not as a global role. A user with no grant on a folder cannot see documents inside it.
          Reader can view/download, Writer can also upload/edit, Manager and above can also delete.
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
                    <option key={r} value={r}>{r}</option>
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
    </div>
  );
}
