import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Download, X } from 'lucide-react';
import type { LibraryPreview } from '../../fixtures/documentLibrary';
import { doclingApi } from '../../services/doclingApi';
import { parseExcelDocument, parsePowerPointDocument, parseWordDocument } from '../../utils/officeParser';
import { Button } from '../ui';
import { ModalOverlay } from '../ui/ModalOverlay';

interface ReadOnlyFilePreviewModalProps {
  fileName: string;
  loadBlob: () => Promise<Blob>;
  onDownload: () => void | Promise<void>;
  onClose: () => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'log']);
const WORD_EXTENSIONS = new Set(['doc', 'docx', 'docm']);
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx']);
const SPREADSHEET_EXTENSIONS = new Set(['xls', 'xlsx']);

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** Read-only viewer for archive/attachment files outside the native version chain. */
export function ReadOnlyFilePreviewModal({ fileName, loadBlob, onDownload, onClose }: ReadOnlyFilePreviewModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibraryPreview | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const registerUrl = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      return url;
    };
    const load = async () => {
      setIsLoading(true);
      setError(null);
      setPreview(null);
      try {
        const blob = await loadBlob();
        if (cancelled) return;
        const extension = extensionOf(fileName);
        const sourceUrl = registerUrl(blob);
        if (extension === 'pdf' || blob.type === 'application/pdf') {
          setPreview({ kind: 'pdf', url: sourceUrl });
          return;
        }
        if (IMAGE_EXTENSIONS.has(extension) || blob.type.startsWith('image/')) {
          setPreview({ kind: 'image', url: sourceUrl, alt: fileName });
          return;
        }
        if (TEXT_EXTENSIONS.has(extension) || blob.type.startsWith('text/')) {
          const content = await blob.text();
          if (!cancelled) setPreview(extension === 'md' || extension === 'markdown' ? { kind: 'markdown', content } : { kind: 'text', content });
          return;
        }
        if (SPREADSHEET_EXTENSIONS.has(extension)) {
          const parsed = await parseExcelDocument(blob, sourceUrl);
          if (!cancelled) setPreview(parsed);
          return;
        }
        if (WORD_EXTENSIONS.has(extension) || PRESENTATION_EXTENSIONS.has(extension)) {
          if (await doclingApi.isAvailable()) {
            try {
              const pdf = await doclingApi.convertToPdf(blob, fileName);
              if (!cancelled) setPreview({ kind: 'pdf', url: registerUrl(pdf) });
              return;
            } catch {
              // Use the same client-side read-only fallback as other viewers.
            }
          }
          const parsed = WORD_EXTENSIONS.has(extension)
            ? await parseWordDocument(blob, sourceUrl)
            : await parsePowerPointDocument(blob, sourceUrl);
          if (!cancelled) setPreview(parsed);
          return;
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || err.message || 'Failed to load this file');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, [fileName, loadBlob]);

  return (
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Preview ${fileName}`}>
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div><p className="truncate text-sm font-semibold text-navy-900 dark:text-white" title={fileName}>{fileName}</p><p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">Read-only preview</p></div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void onDownload()} leftIcon={<Download className="h-4 w-4" />}>Download</Button>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label={`Close preview of ${fileName}`}><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-[#f4f6f9] dark:bg-slate-950">
          {isLoading && <div className="flex h-full items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" /></div>}
          {!isLoading && error && <PreviewMessage icon={<AlertCircle className="h-6 w-6 text-red-500" />} message={error} />}
          {!isLoading && !error && preview?.kind === 'image' && <div className="flex h-full items-center justify-center p-4"><img src={preview.url} alt={preview.alt} className="max-h-full max-w-full object-contain" /></div>}
          {!isLoading && !error && preview?.kind === 'pdf' && <iframe src={preview.url} title={fileName} className="h-full w-full border-0" />}
          {!isLoading && !error && (preview?.kind === 'text' || preview?.kind === 'markdown') && <pre className="whitespace-pre-wrap break-words p-6 text-sm text-[#3f4d65] dark:text-slate-300">{preview.content}</pre>}
          {!isLoading && !error && preview?.kind === 'word' && <div className="mx-auto max-w-3xl bg-white p-8 dark:bg-slate-900 sm:p-12">{preview.renderNotice && <p className="mb-4 rounded bg-amber-50 p-3 text-xs text-amber-800">{preview.renderNotice}</p>}<div className="space-y-4 text-[15px] leading-7 text-[#3f4d65] dark:text-slate-300">{preview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div>}
          {!isLoading && !error && preview?.kind === 'spreadsheet' && <div className="h-full overflow-auto">{preview.sheets.map((sheet) => <div key={sheet.name} className="mb-6"><p className="sticky left-0 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-[#718198]">{sheet.name}</p><table className="w-full border-collapse text-left text-sm"><thead className="sticky top-0 bg-[#eff6f1] text-[#3f5e49]"><tr>{sheet.columns.map((column) => <th key={column} className="border-b border-r border-[#dbe2ec] px-3 py-2">{column}</th>)}</tr></thead><tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-r border-[#edf1f5] px-3 py-2 text-[#52627a]">{cell}</td>)}</tr>)}</tbody></table></div>)}</div>}
          {!isLoading && !error && preview?.kind === 'presentation' && <div className="space-y-6 p-6">{preview.slides.map((slide, index) => <section key={index} className="mx-auto aspect-video w-full max-w-2xl rounded border bg-white p-8 shadow-sm"><span className="text-xs text-[#94a3b8]">Slide {index + 1}</span><h3 className="mt-3 text-xl font-semibold text-[#2f3e83]">{slide.title}</h3><ul className="mt-5 space-y-2">{slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul></section>)}</div>}
          {!isLoading && !error && !preview && <PreviewMessage message="Preview unavailable for this file type. Download remains available." />}
        </div>
      </div>
    </ModalOverlay>
  );
}

function PreviewMessage({ icon, message }: { icon?: ReactNode; message: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">{icon}<p className="text-sm text-[#718198] dark:text-slate-300">{message}</p></div>;
}
