import { useEffect, useRef, useState } from 'react';
import { X, Download, AlertCircle } from 'lucide-react';
import { Button } from '../ui';
import { apiClient } from '../../utils/api';
import { parseWordDocument, parseExcelDocument, parsePowerPointDocument } from '../../utils/officeParser';
import type { LibraryPreview } from '../../fixtures/documentLibrary';

interface AttachmentPreviewModalProps {
  taskId: string;
  attachmentId: string;
  fileName: string;
  onClose: () => void;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'log'];

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

// A lightweight, standalone preview — task attachments live in MinIO under
// their own task-scoped path with no `documentId`/`versionId` in the real
// dms_documents table, so they can't be routed through the Document
// Library's own `/documents?preview=` viewer. Real bug found live: View
// previously just opened the raw blob in a new tab, which works for
// images/PDFs but Office formats have no native browser renderer, so
// Chrome/Edge silently fall back to downloading the file instead of
// "viewing" it — indistinguishable from clicking Download. Runs the same
// client-side Office parsers the Document Library's own upload preview
// uses, for a real in-browser render instead of a forced download.
export function AttachmentPreviewModal({ taskId, attachmentId, fileName, onClose }: AttachmentPreviewModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<LibraryPreview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    apiClient.fetchTaskAttachmentBlob(taskId, attachmentId)
      .then(async (blob) => {
        if (cancelled) return;
        const ext = extensionOf(fileName);

        if (IMAGE_EXTENSIONS.includes(ext)) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setImageUrl(url);
        } else if (ext === 'pdf') {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setPdfUrl(url);
        } else if (TEXT_EXTENSIONS.includes(ext)) {
          const text = await blob.text();
          if (!cancelled) setTextContent(text);
        } else if (ext === 'docx' || ext === 'doc') {
          const preview = await parseWordDocument(blob, '');
          if (cancelled) return;
          if (preview) setOfficePreview(preview); else setUnavailable(true);
        } else if (ext === 'xlsx' || ext === 'xls') {
          const preview = await parseExcelDocument(blob, '');
          if (cancelled) return;
          if (preview) setOfficePreview(preview); else setUnavailable(true);
        } else if (ext === 'pptx' || ext === 'ppt') {
          const preview = await parsePowerPointDocument(blob, '');
          if (cancelled) return;
          if (preview) setOfficePreview(preview); else setUnavailable(true);
        } else {
          setUnavailable(true);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.response?.data?.error || err.message || 'Failed to load this attachment');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, attachmentId, fileName]);

  const handleDownload = () => apiClient.downloadTaskAttachment(taskId, attachmentId, fileName);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <p className="truncate text-sm font-semibold text-navy-900 dark:text-white" title={fileName}>{fileName}</p>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleDownload} leftIcon={<Download className="h-4 w-4" />}>Download</Button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[#f4f6f9] dark:bg-slate-950">
          {isLoading && (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" />
            </div>
          )}

          {!isLoading && error && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {!isLoading && !error && imageUrl && (
            <div className="flex h-full items-center justify-center p-4">
              <img src={imageUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
            </div>
          )}

          {!isLoading && !error && pdfUrl && (
            <iframe src={pdfUrl} title={fileName} className="h-full w-full border-0" />
          )}

          {!isLoading && !error && textContent !== null && (
            <pre className="whitespace-pre-wrap break-words p-6 text-sm text-[#3f4d65] dark:text-slate-300">{textContent}</pre>
          )}

          {!isLoading && !error && officePreview?.kind === 'word' && (
            <div className="mx-auto max-w-3xl bg-white p-8 dark:bg-slate-900 sm:p-12">
              <div className="space-y-4 text-[15px] leading-7 text-[#3f4d65] dark:text-slate-300">
                {officePreview.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              </div>
              {officePreview.totalParagraphs && officePreview.totalParagraphs > officePreview.paragraphs.length && (
                <p className="mt-6 text-xs text-[#94a3b8]">Showing {officePreview.paragraphs.length} of {officePreview.totalParagraphs} paragraphs — download the file to see the rest.</p>
              )}
            </div>
          )}

          {!isLoading && !error && officePreview?.kind === 'spreadsheet' && (
            <div className="h-full overflow-auto">
              {officePreview.sheets.map((sheet) => (
                <div key={sheet.name} className="mb-6">
                  <p className="sticky left-0 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-[#718198]">{sheet.name}</p>
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-[#eff6f1] text-[#3f5e49] dark:bg-emerald-950/40 dark:text-emerald-100">
                      <tr>
                        {sheet.rowNumbers && <th className="w-10 border-b border-r border-[#dbe2ec] bg-[#eff6f1] px-2 py-2 dark:border-white/10 dark:bg-emerald-950/40" />}
                        {sheet.columns.map((col, i) => (
                          <th key={i} className="border-b border-r border-[#dbe2ec] px-3 py-2 font-semibold last:border-r-0 dark:border-white/10">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex % 2 ? 'bg-[#fbfcfe] dark:bg-slate-800/50' : 'bg-white dark:bg-slate-900'}>
                          {sheet.rowNumbers && (
                            <th scope="row" className="w-10 border-b border-r border-[#dbe2ec] bg-[#eff6f1] px-2 py-2 text-center font-semibold text-[#3f5e49] dark:border-white/10 dark:bg-emerald-950/40 dark:text-emerald-100">{sheet.rowNumbers[rowIndex]}</th>
                          )}
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="border-b border-r border-[#edf1f5] px-3 py-2 text-[#52627a] last:border-r-0 dark:border-white/10 dark:text-slate-200">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && officePreview?.kind === 'presentation' && (
            <div className="space-y-6 p-6">
              {officePreview.slides.map((slide, i) => (
                <section key={i} className="mx-auto aspect-video w-full max-w-2xl rounded border border-[#dbe2ec] bg-white p-8 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">Slide {i + 1}</span>
                  <h3 className="mt-3 text-xl font-semibold text-[#2f3e83] dark:text-white">{slide.title}</h3>
                  <ul className="mt-5 space-y-2 text-sm text-[#52627a] dark:text-slate-300">
                    {slide.bullets.map((bullet, bi) => <li key={bi} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#3f8bca]" />{bullet}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {!isLoading && !error && unavailable && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-[#718198]">Preview isn't available for this file type — use Download instead.</p>
              <Button variant="secondary" onClick={handleDownload} leftIcon={<Download className="h-4 w-4" />}>Download</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
