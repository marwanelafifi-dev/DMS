import { useEffect, useState } from 'react';
import { X, AlertCircle, Download, Eye, History, RotateCcw } from 'lucide-react';
import { Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { formatDateTime, formatFileSize } from '../../utils/formatters';

interface VersionRow {
  versionId: string;
  versionNumber: string;
  versionLabel?: string | null;
  fileName: string;
  fileSizeBytes?: number | null;
  createdAt: string;
}

interface VersionHistoryModalProps {
  documentId: string;
  fileName: string;
  currentVersionId?: string | null;
  onClose: () => void;
  onReverted: () => void;
}

export function VersionHistoryModal({ documentId, fileName, currentVersionId, onClose, onReverted }: VersionHistoryModalProps) {
  const { showSuccess, showError } = useToast();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);

  const load = () => {
    setIsLoading(true);
    setError(null);
    apiClient.getDocument(documentId)
      .then((res) => {
        if (!res.success) throw new Error(res.error);
        setVersions(res.data?.versions || res.data?.Versions || []);
      })
      .catch((err: any) => setError(err?.response?.data?.error || err.message || 'Failed to load version history'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const handleDownload = async (versionId: string) => {
    setBusyVersionId(versionId);
    try {
      await apiClient.downloadDocument(documentId, versionId);
    } catch {
      showError('Failed to download this version');
    } finally {
      setBusyVersionId(null);
    }
  };

  // Opens the version's actual file content in a new tab (the browser renders
  // PDFs/images/text natively) — this reviews that exact past version without
  // making it current, unlike Revert.
  const handleReview = async (versionId: string) => {
    setBusyVersionId(versionId);
    try {
      const { blob } = await apiClient.getDocumentFile(documentId, versionId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showError('Failed to open this version for review');
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleRevert = async (versionId: string, versionNumber: string) => {
    setBusyVersionId(versionId);
    try {
      const res = await apiClient.revertDocumentVersion(documentId, versionId);
      if (!res.success) {
        showError(res.error || 'Failed to revert to this version');
        return;
      }
      showSuccess(`Reverted to version ${versionNumber}`);
      onReverted();
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to revert to this version');
    } finally {
      setBusyVersionId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white"><History className="h-5 w-5" /> Version History</h2>
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">{fileName}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No versions found.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => {
                const isCurrent = v.versionId === currentVersionId;
                const isBusy = busyVersionId === v.versionId;
                return (
                  <div key={v.versionId} className="flex items-center justify-between gap-3 rounded border border-gray-200 px-4 py-3 dark:border-slate-700">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-navy-900 dark:text-white">v{v.versionNumber}{v.versionLabel ? ` — ${v.versionLabel}` : ''}</span>
                        {isCurrent && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Current</span>}
                      </div>
                      <p className="truncate text-xs text-gray-500 dark:text-slate-400">{v.fileName} · {formatFileSize(v.fileSizeBytes ?? 0)} · {formatDateTime(v.createdAt)}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <button
                        onClick={() => handleReview(v.versionId)}
                        disabled={isBusy}
                        title="Review this version"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(v.versionId)}
                        disabled={isBusy}
                        title="Download this version"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      {!isCurrent && (
                        <button
                          onClick={() => handleRevert(v.versionId, v.versionNumber)}
                          disabled={isBusy}
                          title="Revert to this version"
                          className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <Button onClick={onClose} variant="secondary">Close</Button>
        </div>
      </div>
    </div>
  );
}
