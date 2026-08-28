import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui';
import { X, AlertCircle } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ModalOverlay } from '../ui/ModalOverlay';
import { TagSelector } from './TagSelector';
import { clearDocumentEditDraft, readDocumentEditDraft, writeDocumentEditDraft } from '../../utils/documentEditDraft';

const inputClass = 'w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';

interface EditDocumentModalProps {
  documentId: string;
  fileName: string;
  onClose: () => void;
  onSaved: () => void;
}

// Splits "report.pdf" into { base: "report", extension: ".pdf" } — the
// extension stays fixed and un-editable in the form, same pattern as the
// upload dialog's rename-before-upload field, since changing it can make the
// file unreadable without also re-encoding the actual bytes.
function splitFileName(name: string): { base: string; extension: string } {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return { base: name, extension: '' };
  return { base: name.slice(0, lastDot), extension: name.slice(lastDot) };
}

export function EditDocumentModal({ documentId, fileName: initialFileName, onClose, onSaved }: EditDocumentModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitializedForm, setHasInitializedForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [canChangeOwner, setCanChangeOwner] = useState(false);

  const [fileNameBase, setFileNameBase] = useState('');
  const [fileNameExtension, setFileNameExtension] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [category, setCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [docRes, usersRes, categoryRes, departmentRes] = await Promise.all([
          apiClient.getDocument(documentId),
          apiClient.getUsers(),
          apiClient.getDropdownList('category'),
          apiClient.getDropdownList('department'),
        ]);
        if (cancelled) return;
        if (!docRes.success) throw new Error(docRes.error);
        const doc = docRes.data;
        const storedDraft = readDocumentEditDraft(documentId);
        const { base, extension } = splitFileName(doc.fileName || initialFileName);
        setFileNameBase(storedDraft?.fileNameBase ?? base);
        setFileNameExtension(storedDraft?.fileNameExtension ?? extension);
        setDescription(storedDraft?.description ?? doc.description ?? '');
        setVersionLabel(storedDraft?.versionLabel ?? doc.versionLabel ?? '');
        setCategory(storedDraft?.category ?? doc.category ?? '');
        setDepartment(storedDraft?.department ?? doc.department ?? '');
        setOwnerId(storedDraft?.ownerId ?? doc.ownerId ?? '');
        setUsers(usersRes.data || []);
        setCategoryOptions((categoryRes.data || []).map((i: { label: string }) => i.label));
        setDepartmentOptions((departmentRes.data || []).map((i: { label: string }) => i.label));
        setTags(storedDraft?.tags ?? doc.tags ?? []);
        if (doc.folderId) {
          const permissionsRes = await apiClient.getMyEffectivePermissions(doc.folderId, documentId);
          if (!cancelled) setCanChangeOwner(permissionsRes.data?.canChangeDocumentOwner === true);
        }
        if (!cancelled) setHasInitializedForm(true);

        // Any existing tag that isn't one of the known presets falls back into
        // the free-text "Other" field instead of being silently dropped —
        // same split as the main upload form's own multi-select.
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || err.message || 'Failed to load document');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    if (!hasInitializedForm) return;
    writeDocumentEditDraft(documentId, {
      fileNameBase,
      fileNameExtension,
      description,
      tags,
      versionLabel,
      category,
      department,
      ownerId,
    });
  }, [
    hasInitializedForm,
    documentId,
    fileNameBase,
    fileNameExtension,
    description,
    tags,
    versionLabel,
    category,
    department,
    ownerId,
  ]);

  // Tags is optional, per explicit request — matches the main upload form,
  // which never required it either.
  const isFormValid = Boolean(
    fileNameBase.trim()
    && description.trim()
    && versionLabel.trim()
    && category
    && department
    && ownerId,
  );

  const handleClose = () => {
    clearDocumentEditDraft(documentId);
    onClose();
  };

  const handleSave = async () => {
    if (!isFormValid) {
      setError('Please fill in every field before saving.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiClient.updateDocument(documentId, {
        fileName: `${fileNameBase.trim()}${fileNameExtension}`,
        description,
        tags,
        department,
        category,
        ownerId,
        versionLabel,
      });
      if (!res.success) throw new Error(res.error);
      onSaved();
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalOverlay onClose={handleClose} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Edit Document</h2>
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">{fileNameBase ? `${fileNameBase}${fileNameExtension}` : initialFileName}</p>
          </div>
          <button onClick={handleClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
          ) : (
            <>
              {error && (
                <div className="flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
                </div>
              )}
              <Field label="File Name" required>
                <div className="flex items-center gap-2">
                  <input value={fileNameBase} onChange={(e) => setFileNameBase(e.target.value)} className={inputClass} />
                  {fileNameExtension && <span className="flex-shrink-0 text-sm text-gray-500 dark:text-slate-400">{fileNameExtension}</span>}
                </div>
              </Field>
              <Field label="Description" required>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
              </Field>
              <Field label="Tags">
                <TagSelector value={tags} onChange={setTags} />
              </Field>
              <Field label="Version" required>
                <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. v1.0, Rev A" className={inputClass} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Category" required>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Department" required>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Owner" required>
                <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass} disabled={!canChangeOwner}>
                  <option value="">Select…</option>
                  {users.map((u) => <option key={u.userId} value={u.userId}>{u.fullName}</option>)}
                </select>
                {!canChangeOwner && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Only the current file owner or a Full Access user can change the document owner.</p>
                )}
              </Field>
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <Button onClick={handleSave} disabled={isLoading || isSaving || !isFormValid} title={!isFormValid ? 'Please fill in every field' : undefined} className="flex-1">{isSaving ? 'Saving…' : 'Save Changes'}</Button>
          <Button onClick={handleClose} disabled={isSaving} variant="secondary" className="flex-1">Cancel</Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
