import { useEffect, useState } from 'react';
import { Check, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../ui';
import { apiClient, type AccessOverride, type AccessOverrideFlags } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ModalOverlay } from '../ui/ModalOverlay';

type FieldDef = { key: keyof AccessOverrideFlags; label: string };

// Governs the folder object itself (rename the folder, cut/copy the folder,
// zip it, create subfolders inside it) — shown only when resourceKind is 'folder'.
const FOLDER_LEVEL_FIELDS: FieldDef[] = [
  { key: 'read', label: 'Read' },
  { key: 'write', label: 'Write' },
  { key: 'rename', label: 'Rename' },
  { key: 'copy', label: 'Copy' },
  { key: 'cut', label: 'Move' },
  { key: 'downloadZip', label: 'Download as ZIP' },
  { key: 'createSubfolder', label: 'Create Sub Folders' },
  { key: 'delete', label: 'Delete' },
  { key: 'managePermissions', label: 'Manage Permissions' },
  // The folder's OWN metadata (Description/Classification) — a distinct flag
  // from File Level's "Edit" (fileEdit), which governs a document's own
  // metadata instead. "Write" already covers uploading into the folder.
  { key: 'folderEdit', label: 'Edit' },
];

// Governs files — shown alone for the standalone File Permissions modal, or
// as a second section (cascading to every file inside it) in the Folder
// Permissions modal. "Write" is intentionally the same flag as Folder Level
// "Write", just labeled "Upload" here — the same real capability by design.
const FILE_LEVEL_FIELDS: FieldDef[] = [
  { key: 'fileCopy', label: 'Copy' },
  { key: 'fileCut', label: 'Move' },
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
  { key: 'fileManagePermissions', label: 'Manage Permissions' },
  { key: 'viewHistory', label: 'View Version History' },
  { key: 'viewRelatedTasks', label: 'View Related Tasks' },
  { key: 'viewMetadataHistory', label: 'View Metadata History' },
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

// Two columns instead of one long vertical stack — with up to 15 rows per
// section (Folder + File level combined can be 20+), a single column pushed
// the modal well past any reasonable viewport height.
function FieldGroup({ fields, values, onChange }: {
  fields: FieldDef[];
  values: AccessOverrideFlags;
  onChange: (key: keyof AccessOverrideFlags, next: boolean | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className="flex items-center gap-3">
          <span className="w-32 flex-shrink-0 text-sm text-gray-700 dark:text-navy-200">{f.label}</span>
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
  // Set only when resourceKind is 'folder' — shown as an always-on info row
  // so the owner's real, automatic access is visible without needing a
  // manual override entry to represent it (see AccessOverrideService.
  // ResolveAsync's OwnerExcludedActions for exactly what this grants).
  ownerName?: string;
  onClose: () => void;
}

export function AccessOverrideModal({ scope, resourceName, resourceKind, ownerName, onClose }: AccessOverrideModalProps) {
  const { showSuccess, showError } = useToast();
  // A folder-scoped override shows both sections (folder actions + cascaded
  // file actions); a file-scoped override only shows the file section. A few
  // flags (Write/Upload, Edit) intentionally appear in both field lists —
  // dedupe by key+label so only genuinely distinct labels (e.g. "Write" vs
  // "Upload" for the same flag) produce two badges, not an exact duplicate.
  const badgeFields = resourceKind === 'folder'
    ? Array.from(new Map([...FOLDER_LEVEL_FIELDS, ...FILE_LEVEL_FIELDS].map((f) => [`${f.key}:${f.label}`, f])).values())
    : FILE_LEVEL_FIELDS;

  const [overrides, setOverrides] = useState<AccessOverride[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [groups, setGroups] = useState<Array<{ groupId: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  // Normally saving reuses this modal's own `scope` prop — but an inherited
  // row (a folder-level File Level override, shown here only because it
  // cascades down) actually belongs to its own folder, not this file. Saving
  // it with this file's scope would either get rejected or silently create a
  // brand-new file-scoped override instead of updating the real one, so an
  // edit on an inherited row tracks and saves against its OWN folder scope.
  const [editingOverrideScope, setEditingOverrideScope] = useState<{ folderId?: string; documentId?: string }>(scope);
  const [targetType, setTargetType] = useState<'User' | 'Group'>('User');
  const [targetId, setTargetId] = useState('');
  const [flags, setFlags] = useState<AccessOverrideFlags>({});
  const [isSaving, setIsSaving] = useState(false);
  // Only relevant for a folder-scoped override, which has both sections —
  // a file-scoped override only ever has File Level fields, no tabs needed.
  const [activeLevel, setActiveLevel] = useState<'folder' | 'file'>('folder');

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
      const res = await apiClient.createAccessOverride({ ...editingOverrideScope, targetType, targetId, ...flags });
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
    setEditingOverrideScope(scope);
    setTargetId('');
    setTargetType('User');
    setFlags({});
    setActiveLevel('folder');
  };

  const handleEdit = (o: AccessOverride) => {
    setEditingOverrideId(o.overrideId);
    setEditingOverrideScope(o.inheritedFromFolder ? { folderId: o.folderId ?? undefined } : scope);
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
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-800">
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

          {resourceKind === 'folder' && ownerName && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              <span className="font-semibold">Owner: {ownerName}</span> — automatically has full access here, at both Folder Level and File Level, except Delete, Manage Permissions, Move, and (file level only) Unlock. This is automatic and doesn't need an override entry below.
            </div>
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
                      {o.inheritedFromFolder && (
                        <span className="ml-2 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300" title="Set from this file's folder's own Folder Permissions — cascades to every file in it">
                          Via folder
                        </span>
                      )}
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
                      <span key={`${f.key}:${f.label}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${o[f.key] ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'}`}>
                        {o[f.key] ? 'Allow' : 'Deny'} {f.label}
                      </span>
                    ))}
                  </div>
                  {o.inheritedFromFolder && (
                    <p className="mt-2 text-[11px] text-gray-400 dark:text-navy-500">Set at the folder level — editing or removing it here changes it for every file in this file's folder, not just this one.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddForm ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-navy-700">
              {editingOverrideId && (
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-500 dark:text-navy-400">
                  Editing permission
                  {editingOverrideScope.folderId && resourceKind === 'file' && ' — this is a folder-level permission; saving updates it for every file in the folder'}
                </p>
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

              {resourceKind === 'folder' ? (
                <div>
                  <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-navy-700">
                    <button
                      type="button"
                      onClick={() => setActiveLevel('folder')}
                      className={`px-3 py-2 text-sm font-medium transition-colors ${activeLevel === 'folder' ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-navy-400 dark:hover:text-navy-200'}`}
                    >
                      Folder Level
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLevel('file')}
                      className={`px-3 py-2 text-sm font-medium transition-colors ${activeLevel === 'file' ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-navy-400 dark:hover:text-navy-200'}`}
                    >
                      File Level
                    </button>
                  </div>
                  {activeLevel === 'folder' ? (
                    <FieldGroup
                      fields={FOLDER_LEVEL_FIELDS}
                      values={flags}
                      onChange={(key, next) => setFlags((prev) => ({ ...prev, [key]: next }))}
                    />
                  ) : (
                    <FieldGroup
                      fields={FILE_LEVEL_FIELDS}
                      values={flags}
                      onChange={(key, next) => setFlags((prev) => ({ ...prev, [key]: next }))}
                    />
                  )}
                </div>
              ) : (
                <FieldGroup
                  fields={FILE_LEVEL_FIELDS}
                  values={flags}
                  onChange={(key, next) => setFlags((prev) => ({ ...prev, [key]: next }))}
                />
              )}

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
    </ModalOverlay>
  );
}
