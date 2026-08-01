import { useEffect, useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Edit2, UserX, Plus, Search, CheckCircle, XCircle, X, KeyRound, Trash2, ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { apiClient, DEV_USER_ID, type PageAccessRole } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { roleLabel } from '../../utils/roleLabels';

const PAGE_SIZE = 10;

interface User {
  userId: string;
  fullName: string;
  email: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  authType: 'Google' | 'Local';
  isOnline: boolean;
  role: string | null;
  avatarUrl?: string | null;
}

const accessBadgeStyles: Record<string, string> = {
  Admin: 'border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-300',
  QA: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300',
  Manager: 'border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-300',
  Writer: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
  Reader: 'border-gray-300 text-gray-600 dark:border-navy-600 dark:text-navy-300',
  'No Access': 'border-gray-200 text-gray-400 dark:border-navy-700 dark:text-navy-500',
};

export function UserManagement() {
  const { showSuccess, showError } = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roles, setRoles] = useState<PageAccessRole[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ fullName: string; isActive: boolean; role: string }>({ fullName: '', isActive: true, role: '' });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deactivateConfirm, setDeactivateConfirm] = useState<{ userId?: string; fullName?: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ userId?: string; fullName?: string }>({});
  const [resetPasswordFor, setResetPasswordFor] = useState<{ userId?: string; fullName?: string }>({});
  const [newPassword, setNewPassword] = useState('');

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadUsers = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [pageRes, allRes, rolesRes] = await Promise.all([
        apiClient.getUsers({ activeOnly: false, page: targetPage, pageSize: PAGE_SIZE }),
        apiClient.getUsers({ activeOnly: false }),
        apiClient.getPageAccessRoles(),
      ]);
      setUsers(pageRes.data || []);
      setTotalCount(pageRes.totalCount ?? pageRes.data?.length ?? 0);
      setTotalPages(pageRes.totalPages ?? 1);
      setAllUsers(allRes.data || []);
      setRoles(rolesRes.data || []);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filteredUsers = users.filter(u =>
    u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = allUsers.filter(u => u.isActive).length;
  const inactiveCount = allUsers.filter(u => !u.isActive).length;
  const onlineCount = allUsers.filter(u => u.isOnline).length;
  const offlineCount = allUsers.length - onlineCount;

  const handleEdit = (user: User) => {
    setEditingId(user.userId);
    setEditData({ fullName: user.fullName, isActive: user.isActive, role: user.role ?? '' });
  };

  const handleSave = async () => {
    if (!editingId) return;
    const user = users.find(u => u.userId === editingId);
    try {
      await apiClient.updateUser(editingId, { fullName: editData.fullName, isActive: editData.isActive });
      if (editData.role !== (user?.role ?? '')) {
        await apiClient.updateUserRole(editingId, editData.role || null);
      }
      showSuccess('User updated');
      setEditingId(null);
      loadUsers();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update user');
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.email.trim() || !newUser.fullName.trim()) {
      showError('Full name and email are required');
      return;
    }
    if (!newUser.password || newUser.password.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.createUser(newUser);
      showSuccess('User created');
      setShowAddForm(false);
      setNewUser({ fullName: '', email: '', password: '' });
      loadUsers();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateConfirm.userId) return;
    try {
      await apiClient.deactivateUser(deactivateConfirm.userId);
      showSuccess('User deactivated');
      setDeactivateConfirm({});
      loadUsers();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to deactivate user');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm.userId) return;
    try {
      await apiClient.deleteUserPermanently(deleteConfirm.userId);
      showSuccess('User deleted');
      setDeleteConfirm({});
      loadUsers();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resetPasswordFor.userId) return;
    if (!newPassword || newPassword.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }
    try {
      await apiClient.resetPassword(resetPasswordFor.userId, newPassword);
      showSuccess('Password reset');
      setResetPasswordFor({});
      setNewPassword('');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to reset password');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Users</h2>
        </div>
        <SkeletonTable />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Users</h2>
        <Card className="border-l-4 border-l-red-600">
          <CardBody>
            <p className="text-red-700 dark:text-red-400 font-medium">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => loadUsers(page)}>
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Users</h2>
          <p className="text-sm text-gray-500 dark:text-navy-400">Manage platform users and their access</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="p-4">
            <p className="text-gray-600 dark:text-gray-300 text-xs mb-1 font-semibold">Total Users</p>
            <p className="text-3xl font-bold text-navy-900 dark:text-white">{allUsers.length}</p>
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="p-4">
            <p className="text-gray-600 dark:text-gray-300 text-xs mb-1 font-semibold">Active</p>
            <p className="text-3xl font-bold text-navy-900 dark:text-white">{activeCount}</p>
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="p-4">
            <p className="text-gray-600 dark:text-gray-300 text-xs mb-1 font-semibold">Inactive</p>
            <p className="text-3xl font-bold text-navy-900 dark:text-white">{inactiveCount}</p>
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5">
          <CardBody className="p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" /> Online Now
            </p>
            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">{onlineCount}</p>
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-gray-300">
          <CardBody className="p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-navy-400">
              <Circle className="h-2 w-2 fill-gray-400 text-gray-400" /> Offline
            </p>
            <p className="text-3xl font-bold text-gray-500 dark:text-navy-300">{offlineCount}</p>
          </CardBody>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-[5px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
        <table className="w-full text-sm bg-white dark:bg-navy-900">
          <thead className="border-b border-[#e2e8f0] bg-[#f7f9fc] dark:border-white/10 dark:bg-slate-950">
            <tr className="text-left text-xs uppercase text-[#64748b] dark:text-slate-400">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">User</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Access</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Auth Type</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Status</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Session</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Joined</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-800">
            {filteredUsers.map((user, idx) => (
              <tr
                key={user.userId}
                className={`${
                  idx % 2 === 0
                    ? 'bg-white dark:bg-navy-900'
                    : 'bg-gray-50 dark:bg-navy-950/60'
                } hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.fullName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover shadow-sm flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-navy-700 flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
                        {user.fullName?.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      {editingId === user.userId ? (
                        <input
                          type="text"
                          value={editData.fullName}
                          onChange={(e) => setEditData({ ...editData, fullName: e.target.value })}
                          className="px-3 py-1 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-950 text-navy-900 dark:text-white text-sm w-full"
                        />
                      ) : (
                        <p className="font-semibold text-navy-900 dark:text-white truncate">{user.fullName}</p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-navy-400 truncate">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {editingId === user.userId ? (
                    user.userId === DEV_USER_ID ? (
                      <span
                        className="text-sm text-gray-400 dark:text-navy-500 cursor-not-allowed"
                        title="You cannot change your own role"
                      >
                        {roleLabel(user.role ?? 'No Access')}
                      </span>
                    ) : (
                      <select
                        value={editData.role}
                        onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                        className="px-2 py-1 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-950 text-navy-900 dark:text-white text-sm"
                      >
                        <option value="">No Access</option>
                        {roles.map(r => (
                          <option key={r.role} value={r.role}>{roleLabel(r.role)}</option>
                        ))}
                      </select>
                    )
                  ) : (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${accessBadgeStyles[user.role ?? 'No Access'] ?? accessBadgeStyles['No Access']}`}>
                      {roleLabel(user.role ?? 'No Access')}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    user.authType === 'Google'
                      ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400'
                      : 'border-gray-300 text-gray-600 dark:border-navy-600 dark:text-navy-300'
                  }`}>
                    {user.authType}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {editingId === user.userId ? (
                    <label
                      className={`flex items-center gap-2 ${user.userId === DEV_USER_ID ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      title={user.userId === DEV_USER_ID ? 'You cannot deactivate your own account' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={editData.isActive}
                        disabled={user.userId === DEV_USER_ID}
                        onChange={(e) => setEditData({ ...editData, isActive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-green-600 disabled:cursor-not-allowed"
                      />
                      <span className="text-sm text-gray-700 dark:text-navy-200">Active</span>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      {user.isActive ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                          <span className="text-green-700 dark:text-green-400 font-medium">Active</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                          <span className="text-red-700 dark:text-red-400 font-medium">Inactive</span>
                        </>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${user.isOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-400 dark:text-navy-500'}`}>
                    <Circle className={`h-2 w-2 ${user.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-gray-300 text-gray-300 dark:fill-navy-600 dark:text-navy-600'}`} />
                    {user.isOnline ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-700 dark:text-navy-200 text-sm whitespace-nowrap">
                  {new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-start gap-2">
                    {editingId === user.userId ? (
                      <>
                        <button
                          onClick={handleSave}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 bg-gray-300 hover:bg-gray-400 dark:bg-black/40 dark:hover:bg-black/60 dark:border dark:border-white/10 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEdit(user)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {user.authType !== 'Google' && (
                          <button
                            onClick={() => setResetPasswordFor({ userId: user.userId, fullName: user.fullName })}
                            className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                            title="Reset password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        )}
                        {user.isActive && user.userId !== DEV_USER_ID && (
                          <button
                            onClick={() => setDeactivateConfirm({ userId: user.userId, fullName: user.fullName })}
                            className="p-2 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors text-amber-600 dark:text-amber-400"
                            title="Deactivate user"
                          >
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                        {user.isActive && user.userId === DEV_USER_ID && (
                          <span
                            className="p-2 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                            title="You cannot deactivate your own account"
                          >
                            <UserX className="w-4 h-4" />
                          </span>
                        )}
                        {user.userId !== DEV_USER_ID && (
                          <button
                            onClick={() => setDeleteConfirm({ userId: user.userId, fullName: user.fullName })}
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                            title="Delete user permanently"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {user.userId === DEV_USER_ID && (
                          <span
                            className="p-2 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                            title="You cannot delete your own account"
                          >
                            <Trash2 className="w-4 h-4" />
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50 dark:bg-navy-950/60 border-t border-gray-200 dark:border-navy-800">
          <p className="text-sm text-gray-600 dark:text-navy-400">
            Page <span className="font-semibold text-navy-900 dark:text-white">{page}</span> of{' '}
            <span className="font-semibold text-navy-900 dark:text-white">{totalPages}</span>
            {' '}&mdash; {totalCount} total users
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg text-navy-600 dark:text-navy-300 hover:bg-navy-100 dark:hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg text-navy-600 dark:text-navy-300 hover:bg-navy-100 dark:hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12 bg-gray-50 dark:bg-navy-900 rounded-lg border border-transparent dark:border-navy-700/60">
          <p className="text-gray-500 dark:text-navy-400">No users found</p>
        </div>
      )}

      {/* Add User Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Add User</h3>
              <button onClick={() => setShowAddForm(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newUser.fullName}
                  onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="jane@si-ware.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Password</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="At least 8 characters"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-navy-400">This user will log in with this email and password on the DMS login page.</p>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleCreateUser}
                isLoading={isSubmitting}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation Modal */}
      {deactivateConfirm.userId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Deactivate User</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                Deactivate <span className="font-semibold text-navy-900 dark:text-blue-300">"{deactivateConfirm.fullName}"</span>? They will no longer be able to sign in, but their history is preserved.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setDeactivateConfirm({})}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeactivate}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.userId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Delete User Permanently</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p className="text-gray-700 dark:text-gray-300">
                Permanently delete <span className="font-semibold text-navy-900 dark:text-blue-300">"{deleteConfirm.fullName}"</span>?
              </p>
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                This cannot be undone. If this user still owns documents, tasks, or e-signatures, the deletion will be rejected — deactivate them instead in that case.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setDeleteConfirm({})}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPasswordFor.userId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Reset Password</h3>
              <button onClick={() => { setResetPasswordFor({}); setNewPassword(''); }} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-gray-700 dark:text-gray-300 text-sm">
                Set a new password for <span className="font-semibold text-navy-900 dark:text-blue-300">"{resetPasswordFor.fullName}"</span>.
              </p>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="At least 8 characters"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => { setResetPasswordFor({}); setNewPassword(''); }}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleConfirmResetPassword}>
                Reset Password
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
