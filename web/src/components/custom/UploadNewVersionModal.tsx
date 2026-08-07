import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui';
import { X, AlertCircle, FileText } from 'lucide-react';
import { apiClient } from '../../utils/api';

const inputClass = 'w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';

function splitFileName(name: string): { base: string; ext: string } {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
}

interface UploadNewVersionModalProps {
  documentId: string;
  file: File;
  onClose: () => void;
  onUploaded: () => void;
}

// Uploading a new version was previously a single silent action (pick a
// file, it uploads immediately) — no chance to set a version label or touch
// the document's metadata. This collects both before the upload happens.
export function UploadNewVersionModal({ documentId, file, onClose, onUploaded }: UploadNewVersionModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const { ext: fileExtension } = splitFileName(file.name);
  const [fileNameBase, setFileNameBase] = useState(() => splitFileName(file.name).base);
  const [currentVersionDisplay, setCurrentVersionDisplay] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [docRes, categoryRes, departmentRes, tagRes] = await Promise.all([
          apiClient.getDocument(documentId),
          apiClient.getDropdownList('category'),
          apiClient.getDropdownList('department'),
          apiClient.getDropdownList('tag'),
        ]);
        if (cancelled) return;
        if (!docRes.success) throw new Error(docRes.error);
        const doc = docRes.data;
        setDescription(doc.description || '');
        setCategory(doc.category || '');
        setDepartment(doc.department || '');
        const versions: Array<{ versionId: string; versionNumber: string; versionLabel?: string | null }> = doc.versions || doc.Versions || [];
        const currentVersion = versions.find((v) => v.versionId === doc.currentVersionId);
        if (currentVersion) {
          setCurrentVersionDisplay(currentVersion.versionLabel ? `v${currentVersion.versionNumber} — ${currentVersion.versionLabel}` : `v${currentVersion.versionNumber}`);
        }
        setCategoryOptions((categoryRes.data || []).map((i: { label: string }) => i.label));
        setDepartmentOptions((departmentRes.data || []).map((i: { label: string }) => i.label));
        const fetchedTagOptions: string[] = (tagRes.data || []).map((i: { label: string }) => i.label);
        setTagOptions(fetchedTagOptions);

        // Pre-select whichever of the document's existing tags are known
        // presets — any that aren't (custom, ad-hoc tags) go into the "Other"
        // free-text field instead of being silently dropped, so the user can
        // add new tags or remove old ones without losing what's already there.
        const existingTags: string[] = doc.tags || [];
        const knownExisting = existingTags.filter((t) => fetchedTagOptions.includes(t));
        const unknownExisting = existingTags.filter((t) => !fetchedTagOptions.includes(t));
        setTags(unknownExisting.length > 0 ? [...knownExisting, 'OTHER'] : knownExisting);
        if (unknownExisting.length > 0) setCustomTags(unknownExisting.join(', '));
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || err.message || 'Failed to load document');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const isOtherTag = tags.includes('OTHER');
  const toggleTag = (value: string) => {
    setTags((current) => (current.includes(value) ? current.filter((t) => t !== value) : [...current, value]));
  };
  const tagList = [
    ...tags.filter((t) => t !== 'OTHER'),
    ...(isOtherTag ? customTags.split(',').map((t) => t.trim()).filter(Boolean) : []),
  ];

  const isFormValid = Boolean(
    versionLabel.trim()
    && description.trim()
    && category
    && department
    && fileNameBase.trim(),
  );

  const handleUpload = async () => {
    if (!isFormValid) {
      setError('Please fill in every field before uploading.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const finalFileName = `${fileNameBase.trim()}${fileExtension}`;
      const fileToUpload = finalFileName === file.name ? file : new File([file], finalFileName, { type: file.type });
      const uploadRes = await apiClient.uploadDocument(documentId, fileToUpload, versionLabel);
      if (!uploadRes.success) throw new Error(uploadRes.error);

      const updateRes = await apiClient.updateDocument(documentId, { description, tags: tagList, category, department });
      if (!updateRes.success) throw new Error(updateRes.error);

      onUploaded();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to upload the new version');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Upload New Version</h2>
            <p className="flex items-center gap-1.5 truncate text-sm text-gray-500 dark:text-slate-400"><FileText className="h-3.5 w-3.5 flex-shrink-0" />{file.name}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
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
              {currentVersionDisplay && (
                <p className="text-sm text-gray-500 dark:text-slate-400">Current version: <span className="font-medium text-navy-900 dark:text-white">{currentVersionDisplay}</span></p>
              )}
              <Field label="File Name" required>
                <div className="flex items-center overflow-hidden rounded border border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-800">
                  <input
                    value={fileNameBase}
                    onChange={(e) => setFileNameBase(e.target.value)}
                    className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-navy-900 outline-none dark:text-white"
                  />
                  {fileExtension && (
                    <span className="flex-shrink-0 whitespace-nowrap pr-3 text-sm text-gray-500 dark:text-slate-400">{fileExtension}</span>
                  )}
                </div>
              </Field>
              <Field label="New Version" required>
                <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. v2.0, Rev B" autoFocus className={inputClass} />
              </Field>
              <Field label="Description" required>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
              </Field>
              <Field label="Tags">
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded border border-gray-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
                  {tagOptions.length === 0 && (
                    <span className="px-1 py-0.5 text-xs text-gray-400 dark:text-slate-500">No tags configured yet</span>
                  )}
                  {tagOptions.map((t) => {
                    const isSelected = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        aria-pressed={isSelected}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-[#3f8bca] bg-[#3f8bca]/10 text-[#2b6ca3] dark:border-[#3f8bca] dark:bg-[#3f8bca]/20 dark:text-[#8fc4ea]'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-[#3f8bca]/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => toggleTag('OTHER')}
                    aria-pressed={isOtherTag}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isOtherTag
                        ? 'border-[#3f8bca] bg-[#3f8bca]/10 text-[#2b6ca3] dark:border-[#3f8bca] dark:bg-[#3f8bca]/20 dark:text-[#8fc4ea]'
                        : 'border-gray-300 bg-white text-gray-600 hover:border-[#3f8bca]/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    Other
                  </button>
                </div>
                {isOtherTag && (
                  <input
                    type="text"
                    value={customTags}
                    onChange={(e) => setCustomTags(e.target.value)}
                    placeholder="Specify tags, comma-separated..."
                    autoFocus
                    className={`mt-2 ${inputClass}`}
                  />
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Select any number of tags, or none.</p>
              </Field>
              <div className="grid grid-cols-2 gap-3">
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
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <Button onClick={handleUpload} disabled={isLoading || isSaving || !isFormValid} title={!isFormValid ? 'Please fill in every field' : undefined} className="flex-1">{isSaving ? 'Uploading…' : 'Upload New Version'}</Button>
          <Button onClick={onClose} disabled={isSaving} variant="secondary" className="flex-1">Cancel</Button>
        </div>
      </div>
    </div>
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
