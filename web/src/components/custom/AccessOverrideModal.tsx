import { useEffect, useState } from 'react';
import { Check, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../ui';
import { apiClient, type AccessOverride, type AccessOverrideFlags } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

type FieldDef = { key: keyof AccessOverrideFlags; label: string };

// Governs the folder object itself (rename the folder, cut/copy the folder,
// zip it, create subfolders inside it) — shown only when resourceKind is 'folder'.
const FOLDER_LEVEL_FIELDS: FieldDef[] = [
  { key: 'read', label: 'Read' },
  { key: 'write', label: 'Write' },
  { key: 'rename', label: 'Rename' },
  { key: 'copy', label: 'Copy' },
  { key: 'cut', label: 'Cut' },
  { key: 'downloadZip', label: 'Download as ZIP' },
  { key: 'createSubfolder', label: 'Create Sub Folders' },
  { key: 'delete', label: 'Delete' },
];

// Governs files — shown alone for the standalone File Permissions modal, or
// as a second section (cascading to every file inside it) in the Folder
// Permissions modal. "Write" is intentionally the same flag as Folder Level
// "Write", just labeled "Upload" here — the same real capability by design.
const FILE_LEVEL_FIELDS: FieldDef[] = [
  { key: 'fileCopy', label: 'Copy' },
  { key: 'fileCut', label: 'Cut' },
  { key: 'fileRename', label: 'Rename' },
  { key: 'fileRead', label: 'Read' },
  { key: 'unlock', label: 'Unlock' },
  { key: 'write', label: 'Upload' },
  { key: 'uploadUpdatedFile', label: 'Upload Updated File' },
  { key: 'submitForApproval', label: 'Submit for Approval' },
  { key: 'downloadForEditing', label: 'Download for Editing' },
  { key: 'download', label: 'Download' },
  { key: 'fileDelete', label: 'Delete' },
  { key: 'fileEdit', label: 'Edit' },
];

// Tri-state control: Inherit (no opinion, fall back to the role) / Allow / Deny.
function TriStateControl({ value, onChange }: { value: boolean | null | undefined; onChange: (next: boolean | null) => void }) {
  const state = value === true ? 'allow' : value === false ? 'deny' : 'inherit';
  const base = 'flex-1 inline-flex items-center justify-center gap-1 h-8 text-xs font-medium border first:rounded-l-[4px] last:rounded-r-[4px] -ml-px first:ml-0';
  return (
    <div className="flex w-full">
      <button type="button" onClick={() => onChange(null)} className={`${base} ${state === 'inherit' ? 'bg-gray-200 border-gray-300 text-gray-800 dark:bg-navy-700 dark:border-navy-600 dark:text-white' : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-navy-600 dark:text-navy-300 dark:hover:bg-navy-800'}`}>
        <Minus className="h-3 w-3" /> Inherit
      </button>
      <button type="button" onClick={() => onChange(true)} className={`${base} ${state === 'allow' ? 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-500/20 dark:border-emerald-700 dark:text-emerald-300' : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-navy-600 dark:text-navy-300 dark:hover:bg-navy-800'}`}>
        <Check className="h-3 w-3" /> Allow
      </button>
      <button type="button" onClick={() => onChange(false)} className={`${base} ${state === 'deny' ? 'bg-red-100 border-red-300 text-red-800 dark:bg-red-500/20 dark:border-red-700 dark:text-red-300' : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-navy-600 dark:text-navy-300 dark:hover:bg-navy-800'}`}>
        <X className="h-3 w-3" /> Deny
      </button>
    </div>
  );
}

function FieldGroup({ title, fields, values, onChange }: {
  title?: string;
  fields: FieldDef[];
  values: AccessOverrideFlags;
  onChange: (key: keyof AccessOverrideFlags, next: boolean | null) => void;
}) {
  return (
    <div className="space-y-2">
      {title && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-navy-400">{title}</p>}
      {fields.map((f) => (
        <div key={f.key} className="flex items-center gap-3">
          <span className="w-40 flex-shrink-0 text-sm text-gray-700 dark:text-navy-200">{f.label}</span>
          <TriStateControl value={values[f.key]} onChange={(next) => onChange(f.key, next)} />
        </div>
      ))}
    </div>
  );
}

interface AccessOverrideModalProps {
  scope: { folderId?: string; documentId?: string };
  resourceName: string;
  resourceKind: 'file' | 'folder';
  onClose: () => void;
}

export function AccessOverrideModal({ scope, resourceName, resourceKind, onClose }: AccessOverrideModalProps) {
  const { showSuccess, showError } = useToast();
  // A folder-scoped override shows both sections (folder actions + cascaded
  // file actions); a file-scoped override only shows the file section.
  const badgeFields = resourceKind === 'folder' ? [...FOLDER_LEVEL_FIELDS, ...FILE_LEVEL_FIELDS] : FILE_LEVEL_FIELDS;

  const [overrides, setOverrides] = useState<AccessOverride[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [groups, setGroups] = useState<Array<{ groupId: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'User' | 'Group'>('User');
  const [targetId, setTargetId] = useState('');
  const [flags, setFlags] = useState<AccessOverrideFlags>({});
  const [isSaving, setIsSaving] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [overridesRes, usersRes, groupsRes] = await Promise.all([
        apiClient.getAccessOverrides(scope),
        apiClient.getUsers({ activeOnly: false }),
        apiClient.getGroups(),
      ]);
      setOverrides(overridesRes.data || []);
      setUsers(usersRes.data || []);
      setGroups(groupsRes.data || []);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to load permissions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    if (!targetId) {
      showError(`Select a ${targetType === 'User' ? 'user' : 'group'}`);
      return;
    }
    setIsSaving(true);
    try {
      // The backend upserts on (scope, targetType, targetId), so editing an
      // existing override is the same call as creating one — it just
      // overwrites the flags in place instead of adding a duplicate.
      const res = await apiClient.createAccessOverride({ ...scope, targetType, targetId, ...flags });
      if (!res.success) {
        showError(res.error || 'Failed to save permission');
        return;
      }
      showSuccess(editingOverrideId ? 'Permission updated' : 'Permission saved');
      resetForm();
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save permission');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingOverrideId(null);
    setTargetId('');
    setTargetType('User');
    setFlags({});
  };

  const handleEdit = (o: AccessOverride) => {
    setEditingOverrideId(o.overrideId);
    setTargetType(o.targetType);
    setTargetId(o.targetId);
    setFlags(Object.fromEntries(badgeFields.map((f) => [f.key, o[f.key] ?? null])) as AccessOverrideFlags);
    setShowAddForm(true);
  };

  const handleDelete = async (overrideId: string) => {
    try {
      const res = await apiClient.deleteAccessOverride(overrideId);
      if (!res.success) {
        showError(res.error || 'Failed to remove permission');
        return;
      }
      showSuccess('Permission removed');
      loadData();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to remove permission');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-800">
        <div className="flex items-center justify-between bg-navy-900 px-6 py-4">
          <div>
            <h3 className="font-serif text-lg font-bold text-white">{resourceKind === 'file' ? 'File Permissions' : 'Folder Permissions'}</h3>
            <p className="text-xs text-navy-300 truncate">{resourceName}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[calc(85vh-72px)] overflow-y-auto px-6 py-4 space-y-4">
          {resourceKind === 'folder' && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              Folder Level Permissions govern this folder itself; File Level Permissions cascade to every file inside it (and every subfolder, unless a more specific override exists further down). A Deny always wins over an Allow from the same source; a direct grant to this user always wins over a conflicting group rule.
            </p>
          )}

          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-navy-400">Loading…</p>
          ) : (
            <div className="space-y-2">
              {overrides.length === 0 && !showAddForm && (
                <p className="text-sm text-gray-500 dark:text-navy-400">No special permissions set — everyone follows their normal role.</p>
              )}
              {overrides.map((o) => (
                <div key={o.overrideId} className="rounded-lg border border-gray-200 p-3 dark:border-navy-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-navy-900 dark:text-white">{o.targetName}</span>
                      <span className="ml-2 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500 dark:border-navy-600 dark:text-navy-400">{o.targetType}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit(o)} className="rounded p-1.5 text-navy-600 hover:bg-navy-100 dark:text-navy-300 dark:hover:bg-navy-700" title="Edit this permission">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(o.overrideId)} className="rounded p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30" title="Remove this override">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {badgeFields.filter((f) => o[f.key] !== null && o[f.key] !== undefined).map((f) => (
                      <span key={f.key} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${o[f.key] ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'}`}>
                        {o[f.key] ? 'Allow' : 'Deny'} {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAddForm ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-navy-700">
              {editingOverrideId && (
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-500 dark:text-navy-400">Editing permission</p>
              )}
              <div className="flex gap-2">
                <select disabled={!!editingOverrideId} value={targetType} onChange={(e) => { setTargetType(e.target.value as 'User' | 'Group'); setTargetId(''); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-navy-600 dark:bg-navy-900 dark:text-white">
                  <option value="User">User</option>
                  <option value="Group">Group</option>
                </select>
                <select disabled={!!editingOverrideId} value={targetId} onChange={(e) => setTargetId(e.target.value)} className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-navy-600 dark:bg-navy-900 dark:text-white">
                  <option value="">Select {targetType === 'User' ? 'a user' : 'a group'}...</option>
                  {targetType === 'User'
                    ? users.map((u) => <option key={u.userId} value={u.userId}>{u.fullName}</option>)
                    : groups.map((g) => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}
                </select>
              </div>

              {resourceKind === 'folder' && (
                <FieldGroup
                  title="Folder Level Permissions"
                  fields={FOLDER_LEVEL_FIELDS}
                  values={flags}
                  onChange={(key, next) => setFlags((prev) => ({ ...prev, [key]: next }))}
                />
              )}
              <FieldGroup
                title={resourceKind === 'folder' ? 'File Level Permissions' : undefined}
                fields={FILE_LEVEL_FIELDS}
                values={flags}
                onChange={(key, next) => setFlags((prev) => ({ ...prev, [key]: next }))}
              />

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={resetForm} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 dark:bg-navy-700 dark:text-white dark:hover:bg-navy-600">Cancel</button>
                <Button variant="primary" onClick={handleAdd} isLoading={isSaving}>Save</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" className="flex items-center gap-2" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" /> Add User or Group Permission
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
