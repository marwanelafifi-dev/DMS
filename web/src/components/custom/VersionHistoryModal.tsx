import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, ArrowLeft, Download, Eye, History, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { doclingApi } from '../../services/doclingApi';
import { MarkdownViewer } from './MarkdownViewer';
import { parseExcelDocument } from '../../utils/officeParser';
import type { SpreadsheetSheet } from '../../fixtures/documentLibrary';
import { ModalOverlay } from '../ui/ModalOverlay';
import { usePageAccess } from '../../hooks/usePageAccess';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'xml', 'log', 'csv']);
// Word/PowerPoint render as a real PDF (LibreOffice via the OCR sidecar) —
// same pipeline the main Document Library preview already uses — so slide
// images/layout/fonts actually show up, not just a text dump. Docling's plain
// markdown conversion (which drops embedded images entirely, replacing them
// with a bare "<!-- image -->" placeholder) is only the fallback if the
// sidecar is unreachable or the PDF conversion itself fails.
const OFFICE_PDF_EXTENSIONS = new Set([
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'rtf',
  'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'pps', 'ppsx', 'ppsm', 'ppam', 'odp',
]);
// Excel renders as a real spreadsheet grid (same parser the main Document
// Library preview uses) instead of Docling's flattened markdown pipe-table,
// which mangles multi-sheet workbooks and mislabels columns.
const OFFICE_SPREADSHEET_EXTENSIONS = new Set([
  'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'ods',
]);

type ReviewContent =
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'text' | 'markdown'; content: string }
  | { kind: 'spreadsheet'; sheets: SpreadsheetSheet[] };

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
  const pageAccess = usePageAccess();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ versionLabel: string; content: ReviewContent } | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [deleteCandidate, setDeleteCandidate] = useState<VersionRow | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
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
    setActiveSheetIndex(0);
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

      if (OFFICE_SPREADSHEET_EXTENSIONS.has(extension)) {
        const preview = await parseExcelDocument(blob, '');
        if (preview?.kind === 'spreadsheet') {
          setReviewing({ versionLabel, content: { kind: 'spreadsheet', sheets: preview.sheets } });
          return;
        }
        // Unparseable workbook — fall back to Docling's plain text extraction.
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

  const closeDeleteConfirmation = () => {
    setDeleteCandidate(null);
    setDeleteConfirmation('');
  };

  const handleDeleteVersion = async () => {
    if (!deleteCandidate || deleteConfirmation !== 'DELETE') return;
    setBusyVersionId(deleteCandidate.versionId);
    try {
      const res = await apiClient.deleteDocumentVersion(documentId, deleteCandidate.versionId);
      if (!res.success) {
        showError(res.error || 'Failed to delete this old version');
        return;
      }
      showSuccess(`Version ${deleteCandidate.versionNumber} deleted`);
      closeDeleteConfirmation();
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete this old version');
    } finally {
      setBusyVersionId(null);
    }
  };

  return (
    <>
    <ModalOverlay
      onClose={onClose}
      className={
        reviewing
          ? 'fixed inset-y-0 right-0 left-0 top-0 z-[80] overflow-hidden bg-black/50 lg:left-[286px]'
          : 'fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4'
      }
    >
      <div className={`flex h-full max-h-full w-full flex-col overflow-hidden bg-white shadow-xl dark:bg-slate-900 ${reviewing ? '' : 'max-h-[85vh] max-w-2xl rounded-lg'}`}>
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
              <iframe src={reviewing.content.url} title={reviewing.versionLabel} className="h-full w-full rounded border-0 bg-white" />
            )}
            {reviewing.content.kind === 'text' && (
              <pre className="whitespace-pre-wrap rounded border border-gray-200 bg-white p-4 text-sm text-navy-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">{reviewing.content.content}</pre>
            )}
            {reviewing.content.kind === 'markdown' && (
              <div className="rounded border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <MarkdownViewer content={reviewing.content.content} />
              </div>
            )}
            {reviewing.content.kind === 'spreadsheet' && (() => {
              const sheets = reviewing.content.sheets;
              const safeSheetIndex = Math.min(activeSheetIndex, sheets.length - 1);
              const activeSheet = sheets[safeSheetIndex];
              return (
                <div className="flex h-full w-full flex-col rounded border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-[#eff6f1] text-[#3f5e49] dark:bg-emerald-950/40 dark:text-emerald-100">
                        <tr>
                          {activeSheet.rowNumbers && (
                            <th className="sticky left-0 z-20 w-10 border-b border-r border-[#dbe2ec] bg-[#eff6f1] px-2 py-3 text-center font-semibold dark:border-white/10 dark:bg-emerald-950/40" />
                          )}
                          {activeSheet.columns.map((column) => (
                            <th key={column} className={`border-b border-r border-[#dbe2ec] px-4 py-3 font-semibold last:border-r-0 dark:border-white/10 ${activeSheet.rowNumbers ? 'text-center' : ''}`}>
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeSheet.rows.map((row, rowIndex) => (
                          <tr key={row.join('-') + rowIndex} className={rowIndex % 2 ? 'bg-[#fbfcfe] dark:bg-slate-800/50' : ''}>
                            {activeSheet.rowNumbers && (
                              <th scope="row" className="sticky left-0 z-10 w-10 border-b border-r border-[#dbe2ec] bg-[#eff6f1] px-2 py-3 text-center font-semibold text-[#3f5e49] dark:border-white/10 dark:bg-emerald-950/40 dark:text-emerald-100">
                                {activeSheet.rowNumbers[rowIndex]}
                              </th>
                            )}
                            {row.map((cell, cellIndex) => (
                              <td key={`${cell}-${cellIndex}`} className="border-b border-r border-[#edf1f5] px-4 py-3 text-[#52627a] last:border-r-0 dark:border-white/10 dark:text-slate-200">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sheets.length > 1 && (
                    <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-t border-[#dbe2ec] bg-[#f1f5f9] px-2 py-1.5 dark:border-white/10 dark:bg-slate-800" role="tablist" aria-label="Spreadsheet sheets">
                      {sheets.map((sheet, index) => (
                        <button
                          key={sheet.name}
                          type="button"
                          role="tab"
                          aria-selected={index === safeSheetIndex}
                          onClick={() => setActiveSheetIndex(index)}
                          className={`flex-shrink-0 whitespace-nowrap rounded-t-[4px] border-x border-t px-3 py-1.5 text-xs font-medium transition-colors ${
                            index === safeSheetIndex
                              ? 'border-[#dbe2ec] bg-white text-[#27885a] dark:border-white/10 dark:bg-slate-900 dark:text-emerald-300'
                              : 'border-transparent text-[#718198] hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-900/40'
                          }`}
                        >
                          {sheet.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
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
                      {!isCurrent && pageAccess?.canDeleteDocumentVersions && (
                        <button
                          onClick={() => {
                            setDeleteCandidate(v);
                            setDeleteConfirmation('');
                          }}
                          disabled={isBusy}
                          title="Delete this old version"
                          aria-label={`Delete version ${v.versionNumber}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                        >
                          <Trash2 className="h-4 w-4" />
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
    </ModalOverlay>
    {deleteCandidate && (
      <ModalOverlay
        onClose={closeDeleteConfirmation}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      >
        <div role="dialog" aria-modal="true" aria-labelledby="delete-version-title" className="w-full max-w-md rounded-lg bg-white shadow-2xl dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-slate-700">
            <h3 id="delete-version-title" className="text-lg font-semibold text-navy-900 dark:text-white">Delete old version</h3>
            <button onClick={closeDeleteConfirmation} aria-label="Close delete confirmation" className="text-gray-500 hover:text-gray-700 dark:text-slate-400">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="flex gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>Version <strong>{deleteCandidate.versionNumber}</strong> will be permanently removed from the version history. This action cannot be undone.</span>
            </div>
            <div>
              <label htmlFor="delete-version-confirmation" className="mb-1.5 block text-sm font-medium text-navy-900 dark:text-white">
                Type <span className="font-bold text-red-600">DELETE</span> to confirm
              </label>
              <input
                id="delete-version-confirmation"
                autoFocus
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="h-10 w-full rounded border border-gray-300 px-3 text-sm text-navy-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-slate-700">
            <Button variant="secondary" onClick={closeDeleteConfirmation}>Cancel</Button>
            <Button
              variant="danger"
              disabled={deleteConfirmation !== 'DELETE'}
              isLoading={busyVersionId === deleteCandidate.versionId}
              onClick={handleDeleteVersion}
            >
              Delete Version
            </Button>
          </div>
        </div>
      </ModalOverlay>
    )}
    </>
  );
}
