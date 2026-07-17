import { useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { Edit2, Trash2, Plus, Search, CheckCircle, XCircle, Users as UsersIcon, ShieldCheck, BookOpen } from 'lucide-react';

interface User {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  department?: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

const ROLE_OPTIONS = ['Admin', 'Manager', 'Writer', 'Reader'];

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([
    {
      userId: 'user-1',
      fullName: 'Ahmed Ali',
      email: 'ahmed@si-ware.com',
      role: 'Admin',
      department: 'Management',
      isActive: true,
      lastLogin: '2026-07-17T09:30:00Z',
      createdAt: '2026-01-15T00:00:00Z',
    },
    {
      userId: 'user-2',
      fullName: 'Sarah Johnson',
      email: 'sarah@si-ware.com',
      role: 'Manager',
      department: 'QMS',
      isActive: true,
      lastLogin: '2026-07-16T14:22:00Z',
      createdAt: '2026-01-20T00:00:00Z',
    },
    {
      userId: 'user-3',
      fullName: 'Mohammed Anwar',
      email: 'mohamm@si-ware.com',
      role: 'Writer',
      department: 'Compliance',
      isActive: true,
      lastLogin: '2026-07-15T11:00:00Z',
      createdAt: '2026-02-01T00:00:00Z',
    },
    {
      userId: 'user-4',
      fullName: 'Lisa Chen',
      email: 'lisa@si-ware.com',
      role: 'Writer',
      department: 'HR',
      isActive: true,
      lastLogin: '2026-07-17T08:15:00Z',
      createdAt: '2026-02-10T00:00:00Z',
    },
    {
      userId: 'user-5',
      fullName: 'John Davis',
      email: 'john@si-ware.com',
      role: 'Reader',
      department: 'IT',
      isActive: false,
      createdAt: '2026-03-05T00:00:00Z',
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<User>>({});

  const filteredUsers = users.filter(u =>
    u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (user: User) => {
    setEditingId(user.userId);
    setEditData({ ...user });
  };

  const handleSave = () => {
    if (editingId) {
      setUsers(users.map(u =>
        u.userId === editingId
          ? { ...u, role: editData.role || u.role, department: editData.department || u.department, isActive: editData.isActive ?? u.isActive }
          : u
      ));
      setEditingId(null);
      setEditData({});
    }
  };

  const handleDelete = (userId: string) => {
    setUsers(users.filter(u => u.userId !== userId));
  };

  const getRoleColor = (role: string) => {
    const map: Record<string, any> = {
      'Admin': 'error',
      'Manager': 'warning',
      'Writer': 'info',
      'Reader': 'default',
    };
    return map[role] || 'default';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-navy-900 dark:text-white">User Management</h2>
        <Button variant="primary" size="sm" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Total Users
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{users.length}</p>
            </div>
            <UsersIcon className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Active
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{users.filter(u => u.isActive).length}</p>
            </div>
            <CheckCircle className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Admins
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{users.filter(u => u.role === 'Admin').length}</p>
            </div>
            <ShieldCheck className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Readers
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{users.filter(u => u.role === 'Reader').length}</p>
            </div>
            <BookOpen className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm">
        <table className="w-full text-sm bg-white dark:bg-navy-800">
          <thead className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900">
            <tr className="text-left text-white">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Name</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Email</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Role</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Department</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Status</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Last Login</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-700">
            {filteredUsers.map((user, idx) => (
              <tr
                key={user.userId}
                className={`${
                  idx % 2 === 0
                    ? 'bg-white dark:bg-navy-800'
                    : 'bg-gray-50 dark:bg-navy-850'
                } hover:bg-gray-100 dark:hover:bg-navy-700/50 transition-colors`}
              >
                <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white">
                  {user.fullName}
                </td>
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                  {user.email}
                </td>
                <td className="px-6 py-4">
                  {editingId === user.userId ? (
                    <select
                      value={editData.role || user.role}
                      onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                      className="px-3 py-1 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white text-sm"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge status={getRoleColor(user.role)} size="sm" variant="outline">
                      {user.role}
                    </Badge>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                  {editingId === user.userId ? (
                    <input
                      type="text"
                      value={editData.department || user.department || ''}
                      onChange={(e) => setEditData({ ...editData, department: e.target.value })}
                      className="px-3 py-1 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white text-sm"
                    />
                  ) : (
                    user.department || '-'
                  )}
                </td>
                <td className="px-6 py-4">
                  {editingId === user.userId ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editData.isActive ?? user.isActive}
                        onChange={(e) => setEditData({ ...editData, isActive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-green-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      {user.isActive ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-green-700 dark:text-green-400 font-medium">Active</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-red-600" />
                          <span className="text-red-700 dark:text-red-400 font-medium">Inactive</span>
                        </>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-sm">
                  {user.lastLogin
                    ? new Date(user.lastLogin).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : 'Never'}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
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
                          className="px-3 py-1 bg-gray-300 hover:bg-gray-400 dark:bg-navy-600 dark:hover:bg-navy-500 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
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
                        <button
                          onClick={() => handleDelete(user.userId)}
                          className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12 bg-gray-50 dark:bg-navy-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400">No users found</p>
        </div>
      )}
    </div>
  );
}
