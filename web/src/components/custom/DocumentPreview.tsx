import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Download, FileText, Lock, Presentation, Sheet, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { Button } from '../ui';
import { MarkdownViewer } from './MarkdownViewer';
import { OcrPanel } from './OcrPanel';

const ZOOM_STEP = 10;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const PARAGRAPHS_PER_PAGE = 3;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface PreviewToolbarProps {
  icon: ReactNode;
  label: string;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  pageLabel: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

function PreviewToolbar({ icon, label, zoom, onZoomIn, onZoomOut, onZoomReset, pageLabel, onPrev, onNext, canPrev, canNext }: PreviewToolbarProps) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] bg-[#f7fafc] px-4 py-2.5 dark:border-white/10 dark:bg-slate-800">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#3f8bca]">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
          <button type="button" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={onZoomReset} aria-label="Reset zoom" title="Reset zoom" className="min-w-[3.25rem] border-x border-[#dbe2ec] px-1 py-1.5 text-xs font-medium text-[#34425b] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-800">
            {zoom}%
          </button>
          <button type="button" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs font-medium text-[#52627a] dark:text-slate-300">{pageLabel}</span>
          <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
            <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous page" title="Previous (Up arrow)" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next page" title="Next (Down arrow)" className="border-l border-[#dbe2ec] p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800">
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DocumentPreviewProps {
  document: MockLibraryDocument;
  onClose: () => void;
  onDownload: (document: MockLibraryDocument) => void;
  onSubmitForApproval?: (document: MockLibraryDocument) => void;
}

const statusStyles: Record<string, string> = {
  draft: 'bg-[#edf1f5] text-[#62718a]',
  pending_approval: 'bg-[#fff1c9] text-[#b96a08]',
  qa_review: 'bg-[#fff1c9] text-[#b96a08]',
  manager_review: 'bg-[#fde9c8] text-[#a15c1f]',
  correction_in_progress: 'bg-[#fde1e2] text-[#c73c44]',
  qa_final_review: 'bg-[#dbe9fb] text-[#2f6f9f]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  archived: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  qa_review: 'In Review — QA',
  manager_review: 'In Review — Manager',
  correction_in_progress: 'Correction Needed',
  qa_final_review: 'In Review — Final Release',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};

function PreviewFallback({ message, onDownload }: { message?: string; onDownload: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
      <AlertCircle className="h-10 w-10 text-[#93a4bd]" />
      <h3 className="mt-4 text-base font-semibold text-[#26334d] dark:text-white">Preview unavailable</h3>
      <p className="mt-2 max-w-sm text-sm text-[#718198]">{message ?? 'This file cannot be rendered in the browser. You can download the read-only sample instead.'}</p>
      <Button className="mt-5" variant="secondary" onClick={onDownload} leftIcon={<Download className="h-4 w-4" />}>Download read-only sample</Button>
    </div>
  );
}

export function DocumentPreview({ document, onClose, onDownload, onSubmitForApproval }: DocumentPreviewProps) {
  const [isLoading, setIsLoading] = useState(
    document.preview.kind === 'image' || document.preview.kind === 'pdf' || document.preview.kind === 'loading',
  );
  const [hasError, setHasError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pageIndex, setPageIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsLoading(
      document.preview.kind === 'image' || document.preview.kind === 'pdf' || document.preview.kind === 'loading',
    );
    setHasError(false);
    setZoom(100);
    setPageIndex(0);
  }, [document]);

  const totalPages = document.preview.kind === 'word'
    ? chunkArray(document.preview.paragraphs, PARAGRAPHS_PER_PAGE).length
    : document.preview.kind === 'presentation'
      ? document.preview.slides.length
      : 0;

  // Separate from the Escape/Tab handler below since it needs to react to
  // document/totalPages changes directly instead of stale closures.
  useEffect(() => {
    const canPaginate = document.preview.kind === 'word' || document.preview.kind === 'presentation';
    if (!canPaginate) return;

    const handleArrowKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPageIndex((current) => Math.min(current + 1, totalPages - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPageIndex((current) => Math.max(current - 1, 0));
      }
    };
    window.addEventListener('keydown', handleArrowKeys);
    return () => window.removeEventListener('keydown', handleArrowKeys);
  }, [document, totalPages]);

  useEffect(() => {
    const previouslyFocused = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    const previousBodyOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const renderPreview = () => {
    if (hasError) return <PreviewFallback onDownload={() => onDownload(document)} />;

    switch (document.preview.kind) {
      case 'loading':
        return null;
      case 'markdown':
        return <MarkdownViewer content={document.preview.content} />;
      case 'text':
        return <pre className="min-h-[420px] whitespace-pre-wrap rounded-[4px] border border-[#e2e8f0] bg-white p-6 font-mono text-sm leading-7 text-[#334155] shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200">{document.preview.content}</pre>;
      case 'image':
        return (
          <div className="flex min-h-[420px] items-center justify-center rounded-[4px] bg-[#eef2f7] p-6 dark:bg-slate-950">
            <img src={document.preview.url} alt={document.preview.alt} className="max-h-[65vh] max-w-full rounded object-contain shadow-lg" onLoad={() => setIsLoading(false)} onError={() => { setIsLoading(false); setHasError(true); }} />
          </div>
        );
      case 'pdf':
        return (
          <iframe
            src={document.preview.url}
            title={`PDF preview of ${document.fileName}`}
            className="block h-full w-full rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
          />
        );
      case 'word': {
        const pages = chunkArray(document.preview.paragraphs, PARAGRAPHS_PER_PAGE);
        const safePageIndex = Math.min(pageIndex, pages.length - 1);
        const currentParagraphs = pages[safePageIndex] ?? [];
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <PreviewToolbar
              icon={<FileText className="h-4 w-4" />}
              label="Read-only Word fallback"
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
              pageLabel={`Page ${safePageIndex + 1} of ${pages.length}`}
              onPrev={() => setPageIndex((i) => Math.max(i - 1, 0))}
              onNext={() => setPageIndex((i) => Math.min(i + 1, pages.length - 1))}
              canPrev={safePageIndex > 0}
              canNext={safePageIndex < pages.length - 1}
            />
            <div className="flex-1 overflow-auto p-6">
              <div className="mx-auto origin-top transition-transform" style={{ transform: `scale(${zoom / 100})`, maxWidth: '760px' }}>
                <div className="px-8 py-10 sm:px-14">
                  {safePageIndex === 0 && <h3 className="text-2xl font-semibold text-[#2f3e83] dark:text-white">{document.preview.title}</h3>}
                  <div className="mt-8 space-y-5 text-[15px] leading-7 text-[#3f4d65] dark:text-slate-300">
                    {currentParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                  {safePageIndex === pages.length - 1 && (
                    <Button className="mt-10" variant="secondary" onClick={() => onDownload(document)} leftIcon={<Download className="h-4 w-4" />}>Download extracted text</Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      }
      case 'spreadsheet': {
        const sheets = document.preview.sheets;
        const safeSheetIndex = Math.min(pageIndex, sheets.length - 1);
        const activeSheet = sheets[safeSheetIndex];
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#dbe2ec] bg-[#f7fafc] px-4 py-3 text-sm font-semibold text-[#2f3e83] dark:border-white/10 dark:bg-slate-800 dark:text-white">
              <Sheet className="h-4 w-4 text-emerald-600" />Read-only spreadsheet preview
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#eff6f1] text-[#3f5e49] dark:bg-emerald-950/40 dark:text-emerald-100">
                  <tr>{activeSheet.columns.map((column) => <th key={column} className="border-b border-r border-[#dbe2ec] px-4 py-3 font-semibold last:border-r-0 dark:border-white/10">{column}</th>)}</tr>
                </thead>
                <tbody>{activeSheet.rows.map((row, rowIndex) => <tr key={row.join('-')} className={rowIndex % 2 ? 'bg-[#fbfcfe] dark:bg-slate-800/50' : ''}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className="border-b border-r border-[#edf1f5] px-4 py-3 text-[#52627a] last:border-r-0 dark:border-white/10 dark:text-slate-200">{cell}</td>)}</tr>)}</tbody>
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
                    onClick={() => setPageIndex(index)}
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
      }
      case 'presentation': {
        const slides = document.preview.slides;
        const safeSlideIndex = Math.min(pageIndex, slides.length - 1);
        const slide = slides[safeSlideIndex];
        return (
          <div className="flex h-full w-full flex-col">
            <PreviewToolbar
              icon={<Presentation className="h-4 w-4 text-orange-600" />}
              label="Read-only slide fallback"
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
              pageLabel={`Slide ${safeSlideIndex + 1} of ${slides.length}`}
              onPrev={() => setPageIndex((i) => Math.max(i - 1, 0))}
              onNext={() => setPageIndex((i) => Math.min(i + 1, slides.length - 1))}
              canPrev={safeSlideIndex > 0}
              canNext={safeSlideIndex < slides.length - 1}
            />
            <div className="flex-1 overflow-auto p-6">
              <div className="mx-auto origin-top transition-transform" style={{ transform: `scale(${zoom / 100})` }}>
                <section className="aspect-video w-[720px] max-w-full rounded-[5px] border border-[#dbe2ec] bg-white p-8 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-12">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">Slide {safeSlideIndex + 1}</span>
                  <h3 className="mt-4 text-2xl font-semibold text-[#2f3e83] dark:text-white">{slide.title}</h3>
                  <ul className="mt-7 space-y-3 text-base text-[#52627a] dark:text-slate-300">{slide.bullets.map((bullet) => <li key={bullet} className="flex gap-3"><span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#3f8bca]" />{bullet}</li>)}</ul>
                </section>
              </div>
            </div>
            <div className="flex flex-shrink-0 justify-center border-t border-[#e2e8f0] py-3 dark:border-white/10">
              <Button variant="secondary" onClick={() => onDownload(document)} leftIcon={<Download className="h-4 w-4" />}>Download slide outline</Button>
            </div>
          </div>
        );
      }
      case 'office-embed':
        return (
          <iframe
            src={document.preview.url}
            title={`Preview of ${document.fileName}`}
            className="block h-full w-full rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
          />
        );
      case 'unavailable':
        return (
          <div className="space-y-6">
            <PreviewFallback message={document.preview.message} onDownload={() => onDownload(document)} />
            {/* A cached in-browser Docling preview only lives for the session it was
                uploaded in; after a reload there is no local content to show, but the
                server still has the file, so offer to re-run extraction on demand. */}
            {document.currentVersionId && (
              <div className="border-t border-[#e2e8f0] pt-6 dark:border-white/10">
                <OcrPanel documentId={document.documentId} versionId={document.currentVersionId} fileName={document.fileName} />
              </div>
            )}
          </div>
        );
      default:
        return <PreviewFallback onDownload={() => onDownload(document)} />;
    }
  };

  return (
    <div data-testid="document-preview-overlay" className="fixed inset-y-0 right-0 left-0 top-0 z-[70] overflow-hidden lg:left-[286px]" role="dialog" aria-modal="true" aria-labelledby="document-preview-title">
      <section ref={dialogRef} className="h-screen flex flex-col overflow-hidden bg-[#f3f6fa] dark:bg-slate-950">
        <header className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-[#dbe2ec] bg-white px-6 py-3 dark:border-white/10 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="document-preview-title" className="text-base font-semibold text-[#283a7a] dark:text-white truncate">{document.fileName}</h2>
              <span className="inline-flex items-center gap-1 rounded bg-[#d8f5e4] px-2 py-0.5 text-xs font-medium text-[#27885a]"><Lock className="h-3 w-3" />View Only</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#52627a] dark:text-slate-300">
              <div className="flex gap-3">
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Type</p>
                  <p className="uppercase font-semibold text-[#3f8bca]">{document.extension}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Folder</p>
                  <p className="truncate">{document.folderName}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Size</p>
                  <p>{formatFileSize(document.fileSize)}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Status</p>
                  <p><span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusStyles[document.status]}`}>{statusLabels[document.status]}</span></p>
                </div>
              </div>
              <div className="flex gap-3">
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Department</p>
                  <p className="truncate">{document.department}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Owner</p>
                  <p className="truncate">{document.owner.fullName}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Created</p>
                  <p className="whitespace-nowrap">{formatDateTime(document.createdAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Modified</p>
                  <p className="whitespace-nowrap">{formatDateTime(document.modifiedAt)}</p>
                </div>
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Description</p>
                  <p className="truncate text-[#52627a] dark:text-slate-400">{document.description || '—'}</p>
                </div>
                {document.tags && document.tags.length > 0 && (
                  <div>
                    <p className="font-medium text-[#34425b] dark:text-slate-200">Tags</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {document.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded-full bg-[#edf2f8] px-2 py-0.5 text-xs font-medium text-[#52627a] dark:bg-slate-800 dark:text-slate-200">{tag}</span>
                      ))}
                      {document.tags.length > 2 && <span className="text-[#52627a] dark:text-slate-300">+{document.tags.length - 2}</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {document.status === 'draft' && onSubmitForApproval && (
              <button onClick={() => onSubmitForApproval(document)} className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#399a68] px-3 text-xs font-medium text-white hover:bg-[#2f895b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#399a68]" aria-label={`Submit ${document.fileName} for approval`}>
                Submit for Approval
              </button>
            )}
            <button onClick={() => onDownload(document)} className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#3f8bca] px-3 text-xs font-medium text-white hover:bg-[#2f6f9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label={`Download ${document.fileName}`}>
              <Download className="h-4 w-4" /> Download
            </button>
            <button ref={closeButtonRef} onClick={onClose} className="rounded p-2 text-[#718198] hover:bg-[#eef2f7] hover:text-[#283a7a] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label="Close document preview"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div data-testid="document-preview-body" className={`relative min-h-0 flex-1 overflow-hidden ${['pdf', 'word', 'presentation', 'spreadsheet'].includes(document.preview.kind) ? '' : 'p-6'}`}>
          {isLoading && (
            <div className="absolute inset-6 z-10 flex items-center justify-center rounded-[4px] bg-white/95 dark:bg-slate-900/95" role="status">
              <div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" /><p className="mt-3 text-sm text-[#718198]">{document.preview.kind === 'loading' ? document.preview.message : 'Loading preview...'}</p></div>
            </div>
          )}
          <div className={`h-full ${['word', 'presentation', 'spreadsheet'].includes(document.preview.kind) ? '' : 'overflow-auto'}`}>
            {renderPreview()}
          </div>
        </div>
      </section>
    </div>
  );
}
