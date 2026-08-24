import { useEffect, useRef, useState } from 'react';
import { Archive, Download, Eye, FileArchive, X } from 'lucide-react';
import type { LegacyAssociatedFile, LegacyMetadataHistory } from '../../types';
import { apiClient } from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import { Button } from '../ui';

interface LegacyMetadataHistoryActionProps {
  documentId: string;
  fileName: string;
}

const SECONDARY_ACTION_CLASS = 'inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]';

export function LegacyMetadataHistoryAction({ documentId, fileName }: LegacyMetadataHistoryActionProps) {
  const [history, setHistory] = useState<LegacyMetadataHistory | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [busyFileAction, setBusyFileAction] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setLoadFailed(false);
    setIsOpen(false);

    apiClient.getLegacyMetadataHistory(documentId)
      .then((response) => {
        if (cancelled) return;
        if (!response.success || !response.data) {
          setLoadFailed(true);
          return;
        }
        if (response.data.hasLegacyMetadataHistory && response.data.snapshots.length > 0) {
          setHistory(response.data);
        }
      })
      // A failed availability check must not disrupt the normal document page,
      // but it also must not masquerade as a genuine "no legacy history" state.
      .catch(() => { if (!cancelled) setLoadFailed(true); });

    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : actionButtonRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    });

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      // DocumentPreview also listens on window for Escape/zoom/paging keys.
      // Stop those keys during the nested archive dialog so closing or
      // navigating this modal cannot close/change the document underneath it.
      if (['Escape', 'Tab', 'PageUp', 'PageDown', 'Home', 'End', '+', '=', '-', '0'].includes(event.key)) {
        event.stopImmediatePropagation();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleDialogKeyDown, true);
      (previouslyFocused?.isConnected ? previouslyFocused : actionButtonRef.current)?.focus();
    };
  }, [isOpen]);

  // The API owns the KnowledgeTree version ordering and returns newest first.
  // Rendering that order verbatim avoids a second, potentially divergent,
  // definition of what "newest" means in the browser.
  const snapshots = history?.snapshots ?? [];

  const handleView = async (file: LegacyAssociatedFile) => {
    if (!file.isAvailable) return;
    const actionKey = `view-${file.legacyContentVersionId}`;
    setBusyFileAction(actionKey);
    setFileActionError(null);
    try {
      const { blob } = await apiClient.getLegacyContentFile(documentId, file.legacyContentVersionId, 'view');
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setFileActionError(`Could not open ${file.originalFileName} from the Legacy Archive.`);
    } finally {
      setBusyFileAction(null);
    }
  };

  const handleDownload = async (file: LegacyAssociatedFile) => {
    if (!file.isAvailable) return;
    const actionKey = `download-${file.legacyContentVersionId}`;
    setBusyFileAction(actionKey);
    setFileActionError(null);
    try {
      const { blob } = await apiClient.getLegacyContentFile(documentId, file.legacyContentVersionId, 'download');
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = file.originalFileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setFileActionError(`Could not download ${file.originalFileName} from the Legacy Archive.`);
    } finally {
      setBusyFileAction(null);
    }
  };

  if (!history) {
    return loadFailed ? (
      <button
        type="button"
        disabled
        title="Legacy metadata history could not be checked"
        className={`${SECONDARY_ACTION_CLASS} cursor-not-allowed opacity-50`}
        aria-label={`Legacy metadata history unavailable for ${fileName}`}
      >
        <Archive className="h-4 w-4" /> Metadata History
      </button>
    ) : null;
  }

  return (
    <>
      <button
        ref={actionButtonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        title="KnowledgeTree legacy metadata history"
        className={SECONDARY_ACTION_CLASS}
        aria-label={`View legacy metadata history of ${fileName}`}
      >
        <Archive className="h-4 w-4" /> Metadata History
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legacy-metadata-history-title"
            className="flex max-h-[90vh] w-full max-w-[800px] flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-slate-700">
              <div className="min-w-0">
                <h2 id="legacy-metadata-history-title" className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white">
                  <Archive className="h-5 w-5" /> Legacy Metadata History
                </h2>
                <p className="mt-1 truncate text-sm text-gray-500 dark:text-slate-400">
                  <span>Imported from {history.sourceSystem ?? 'KnowledgeTree'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{fileName}</span>
                </p>
                {history.legacyDocumentId != null && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">Legacy document #{history.legacyDocumentId}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Close legacy metadata history"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-5 dark:bg-slate-950">
              {fileActionError && (
                <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {fileActionError}
                </p>
              )}
              <div className="space-y-4">
                {snapshots.map((snapshot) => (
                  <section
                    key={snapshot.metadataVersionId}
                    data-testid={`legacy-metadata-snapshot-${snapshot.metadataVersion}`}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
                      <div>
                        <h3 className="text-sm font-semibold text-navy-900 dark:text-white">Metadata Version {snapshot.metadataVersion}</h3>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                          <span>Date: {snapshot.snapshotDate ? formatDateTime(snapshot.snapshotDate) : 'Unavailable'}</span>
                          <span>Metadata Version ID: {snapshot.metadataVersionId}</span>
                          {snapshot.legacyContentVersionId != null && (
                            <span>Legacy Content Version: {snapshot.legacyContentVersionId}</span>
                          )}
                          <span>Source: {snapshot.sourceSystem}</span>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${snapshot.isCurrentAtMigration ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {snapshot.isCurrentAtMigration ? 'CURRENT AT MIGRATION' : 'HISTORICAL'}
                      </span>
                    </div>

                    {snapshot.associatedFile ? (
                      <div className="border-b border-gray-200 bg-blue-50/45 px-4 py-3 dark:border-slate-700 dark:bg-blue-500/5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#2f6f9f] dark:text-blue-300">
                              <FileArchive className="h-4 w-4" /> Associated legacy file
                            </p>
                            <p className="mt-1 break-all text-sm font-semibold text-navy-900 dark:text-white">{snapshot.associatedFile.originalFileName}</p>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-slate-300">
                              <span>Content Version ID: {snapshot.associatedFile.legacyContentVersionId}</span>
                              <span>File Version: {snapshot.associatedFile.versionLabel}</span>
                              <span>File Date: {snapshot.associatedFile.fileDate ? formatDateTime(snapshot.associatedFile.fileDate) : 'Unavailable'}</span>
                              <span>File Size: {formatLegacyFileSize(snapshot.associatedFile.fileSizeBytes)}</span>
                            </div>
                            <p className={`mt-1 text-xs font-medium ${snapshot.associatedFile.isAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                              File status: <span>{snapshot.associatedFile.fileStatus}</span>
                            </p>
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => void handleView(snapshot.associatedFile!)}
                              disabled={!snapshot.associatedFile.isAvailable || busyFileAction != null}
                              className={`${SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                              aria-label={`View ${snapshot.associatedFile.originalFileName}`}
                            >
                              <Eye className="h-4 w-4" /> {busyFileAction === `view-${snapshot.associatedFile.legacyContentVersionId}` ? 'Opening...' : 'View'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDownload(snapshot.associatedFile!)}
                              disabled={!snapshot.associatedFile.isAvailable || busyFileAction != null}
                              className={`${SECONDARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                              aria-label={`Download ${snapshot.associatedFile.originalFileName}`}
                            >
                              <Download className="h-4 w-4" /> {busyFileAction === `download-${snapshot.associatedFile.legacyContentVersionId}` ? 'Downloading...' : 'Download'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                        Associated content version record is unavailable; the metadata snapshot is preserved below.
                      </div>
                    )}

                    <dl className="divide-y divide-gray-100 dark:divide-slate-800">
                      {snapshot.fields.map((field, fieldIndex) => (
                        <div key={`${field.name}-${fieldIndex}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-4">
                          <dt className="text-xs font-semibold text-gray-600 dark:text-slate-300">{field.name}</dt>
                          <dd className="whitespace-pre-wrap break-words text-sm text-navy-900 dark:text-white">{field.value == null || field.value === '' ? '—' : field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
              <p className="text-xs text-gray-500 dark:text-slate-400">Read-only legacy archive</p>
              <Button onClick={() => setIsOpen(false)} variant="secondary">Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatLegacyFileSize(size?: number | null) {
  if (size == null) return 'Unavailable';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
