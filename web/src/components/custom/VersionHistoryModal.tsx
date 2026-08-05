import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, ArrowLeft, Download, Eye, History, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { doclingApi } from '../../services/doclingApi';
import { MarkdownViewer } from './MarkdownViewer';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'xml', 'log', 'csv']);
// Word/PowerPoint render as a real PDF (LibreOffice via the OCR sidecar) —
// same pipeline the main Document Library preview already uses — so slide
// images/layout/fonts actually show up, not just a text dump. Docling's plain
// markdown conversion (which drops embedded images entirely, replacing them
// with a bare "<!-- image -->" placeholder) is only the fallback if the
// sidecar is unreachable or the PDF conversion itself fails.
const OFFICE_PDF_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx']);
const OFFICE_TEXT_EXTENSIONS = new Set(['xls', 'xlsx']);

type ReviewContent =
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'text' | 'markdown'; content: string };

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
  const [reviewing, setReviewing] = useState<{ versionLabel: string; content: ReviewContent } | null>(null);
  const reviewObjectUrlRef = useRef<string | null>(null);

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

  // Renders the version's actual content right in this modal — a real
  // preview (native for PDF/image/text, Docling-converted for Office
  // formats a browser tab can't render on its own), not just a raw file
  // dump. Reviews that exact past version without making it current, unlike
  // Revert.
  const handleReview = async (versionId: string, versionLabel: string) => {
    setBusyVersionId(versionId);
    try {
      const { blob, fileName: versionFileName } = await apiClient.getDocumentFile(documentId, versionId);
      const extension = versionFileName.split('.').pop()?.toLowerCase() ?? '';

      if (IMAGE_EXTENSIONS.has(extension) || extension === 'pdf') {
        const url = URL.createObjectURL(blob);
        reviewObjectUrlRef.current = url;
        setReviewing({ versionLabel, content: { kind: extension === 'pdf' ? 'pdf' : 'image', url } });
        return;
      }

      if (TEXT_EXTENSIONS.has(extension)) {
        const content = await blob.text();
        setReviewing({ versionLabel, content: { kind: 'text', content } });
        return;
      }

      const file = new File([blob], versionFileName, { type: blob.type });

      if (OFFICE_PDF_EXTENSIONS.has(extension)) {
        const sidecarAvailable = await doclingApi.isAvailable();
        if (sidecarAvailable) {
          try {
            const pdfBlob = await doclingApi.convertToPdf(file, versionFileName);
            const url = URL.createObjectURL(pdfBlob);
            reviewObjectUrlRef.current = url;
            setReviewing({ versionLabel, content: { kind: 'pdf', url } });
            return;
          } catch {
            // Falls through to the text-only extraction below.
          }
        }
        const converted = await doclingApi.convertDocument(file);
        setReviewing({ versionLabel, content: { kind: 'markdown', content: converted.content } });
        return;
      }

      if (OFFICE_TEXT_EXTENSIONS.has(extension)) {
        const converted = await doclingApi.convertDocument(file);
        setReviewing({ versionLabel, content: { kind: 'markdown', content: converted.content } });
        return;
      }

      // Unknown format — no in-browser way to render it, fall back to a download.
      await handleDownload(versionId);
    } catch {
      showError('Failed to open this version for review');
    } finally {
      setBusyVersionId(null);
    }
  };

  const closeReview = () => {
    if (reviewObjectUrlRef.current) {
      URL.revokeObjectURL(reviewObjectUrlRef.current);
      reviewObjectUrlRef.current = null;
    }
    setReviewing(null);
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
      <div className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900 ${reviewing ? 'max-w-4xl' : 'max-w-2xl'}`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="flex min-w-0 items-center gap-3">
            {reviewing && (
              <button onClick={closeReview} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Back to version list">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white">
                <History className="h-5 w-5" /> {reviewing ? `Reviewing ${reviewing.versionLabel}` : 'Version History'}
              </h2>
              <p className="truncate text-sm text-gray-500 dark:text-slate-400">{fileName}</p>
            </div>
          </div>
          <button onClick={reviewing ? closeReview : onClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {reviewing ? (
          <div className="flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-slate-950">
            {reviewing.content.kind === 'image' && (
              <img src={reviewing.content.url} alt={reviewing.versionLabel} className="mx-auto max-w-full rounded shadow" />
            )}
            {reviewing.content.kind === 'pdf' && (
              <iframe src={reviewing.content.url} title={reviewing.versionLabel} className="h-[70vh] w-full rounded border-0 bg-white" />
            )}
            {reviewing.content.kind === 'text' && (
              <pre className="whitespace-pre-wrap rounded border border-gray-200 bg-white p-4 text-sm text-navy-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">{reviewing.content.content}</pre>
            )}
            {reviewing.content.kind === 'markdown' && (
              <div className="rounded border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <MarkdownViewer content={reviewing.content.content} />
              </div>
            )}
          </div>
        ) : (
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
                        onClick={() => handleReview(v.versionId, `v${v.versionNumber}${v.versionLabel ? ` — ${v.versionLabel}` : ''}`)}
                        disabled={isBusy}
                        title="Review this version"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
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
        )}

        <div className="flex justify-end border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          {reviewing ? (
            <Button onClick={closeReview} variant="secondary">Back to Version List</Button>
          ) : (
            <Button onClick={onClose} variant="secondary">Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}
