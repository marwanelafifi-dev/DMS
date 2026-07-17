import { useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { Edit2, Save, X, Plus } from 'lucide-react';

interface Role {
  roleId: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'view_documents', label: 'View Documents', description: 'Read-only access to documents' },
  { id: 'download_documents', label: 'Download Documents', description: 'Download documents' },
  { id: 'upload_documents', label: 'Upload Documents', description: 'Create new documents' },
  { id: 'edit_documents', label: 'Edit Documents', description: 'Modify document content' },
  { id: 'delete_documents', label: 'Delete Documents', description: 'Remove documents' },
  { id: 'approve_documents', label: 'Approve Documents', description: 'Approve document submissions' },
  { id: 'manage_users', label: 'Manage Users', description: 'Create/edit/delete users' },
  { id: 'manage_roles', label: 'Manage Roles', description: 'Configure roles and permissions' },
  { id: 'view_audit', label: 'View Audit Trail', description: 'Access system logs' },
  { id: 'export_data', label: 'Export Data', description: 'Export system data' },
];

export function RolePermissions() {
  const [roles, setRoles] = useState<Role[]>([
    {
      roleId: 'role-1',
      name: 'Admin',
      description: 'Full system access',
      permissions: AVAILABLE_PERMISSIONS.map(p => p.id),
      userCount: 3,
    },
    {
      roleId: 'role-2',
      name: 'Manager',
      description: 'Can manage documents and approve submissions',
      permissions: ['view_documents', 'download_documents', 'upload_documents', 'edit_documents', 'approve_documents', 'view_audit'],
      userCount: 8,
    },
    {
      roleId: 'role-3',
      name: 'Writer',
      description: 'Can create and edit documents',
      permissions: ['view_documents', 'download_documents', 'upload_documents', 'edit_documents'],
      userCount: 15,
    },
    {
      roleId: 'role-4',
      name: 'Reader',
      description: 'Read-only access',
      permissions: ['view_documents', 'download_documents'],
      userCount: 42,
    },
  ]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Role>>({});

  const handleEdit = (role: Role) => {
    setEditingId(role.roleId);
    setEditData({ ...role });
  };

  const handleSave = () => {
    if (editingId && editData.name && editData.permissions) {
      setRoles(roles.map(r =>
        r.roleId === editingId
          ? {
              ...r,
              name: editData.name as string,
              description: editData.description || r.description,
              permissions: editData.permissions as string[]
            }
          : r
      ));
      setEditingId(null);
      setEditData({});
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditData({});
  };

  const togglePermission = (permissionId: string) => {
    if (!editData.permissions) return;

    if (editData.permissions.includes(permissionId)) {
      setEditData({
        ...editData,
        permissions: editData.permissions.filter(p => p !== permissionId),
      });
    } else {
      setEditData({
        ...editData,
        permissions: [...editData.permissions, permissionId],
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-navy-900 dark:text-white">Role-Based Access Control</h2>
        <Button variant="primary" size="sm" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Role
        </Button>
      </div>

      {/* Roles List */}
      <div className="grid gap-6">
        {roles.map((role) => (
          <Card key={role.roleId} className="border-l-4 border-blue-500">
            <CardBody>
              {editingId === role.roleId ? (
                // Edit Mode
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Role Name
                      </label>
                      <input
                        type="text"
                        value={editData.name || ''}
                        onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Description
                      </label>
                      <input
                        type="text"
                        value={editData.description || ''}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* Permissions Grid */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                      Permissions
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {AVAILABLE_PERMISSIONS.map((perm) => (
                        <label key={perm.id} className="flex items-center gap-3 p-3 border border-gray-200 dark:border-navy-700 rounded-lg hover:bg-gray-50 dark:hover:bg-navy-700/30 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editData.permissions?.includes(perm.id) || false}
                            onChange={() => togglePermission(perm.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white text-sm">{perm.label}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{perm.description}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSave}
                      className="flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Save Changes
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCancel}
                      className="flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                // View Mode
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-navy-900 dark:text-white mb-1">{role.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{role.description}</p>
                      <div className="inline-block bg-gray-100 dark:bg-navy-900 px-3 py-1 rounded-full text-xs font-medium text-gray-700 dark:text-gray-300">
                        {role.userCount} user{role.userCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleEdit(role)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                      title="Edit role"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Permissions Display */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Permissions ({role.permissions.length})</h4>
                    <div className="flex flex-wrap gap-2">
                      {role.permissions.map((permId) => {
                        const perm = AVAILABLE_PERMISSIONS.find(p => p.id === permId);
                        return (
                          <Badge key={permId} status="success" size="sm">
                            {perm?.label}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Permission Management</h4>
        <p className="text-sm text-blue-800 dark:text-blue-400">
          Roles define what actions users can perform. Edit roles to grant or revoke permissions. Built-in roles cannot be deleted.
        </p>
      </div>
    </div>
  );
}
