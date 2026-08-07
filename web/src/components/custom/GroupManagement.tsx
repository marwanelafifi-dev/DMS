import { useEffect, useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Edit2, Network, Plus, Trash2, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

interface Group {
  groupId: string;
  name: string;
  description: string | null;
  memberCount: number;
  subgroupCount: number;
  createdAt: string;
}

interface GroupMember {
  groupMemberId: string;
  userId: string;
  userName: string;
  userEmail: string;
  addedAt: string;
}

interface Subgroup {
  groupSubgroupId: string;
  childGroupId: string;
  childGroupName: string;
  addedAt: string;
}

interface UserLite {
  userId: string;
  fullName: string;
  email: string;
}

export function GroupManagement() {
  const { showSuccess, showError } = useToast();

  const [groups, setGroups] = useState<Group[]>([]);
  const [allUsers, setAllUsers] = useState<UserLite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editData, setEditData] = useState({ name: '', description: '' });

  const [deleteConfirm, setDeleteConfirm] = useState<{ groupId?: string; name?: string }>({});

  const [membersFor, setMembersFor] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [addMemberUserId, setAddMemberUserId] = useState('');

  const [subgroupsFor, setSubgroupsFor] = useState<Group | null>(null);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [isLoadingSubgroups, setIsLoadingSubgroups] = useState(false);
  const [addSubgroupId, setAddSubgroupId] = useState('');

  const loadGroups = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [groupsRes, usersRes] = await Promise.all([
        apiClient.getGroups(),
        apiClient.getUsers({ activeOnly: false }),
      ]);
      setGroups(groupsRes.data || []);
      setAllUsers(usersRes.data || []);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  const handleCreateGroup = async () => {
    if (!newGroup.name.trim()) {
      showError('Group name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.createGroup({ name: newGroup.name.trim(), description: newGroup.description.trim() || undefined });
      showSuccess('Group created');
      setShowAddForm(false);
      setNewGroup({ name: '', description: '' });
      loadGroups();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = (group: Group) => {
    setEditingGroup(group);
    setEditData({ name: group.name, description: group.description || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingGroup) return;
    if (!editData.name.trim()) {
      showError('Group name is required');
      return;
    }
    try {
      await apiClient.updateGroup(editingGroup.groupId, { name: editData.name.trim(), description: editData.description.trim() });
      showSuccess('Group updated');
      setEditingGroup(null);
      loadGroups();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update group');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm.groupId) return;
    try {
      await apiClient.deleteGroup(deleteConfirm.groupId);
      showSuccess('Group deleted');
      setDeleteConfirm({});
      loadGroups();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete group');
    }
  };

  const openMembers = async (group: Group) => {
    setMembersFor(group);
    setAddMemberUserId('');
    setIsLoadingMembers(true);
    try {
      const res = await apiClient.getGroup(group.groupId);
      setMembers(res.data?.members || []);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to load group members');
      setMembers([]);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  const handleAddMember = async () => {
    if (!membersFor || !addMemberUserId) return;
    try {
      const res = await apiClient.addGroupMember(membersFor.groupId, addMemberUserId);
      setMembers((prev) => [...prev, res.data]);
      setAddMemberUserId('');
      setGroups((prev) => prev.map((g) => g.groupId === membersFor.groupId ? { ...g, memberCount: g.memberCount + 1 } : g));
      showSuccess('User added to group');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to add user to group');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!membersFor) return;
    try {
      await apiClient.removeGroupMember(membersFor.groupId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      setGroups((prev) => prev.map((g) => g.groupId === membersFor.groupId ? { ...g, memberCount: Math.max(0, g.memberCount - 1) } : g));
      showSuccess('User removed from group');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to remove user from group');
    }
  };

  const openSubgroups = async (group: Group) => {
    setSubgroupsFor(group);
    setAddSubgroupId('');
    setIsLoadingSubgroups(true);
    try {
      const res = await apiClient.getGroup(group.groupId);
      setSubgroups(res.data?.subgroups || []);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to load subgroups');
      setSubgroups([]);
    } finally {
      setIsLoadingSubgroups(false);
    }
  };

  const handleAddSubgroup = async () => {
    if (!subgroupsFor || !addSubgroupId) return;
    try {
      const res = await apiClient.addSubgroup(subgroupsFor.groupId, addSubgroupId);
      setSubgroups((prev) => [...prev, res.data]);
      setAddSubgroupId('');
      setGroups((prev) => prev.map((g) => g.groupId === subgroupsFor.groupId ? { ...g, subgroupCount: g.subgroupCount + 1 } : g));
      showSuccess('Subgroup added');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to add subgroup');
    }
  };

  const handleRemoveSubgroup = async (childGroupId: string) => {
    if (!subgroupsFor) return;
    try {
      await apiClient.removeSubgroup(subgroupsFor.groupId, childGroupId);
      setSubgroups((prev) => prev.filter((s) => s.childGroupId !== childGroupId));
      setGroups((prev) => prev.map((g) => g.groupId === subgroupsFor.groupId ? { ...g, subgroupCount: Math.max(0, g.subgroupCount - 1) } : g));
      showSuccess('Subgroup removed');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to remove subgroup');
    }
  };

  const availableUsersToAdd = allUsers.filter((u) => !members.some((m) => m.userId === u.userId));
  // A group can't be nested inside itself or added twice — the backend also
  // rejects anything that would create a cycle, which this list can't check
  // client-side without fetching the whole nesting graph.
  const availableGroupsToNest = subgroupsFor
    ? groups.filter((g) => g.groupId !== subgroupsFor.groupId && !subgroups.some((s) => s.childGroupId === g.groupId))
    : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Groups</h2>
        <SkeletonTable />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Groups</h2>
        <Card className="border-l-4 border-l-red-600">
          <CardBody>
            <p className="text-red-700 dark:text-red-400 font-medium">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={loadGroups}>
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
          <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Groups</h2>
          <p className="text-sm text-gray-500 dark:text-navy-400">Organize users into named groups</p>
        </div>
        <Button variant="primary" size="sm" className="flex items-center gap-2" onClick={() => setShowAddForm(true)}>
          <Plus className="w-4 h-4" />
          Add Group
        </Button>
      </div>

      {/* Groups Table */}
      <div className="overflow-hidden rounded-[5px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
        <table className="w-full text-sm bg-white dark:bg-navy-900">
          <thead className="border-b border-[#e2e8f0] bg-[#f7f9fc] dark:border-white/10 dark:bg-slate-950">
            <tr className="text-left text-xs uppercase text-[#64748b] dark:text-slate-400">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Group Name</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Description</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Manage Users</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Manage Sub-groups</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Subgroups</th>
              <th className="px-6 py-4 text-center font-semibold text-sm tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-800">
            {groups.length > 0 ? (
              groups.map((group, idx) => (
                <tr
                  key={group.groupId}
                  className={`${idx % 2 === 0 ? 'bg-white dark:bg-navy-900' : 'bg-gray-50 dark:bg-navy-950/60'} hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
                >
                  <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white">{group.name}</td>
                  <td className="px-6 py-4 text-gray-600 dark:text-navy-300 max-w-xs truncate">{group.description || '—'}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => openMembers(group)} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                      Manage Users
                    </button>
                    <span className="ml-2 text-xs text-gray-400 dark:text-navy-500">({group.memberCount})</span>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => openSubgroups(group)} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                      Manage sub-groups
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-500 dark:text-navy-400 text-sm">
                    {group.subgroupCount > 0 ? `${group.subgroupCount} subgroup${group.subgroupCount !== 1 ? 's' : ''}` : 'Group currently has no subgroups.'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => openEdit(group)}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-navy-700 rounded-lg transition-colors text-blue-600 dark:text-blue-400"
                        title="Edit group"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ groupId: group.groupId, name: group.name })}
                        className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                        title="Delete group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-navy-400">
                  No groups yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Group Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Add Group</h3>
              <button onClick={() => setShowAddForm(false)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Group Name</label>
                <input
                  type="text"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  placeholder="e.g. Quality Assurance"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  rows={3}
                  placeholder="What is this group for?"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleCreateGroup} isLoading={isSubmitting}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Edit Group</h3>
              <button onClick={() => setEditingGroup(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Group Name</label>
                <input
                  type="text"
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  rows={3}
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setEditingGroup(null)}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <Button variant="primary" className="flex-1" onClick={handleSaveEdit}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Users Modal */}
      {membersFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Manage Users — {membersFor.name}</h3>
              <button onClick={() => setMembersFor(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex gap-2">
                <select
                  value={addMemberUserId}
                  onChange={(e) => setAddMemberUserId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Select a user to add...</option>
                  {availableUsersToAdd.map((u) => (
                    <option key={u.userId} value={u.userId}>{u.fullName} ({u.email})</option>
                  ))}
                </select>
                <Button variant="primary" size="sm" onClick={handleAddMember} disabled={!addMemberUserId}>
                  Add
                </Button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-navy-700">
                {isLoadingMembers ? (
                  <p className="p-4 text-sm text-gray-500 dark:text-navy-400">Loading members...</p>
                ) : members.length > 0 ? (
                  <ul className="divide-y divide-gray-200 dark:divide-navy-800">
                    {members.map((m) => (
                      <li key={m.groupMemberId} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="font-medium text-navy-900 dark:text-white text-sm">{m.userName}</p>
                          <p className="text-xs text-gray-500 dark:text-navy-400">{m.userEmail}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                          title="Remove from group"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-gray-500 dark:text-navy-400 text-center">No members in this group yet</p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700">
              <button
                onClick={() => setMembersFor(null)}
                className="w-full px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Sub-groups Modal */}
      {subgroupsFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-navy-900 text-white flex items-center justify-between">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white flex items-center gap-2">
                <Network className="w-4 h-4" /> Manage Sub-groups — {subgroupsFor.name}
              </h3>
              <button onClick={() => setSubgroupsFor(null)} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="flex gap-2">
                <select
                  value={addSubgroupId}
                  onChange={(e) => setAddSubgroupId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Select a group to nest inside this one...</option>
                  {availableGroupsToNest.map((g) => (
                    <option key={g.groupId} value={g.groupId}>{g.name}</option>
                  ))}
                </select>
                <Button variant="primary" size="sm" onClick={handleAddSubgroup} disabled={!addSubgroupId}>
                  Add
                </Button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-navy-700">
                {isLoadingSubgroups ? (
                  <p className="p-4 text-sm text-gray-500 dark:text-navy-400">Loading subgroups...</p>
                ) : subgroups.length > 0 ? (
                  <ul className="divide-y divide-gray-200 dark:divide-navy-800">
                    {subgroups.map((s) => (
                      <li key={s.groupSubgroupId} className="flex items-center justify-between px-4 py-3">
                        <p className="font-medium text-navy-900 dark:text-white text-sm">{s.childGroupName}</p>
                        <button
                          onClick={() => handleRemoveSubgroup(s.childGroupId)}
                          className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-red-600 dark:text-red-400"
                          title="Remove subgroup"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-gray-500 dark:text-navy-400 text-center">Group currently has no subgroups.</p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700">
              <button
                onClick={() => setSubgroupsFor(null)}
                className="w-full px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.groupId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-serif font-bold tracking-tight text-white">Delete Group</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-gray-700 dark:text-gray-300">
                Delete <span className="font-semibold text-navy-900 dark:text-blue-300">"{deleteConfirm.name}"</span>? Its members are unaffected, but the group, its membership list, and any nesting it's part of will be gone.
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
