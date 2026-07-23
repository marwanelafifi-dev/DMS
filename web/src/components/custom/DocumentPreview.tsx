import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, Lock, Presentation, Sheet, X } from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { Button } from '../ui';

interface DocumentPreviewProps {
  document: MockLibraryDocument;
  onClose: () => void;
  onDownload: (document: MockLibraryDocument) => void;
}

const statusStyles: Record<string, string> = {
  draft: 'bg-[#edf1f5] text-[#62718a]',
  pending_approval: 'bg-[#fff1c9] text-[#b96a08]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  archived: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
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

export function DocumentPreview({ document, onClose, onDownload }: DocumentPreviewProps) {
  const [isLoading, setIsLoading] = useState(document.preview.kind === 'image' || document.preview.kind === 'pdf');
  const [hasError, setHasError] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsLoading(document.preview.kind === 'image' || document.preview.kind === 'pdf');
    setHasError(false);
  }, [document]);

  useEffect(() => {
    const previouslyFocused = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
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
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const renderPreview = () => {
    if (hasError) return <PreviewFallback onDownload={() => onDownload(document)} />;

    switch (document.preview.kind) {
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
            className="h-[65vh] min-h-[480px] w-full rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10"
            onLoad={() => setIsLoading(false)}
            onError={() => { setIsLoading(false); setHasError(true); }}
          />
        );
      case 'word':
        return (
          <div className="mx-auto min-h-[520px] max-w-[760px] rounded-[3px] bg-white px-8 py-10 shadow-sm dark:bg-slate-900 sm:px-14">
            <div className="mb-8 flex items-center gap-2 border-b border-[#e2e8f0] pb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#3f8bca]"><FileText className="h-4 w-4" />Read-only Word fallback</div>
            <h3 className="text-center text-2xl font-semibold text-[#2f3e83] dark:text-white">{document.preview.title}</h3>
            <div className="mt-8 space-y-5 text-[15px] leading-7 text-[#3f4d65] dark:text-slate-300">
              {document.preview.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
            <Button className="mt-10" variant="secondary" onClick={() => onDownload(document)} leftIcon={<Download className="h-4 w-4" />}>Download extracted text</Button>
          </div>
        );
      case 'spreadsheet':
        return (
          <div className="overflow-x-auto rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center gap-2 border-b border-[#dbe2ec] bg-[#f7fafc] px-4 py-3 text-sm font-semibold text-[#2f3e83] dark:border-white/10 dark:bg-slate-800 dark:text-white"><Sheet className="h-4 w-4 text-emerald-600" />Read-only spreadsheet preview</div>
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-[#eff6f1] text-[#3f5e49] dark:bg-emerald-950/40 dark:text-emerald-100">
                <tr>{document.preview.columns.map((column) => <th key={column} className="border-b border-r border-[#dbe2ec] px-4 py-3 font-semibold last:border-r-0 dark:border-white/10">{column}</th>)}</tr>
              </thead>
              <tbody>{document.preview.rows.map((row, rowIndex) => <tr key={row.join('-')} className={rowIndex % 2 ? 'bg-[#fbfcfe] dark:bg-slate-800/50' : ''}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className="border-b border-r border-[#edf1f5] px-4 py-3 text-[#52627a] last:border-r-0 dark:border-white/10 dark:text-slate-200">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case 'presentation':
        return (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#2f3e83] dark:text-white"><Presentation className="h-4 w-4 text-orange-600" />Read-only slide fallback</div>
            {document.preview.slides.map((slide, index) => (
              <section key={slide.title} className="aspect-video rounded-[5px] border border-[#dbe2ec] bg-white p-8 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-12">
                <span className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">Slide {index + 1}</span>
                <h3 className="mt-4 text-2xl font-semibold text-[#2f3e83] dark:text-white">{slide.title}</h3>
                <ul className="mt-7 space-y-3 text-base text-[#52627a] dark:text-slate-300">{slide.bullets.map((bullet) => <li key={bullet} className="flex gap-3"><span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#3f8bca]" />{bullet}</li>)}</ul>
              </section>
            ))}
            <Button variant="secondary" onClick={() => onDownload(document)} leftIcon={<Download className="h-4 w-4" />}>Download slide outline</Button>
          </div>
        );
      case 'unavailable':
        return <PreviewFallback message={document.preview.message} onDownload={() => onDownload(document)} />;
      default:
        return <PreviewFallback onDownload={() => onDownload(document)} />;
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50" role="dialog" aria-modal="true" aria-labelledby="document-preview-title">
      <section ref={dialogRef} className="absolute inset-0 left-56 flex flex-col overflow-hidden bg-[#f3f6fa] dark:bg-slate-950">
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
            <button onClick={() => onDownload(document)} className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#3f8bca] px-3 text-xs font-medium text-white hover:bg-[#2f6f9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label={`Download ${document.fileName}`}>
              <Download className="h-4 w-4" /> Download
            </button>
            <button ref={closeButtonRef} onClick={onClose} className="rounded p-2 text-[#718198] hover:bg-[#eef2f7] hover:text-[#283a7a] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label="Close document preview"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden p-6">
          {isLoading && (
            <div className="absolute inset-6 z-10 flex items-center justify-center rounded-[4px] bg-white/95 dark:bg-slate-900/95" role="status">
              <div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" /><p className="mt-3 text-sm text-[#718198]">Loading preview...</p></div>
            </div>
          )}
          <div className="h-full overflow-auto">
            {renderPreview()}
          </div>
        </div>
      </section>
    </div>
  );
}
