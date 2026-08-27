import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui';
import { X, AlertCircle } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ModalOverlay } from '../ui/ModalOverlay';
import { TagSelector } from './TagSelector';

const inputClass = 'w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';

interface EditFolderModalProps {
  folderId: string;
  folderName: string;
  initialDescription?: string;
  initialDepartment?: string;
  initialTags?: string[];
  initialOwnerId?: string;
  onClose: () => void;
  onSaved: () => void;
}

// The folder's own metadata (Description/Department/Tags/Owner), distinct
// from renaming — gated on the separate "Edit" (FolderEdit) permission
// rather than "Rename".
export function EditFolderModal({
  folderId, folderName, initialDescription, initialDepartment, initialTags, initialOwnerId,
  onClose, onSaved,
}: EditFolderModalProps) {
  const [description, setDescription] = useState(initialDescription ?? '');
  const [department, setDepartment] = useState(initialDepartment ?? '');
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  const [ownerId, setOwnerId] = useState(initialOwnerId ?? '');
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string; role?: string | null; isActive?: boolean }>>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [usersRes, departmentRes, folderRes] = await Promise.all([
          apiClient.getUsers(),
          apiClient.getDropdownList('department'),
          apiClient.getFolder(folderId),
        ]);
        if (cancelled) return;
        setUsers(usersRes.data || []);
        setDepartmentOptions((departmentRes.data || []).map((i: { label: string }) => i.label));
        setManagerIds(folderRes.data?.managerIds || []);
      } catch {
        // Non-fatal — Department/Owner dropdowns just stay empty; Description/
        // Tags don't depend on either fetch.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [folderId]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiClient.updateFolderMetadata(folderId, { description, department, tags, ownerId: ownerId || undefined, managerIds });
      if (!res.success) throw new Error(res.error);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Edit Folder</h2>
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">{folderName}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} placeholder="What this folder is for…" />
          </Field>
          <Field label="Tags">
            <TagSelector value={tags} onChange={setTags} />
          </Field>
          <Field label="Department">
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} disabled={isLoading}>
              <option value="">Select…</option>
              {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Owner">
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass} disabled={isLoading}>
              <option value="">Select…</option>
              {users.map((u) => <option key={u.userId} value={u.userId}>{u.fullName}</option>)}
            </select>
          </Field>
          <Field label="Manager(s)">
            <div className="rounded border border-gray-300 p-2 dark:border-slate-600">
              <input
                value={managerSearch}
                onChange={(e) => setManagerSearch(e.target.value)}
                className={inputClass}
                placeholder="Search managers…"
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {users
                  .filter((u) => u.userId !== ownerId && u.isActive !== false && (u.role === 'Manager' || u.role === 'Full Access'))
                  .filter((u) => u.fullName.toLowerCase().includes(managerSearch.trim().toLowerCase()))
                  .map((u) => (
                    <label key={u.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={managerIds.includes(u.userId)}
                        onChange={(e) => setManagerIds((current) => e.target.checked
                          ? [...current, u.userId]
                          : current.filter((id) => id !== u.userId))}
                      />
                      {u.fullName}
                    </label>
                  ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Select one or more users with the Manager or Full Access role. The owner is included automatically.</p>
            </div>
          </Field>
        </div>

        <div className="flex gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <Button onClick={handleSave} disabled={isSaving} className="flex-1">{isSaving ? 'Saving…' : 'Save Changes'}</Button>
          <Button onClick={onClose} disabled={isSaving} variant="secondary" className="flex-1">Cancel</Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">{label}</label>
      {children}
    </div>
  );
}
