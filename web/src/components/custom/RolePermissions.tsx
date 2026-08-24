import { useEffect, useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { AlertCircle, Check, Edit2, Plus, Shield, Trash2, X } from 'lucide-react';
import { apiClient, type PageAccessRole } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ModalOverlay } from '../ui/ModalOverlay';

// Rendered as checkmarked tags per role card, and as checkboxes in the Edit
// modal. Editing these changes what a user assigned this role actually sees
// in the app — see PageAccessRolesController and the Sidebar/route guards
// that read it. This has nothing to do with file/folder actions (upload,
// delete, rename, etc.) — those are governed entirely by per-folder grants
// and File/Folder Permission overrides, set from the Document Library.
const PERMISSION_KEYS = [
  'canViewDashboard', 'canViewDocumentLibrary', 'canViewApprovals', 'canViewPcar', 'canViewReminders',
  'canDeleteReminders',
  'canSendAnnouncements', 'canViewAdminPanel',
  'canReadAllFolders', 'canReadWriteAllFolders', 'bypassFolderPermissions',
  'canManageFolderPermissions', 'canManageFilePermissions',
  'canCreateTasks', 'canReassignMyTasks', 'canReassignTasks', 'canManageAllTasks',
] as const;
const PERMISSION_LABELS: Record<typeof PERMISSION_KEYS[number], string> = {
  canViewDashboard: 'Dashboard',
  canViewDocumentLibrary: 'Document Library',
  canViewReminders: 'Reminders',
  canDeleteReminders: 'Delete Reminders',
  canViewApprovals: 'Approvals (Document Workflow)',
  canViewPcar: 'PCAR / Corrective Action',
  canViewAdminPanel: 'Admin Panel',
  bypassFolderPermissions: 'Full Access to All Folders',
  canReadAllFolders: 'Read Only to All Folders',
  canReadWriteAllFolders: 'Read and Write to All folders',
  canManageFolderPermissions: 'Manage Folder Permissions',
  canManageFilePermissions: 'Manage File Permissions',
  canManageAllTasks: 'Manage All Tasks / PCARs',
  canCreateTasks: 'Create New PCAR',
  canReassignMyTasks: 'Reassign My Tasks Only',
  canReassignTasks: 'Reassign All Tasks',
  canSendAnnouncements: 'Send Announcements',
};

// Scopes the Document Workflow page down to individual stage tabs (e.g. Manager
// only ever needed Stage 2) plus whether this role can actually act — approve
// or reject — on whichever stage it can see. Deliberately independent of any
// per-folder role grant or File/Folder Permission override, which govern
// file/folder management actions only. Shown as their own section below, both
// in the role card and the edit modal.
const STAGE_KEYS = [
  'canViewQaStage', 'canViewManagerStage', 'canViewFinalReleaseStage', 'canApprove', 'canReject', 'canResolveDocumentId',
] as const;
const STAGE_LABELS: Record<typeof STAGE_KEYS[number], string> = {
  canViewQaStage: 'QA Review (Stage 1)',
  canViewManagerStage: 'Manager Review (Stage 2)',
  canViewFinalReleaseStage: 'Final Release (Stage 3)',
  canApprove: 'Can Approve',
  canReject: 'Can Reject',
  canResolveDocumentId: 'Resolve Document ID (generate/enter at QA Triage)',
};

const ROLE_CARD_DESCRIPTIONS: Record<string, string> = {
  User: 'Everyday access to the Dashboard, Document Library, and Reminders',
  Manager: 'Everything a User sees, plus the Approvals (Document Workflow) page',
  Quality: 'Everything a User sees, plus the PCAR / Corrective Action page',
  Auditor: 'Everything a User sees, plus the PCAR / Corrective Action page',
  'Full Access': 'Sees every page, including the Admin Panel, and bypasses folder permissions entirely',
};
const ROLE_CARD_ORDER = ['Full Access', 'Manager', 'Quality', 'Auditor', 'User'];

const ALL_KEYS = [...PERMISSION_KEYS, ...STAGE_KEYS] as const;

const NEW_ROLE_FLAGS = PERMISSION_KEYS.map((key) => ({ key, label: PERMISSION_LABELS[key] }));
const NEW_ROLE_STAGE_FLAGS = STAGE_KEYS.map((key) => ({ key, label: STAGE_LABELS[key] }));

export function RolePermissions() {
  const { showSuccess, showError } = useToast();

  const [roles, setRoles] = useState<PageAccessRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const EMPTY_PERMISSIONS = Object.fromEntries(ALL_KEYS.map(k => [k, false])) as Record<typeof ALL_KEYS[number], boolean>;

  const [editingRole, setEditingRole] = useState<PageAccessRole | null>(null);
  const [editPermissions, setEditPermissions] = useState<Record<typeof ALL_KEYS[number], boolean>>(EMPTY_PERMISSIONS);
  const [editRoleName, setEditRoleName] = useState('');
  const [isSavingRole, setIsSavingRole] = useState(false);

  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [newRole, setNewRole] = useState({ role: '', ...EMPTY_PERMISSIONS, canViewDashboard: true, canViewDocumentLibrary: true, canViewReminders: true });
  const [isCreatingRole, setIsCreatingRole] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<{ role?: string }>({});
  const [isDeletingRole, setIsDeletingRole] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getPageAccessRoles();
      setRoles(res.data || []);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Built-in roles first, in a fixed order, followed by any custom roles
  // (alphabetically), so newly created roles always show up here.
  const orderedRoles = [
    ...ROLE_CARD_ORDER.map(name => roles.find(r => r.role === name)).filter((r): r is PageAccessRole => !!r),
    ...roles.filter(r => !ROLE_CARD_ORDER.includes(r.role)).sort((a, b) => a.role.localeCompare(b.role)),
  ];

  const openEditRole = (role: PageAccessRole) => {
    setEditingRole(role);
    setEditPermissions(Object.fromEntries(ALL_KEYS.map(k => [k, role[k]])) as Record<typeof ALL_KEYS[number], boolean>);
    setEditRoleName(role.role);
  };

  const handleSaveRole = async () => {
    if (!editingRole) return;
    const trimmedName = editRoleName.trim();
    const isRenaming = trimmedName !== editingRole.role;

    if (isRenaming && trimmedName.length < 2) {
      showError('Role name must be at least 2 characters');
      return;
    }

    setIsSavingRole(true);
    try {
      let currentName = editingRole.role;
      if (isRenaming) {
        await apiClient.renamePageAccessRole(currentName, trimmedName);
        currentName = trimmedName;
      }
      const res = await apiClient.updatePageAccessRole(currentName, editPermissions);
      setRoles((prev) => prev.map(r => r.role === editingRole.role ? res.data : r));
      showSuccess(`${currentName} access updated`);
      setEditingRole(null);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update role');
      loadData();
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRole.role.trim() || newRole.role.trim().length < 2) {
      showError('Role name must be at least 2 characters');
      return;
    }
    setIsCreatingRole(true);
    try {
      await apiClient.createPageAccessRole({ ...newRole, role: newRole.role.trim() });
      showSuccess('Role created');
      setShowNewRoleForm(false);
      setNewRole({ role: '', ...EMPTY_PERMISSIONS, canViewDashboard: true, canViewDocumentLibrary: true, canViewReminders: true });
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create role');
    } finally {
      setIsCreatingRole(false);
    }
  };

  const handleConfirmDeleteRole = async () => {
    if (!deleteConfirm.role) return;
    setIsDeletingRole(true);
    try {
      const res = await apiClient.deletePageAccessRole(deleteConfirm.role);
      showSuccess(res.message || 'Role deleted');
      setDeleteConfirm({});
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete role');
    } finally {
      setIsDeletingRole(false);
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Roles</h2>
          <p className="text-sm text-gray-500 dark:text-navy-400">Define which pages and features each role can see</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => setShowNewRoleForm(true)}
        >
          <Plus className="w-4 h-4" />
          New Role
        </Button>
      </div>

      {/* Role cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-serif font-bold tracking-tight text-navy-900 dark:text-white">Page &amp; Feature Access</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {orderedRoles.map((role) => {
            const description = ROLE_CARD_DESCRIPTIONS[role.role] ?? 'Custom role';
            const isDeletable = !role.isBuiltIn;
            return (
            <Card key={role.role} className="overflow-hidden">
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-navy-800 dark:text-navy-300">
                      <Shield className="h-4 w-4" />
                    </span>
                    <h4 className="font-serif font-bold text-navy-900 dark:text-white">{role.role}</h4>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditRole(role)}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                      title={`Edit ${role.role} access`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {isDeletable && (
                      <button
                        onClick={() => setDeleteConfirm({ role: role.role })}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                        title={`Delete ${role.role}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-500 dark:text-navy-400">{description}</p>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-navy-500">Can see</p>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_KEYS.map((key) => role[key] && (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                      >
                        <Check className="h-3 w-3" />
                        {PERMISSION_LABELS[key]}
                      </span>
                    ))}
                    {PERMISSION_KEYS.every((key) => !role[key]) && (
                      <span className="text-xs text-gray-400 dark:text-navy-500">No pages</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-navy-500">Document Workflow access</p>
                  <div className="flex flex-wrap gap-2">
                    {STAGE_KEYS.map((key) => role[key] ? (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                      >
                        <Check className="h-3 w-3" />
                        {STAGE_LABELS[key]}
                      </span>
                    ) : (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-400 dark:border-navy-700 dark:bg-navy-900 dark:text-navy-500"
                      >
                        {STAGE_LABELS[key]}
                      </span>
                    ))}
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
        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">How roles work</h4>
        <p className="text-sm text-blue-800 dark:text-blue-400">
          A role only controls which pages and features a user can see. It has no effect on what they can do to files or folders —
          that's set per folder or per file, for individual users or groups, from the Document Library.
        </p>
      </div>

      {/* New Role Modal */}
      {showNewRoleForm && (
        <ModalOverlay onClose={() => setShowNewRoleForm(false)} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-800">
            <div className="flex flex-shrink-0 items-center justify-between bg-navy-900 px-6 py-4 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">New Role</h3>
              <button onClick={() => setShowNewRoleForm(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Role Name</label>
                <input
                  type="text"
                  value={newRole.role}
                  onChange={(e) => setNewRole({ ...newRole, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="e.g. Inspector"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Can see</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {NEW_ROLE_FLAGS.map(flag => (
                    <label key={flag.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRole[flag.key]}
                        onChange={(e) => setNewRole({ ...newRole, [flag.key]: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-navy-200">{flag.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Document Workflow access</label>
                <div className="grid grid-cols-1 gap-2">
                  {NEW_ROLE_STAGE_FLAGS.map(flag => (
                    <label key={flag.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRole[flag.key]}
                        onChange={(e) => setNewRole({ ...newRole, [flag.key]: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-navy-200">{flag.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-navy-400">
                Once created, this role is immediately assignable to any user from the Users page.
              </p>
            </div>
            <div className="flex flex-shrink-0 gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-navy-700 dark:bg-navy-900">
              <button
                onClick={() => setShowNewRoleForm(false)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleCreateRole}
                isLoading={isCreatingRole}
              >
                Create Role
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Delete Role Confirmation Modal */}
      {deleteConfirm.role && (
        <ModalOverlay onClose={() => setDeleteConfirm({})} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Delete Role</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p className="text-gray-700 dark:text-gray-300">
                Delete <span className="font-semibold text-navy-900 dark:text-blue-300">"{deleteConfirm.role}"</span>?
              </p>
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                Any user currently assigned this role will be reset to No Access.
              </p>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setDeleteConfirm({})}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="danger" className="flex-1" onClick={handleConfirmDeleteRole} isLoading={isDeletingRole}>
                Delete
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Edit Role Modal */}
      {editingRole && (
        <ModalOverlay onClose={() => setEditingRole(null)} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-800">
            <div className="flex flex-shrink-0 items-center justify-between bg-navy-900 px-6 py-4 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Edit {editingRole.role} Access</h3>
              <button onClick={() => setEditingRole(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  This changes which pages every user assigned this role can see — not just what's displayed.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Role Name</label>
                <input
                  type="text"
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                />
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
              <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-navy-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-navy-500">Document Workflow access</p>
                {STAGE_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editPermissions[key]}
                      onChange={(e) => setEditPermissions((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-navy-200">{STAGE_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-shrink-0 gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-navy-700 dark:bg-navy-900">
              <button
                onClick={() => setEditingRole(null)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleSaveRole} isLoading={isSavingRole}>
                Save
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
