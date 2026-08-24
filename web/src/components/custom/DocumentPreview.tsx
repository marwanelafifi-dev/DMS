import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FilePen,
  History,
  Lock,
  PencilLine,
  Printer,
  Search,
  UploadCloud,
  X,
} from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import type { RolePermissionFlags } from '../../utils/api';
import { statusLabels, statusStyles } from '../../utils/documentStatus';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { Button } from '../ui';
import { EditDocumentModal } from './EditDocumentModal';
import { MarkdownViewer } from './MarkdownViewer';
import { OcrPanel } from './OcrPanel';
import { PdfJsViewer, type PdfJsViewerHandle, type PdfMatchInfo } from './PdfJsViewer';
import { PreviewToolbar } from './PreviewToolbar';
import { UploadNewVersionModal } from './UploadNewVersionModal';
import { VersionHistoryModal } from './VersionHistoryModal';
import { RelatedTasksModal } from './RelatedTasksModal';
import { LegacyMetadataHistoryAction } from './LegacyMetadataHistoryAction';

const ZOOM_STEP = 10;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const PARAGRAPHS_PER_PAGE = 3;
const STUCK_LOAD_TIMEOUT_MS = 15000;

// `transform: scale()` only affects paint, not layout — the scroll container's
// scrollHeight/scrollWidth stay based on the pre-scale box, so zoomed-in content
// clips with no way to reach it. `zoom` affects layout too, so overflow works
// correctly at any zoom level. csstype doesn't model it yet, hence the cast type.
type ZoomableStyle = React.CSSProperties & { zoom?: number | string };

// `zoom` isn't supported in Firefox <126 or Safari <17. Feature-detect and fall
// back to the old transform-scale behavior there — it clips above 100% zoom, but
// that matches the app's pre-fix behavior rather than silently doing nothing.
const SUPPORTS_CSS_ZOOM = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1');

function getZoomStyle(zoomPercent: number): ZoomableStyle {
  const factor = zoomPercent / 100;
  return SUPPORTS_CSS_ZOOM
    ? { zoom: factor }
    : { transform: `scale(${factor})`, transformOrigin: 'top left' };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface SearchOccurrence {
  globalIndex: number;
  start: number;
}

interface SearchGroup {
  key: string;
  pageIndex: number;
  text: string;
}

const SEARCHABLE_KINDS = new Set(['text', 'word', 'presentation', 'spreadsheet', 'markdown']);
const ZOOMABLE_KINDS = new Set(['word', 'presentation', 'spreadsheet', 'image', 'markdown', 'text']);

function buildSearchGroups(preview: MockLibraryDocument['preview']): SearchGroup[] {
  switch (preview.kind) {
    case 'text':
      return [{ key: 'content', pageIndex: 0, text: preview.content }];
    case 'word':
      return preview.paragraphs.map((text, index) => ({
        key: `p-${index}`,
        pageIndex: Math.floor(index / PARAGRAPHS_PER_PAGE),
        text,
      }));
    case 'presentation':
      return preview.slides.flatMap((slide, slideIndex) => [
        { key: `slide-${slideIndex}-title`, pageIndex: slideIndex, text: slide.title },
        ...slide.bullets.map((bullet, bulletIndex) => ({
          key: `slide-${slideIndex}-bullet-${bulletIndex}`,
          pageIndex: slideIndex,
          text: bullet,
        })),
      ]);
    case 'spreadsheet':
      return preview.sheets.flatMap((sheet, sheetIndex) => [
        ...sheet.columns.map((column, columnIndex) => ({
          key: `header-${sheetIndex}-${columnIndex}`,
          pageIndex: sheetIndex,
          text: column,
        })),
        ...sheet.rows.flatMap((row, rowIndex) => row.map((cell, cellIndex) => ({
          key: `cell-${sheetIndex}-${rowIndex}-${cellIndex}`,
          pageIndex: sheetIndex,
          text: cell,
        }))),
      ]);
    case 'image':
      return preview.ocrText ? [{ key: 'ocr', pageIndex: 0, text: preview.ocrText }] : [];
    default:
      return [];
  }
}


function TruncationBanner({ shown, total, unit }: { shown: number; total: number; unit: string }) {
  if (total <= shown) return null;
  return (
    <div className="mx-auto mb-4 max-w-3xl rounded-[4px] border border-[#f3d48a] bg-[#fff8e6] px-4 py-2 text-xs font-medium text-[#8a6412] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      Showing the first {shown} of {total} {unit} — download the file for the full content.
    </div>
  );
}

function RenderNoticeBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="mx-auto mb-4 max-w-3xl rounded-[4px] border border-[#bcd6ef] bg-[#eef6fd] px-4 py-2 text-xs font-medium text-[#2f6f9f] dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
      {message}
    </div>
  );
}

interface DocumentPreviewProps {
  document: MockLibraryDocument;
  onClose: () => void;
  onDownload: (document: MockLibraryDocument) => void;
  onDownloadForEditing?: (document: MockLibraryDocument) => void;
  onSubmitForApproval?: (document: MockLibraryDocument) => void;
  onForceUnlock?: (document: MockLibraryDocument) => void;
  // The current user's effective permission flags for this document's
  // folder — gates Submit for Approval / Download for Editing so those
  // buttons are hidden/disabled instead of only failing after a click.
  // Omitted (undefined) means "unknown yet"; both stay hidden/disabled
  // until it resolves, same fail-closed default used elsewhere.
  permissions?: RolePermissionFlags | null;
  onDocumentUpdated?: () => void;
}

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

export function DocumentPreview({ document, onClose, onDownload, onDownloadForEditing, onSubmitForApproval, onForceUnlock, permissions, onDocumentUpdated }: DocumentPreviewProps) {
  const newVersionInputRef = useRef<HTMLInputElement>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showRelatedTasks, setShowRelatedTasks] = useState(false);
  const [pendingVersionFile, setPendingVersionFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(
    document.preview.kind === 'image' || document.preview.kind === 'pdf' || document.preview.kind === 'loading',
  );
  const [hasError, setHasError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pageIndex, setPageIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [mdActiveMatchIndex, setMdActiveMatchIndex] = useState(0);
  const [mdMatchCount, setMdMatchCount] = useState(0);
  const [pdfMatchInfo, setPdfMatchInfo] = useState<PdfMatchInfo>({ total: 0, activeIndex: 0, isIndexing: false });
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeMatchRef = useRef<HTMLElement | null>(null);
  const pdfIframeRef = useRef<HTMLIFrameElement>(null);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PdfJsViewerHandle>(null);

  const isRetryableLoad = document.preview.kind === 'pdf' || document.preview.kind === 'image';
  const isPdf = document.preview.kind === 'pdf';
  const isImage = document.preview.kind === 'image';
  // The image's own OCR/Docling text loads in the background after the image
  // itself is already showing — the search box appears right away (like every
  // other kind), but shows "Indexing…" instead of a match count until that
  // text is ready, matching the PDF viewer's own indexing state below.
  const isImageIndexing = isImage && !document.preview.ocrText;
  // The PDF's own searchable text only exists inside PdfJsViewer (parsed via
  // pdf.js), so its match navigation is delegated there via pdfViewerRef/
  // onMatchInfoChange — but the search *input* itself still lives in this shared
  // header, same as every other kind, for one consistent search location.
  const isSearchable = SEARCHABLE_KINDS.has(document.preview.kind) || isPdf || isImage;
  const isZoomable = ZOOMABLE_KINDS.has(document.preview.kind);
  const isMarkdown = document.preview.kind === 'markdown';
  const canPaginate = document.preview.kind === 'word' || document.preview.kind === 'presentation' || document.preview.kind === 'spreadsheet';

  useEffect(() => {
    setIsLoading(
      document.preview.kind === 'image' || document.preview.kind === 'pdf' || document.preview.kind === 'loading',
    );
    setHasError(false);
    setZoom(100);
    setPageIndex(0);
    setSearchQuery('');
    setActiveMatchIndex(0);
    setHasTimedOut(false);
    setRetryKey(0);
    setMdActiveMatchIndex(0);
    setMdMatchCount(0);
    setPdfMatchInfo({ total: 0, activeIndex: 0, isIndexing: false });
  }, [document]);

  // Markdown search: react-markdown renders arbitrary nested HTML, so the
  // paragraph/cell-string highlighting used for text/word/presentation/
  // spreadsheet doesn't apply here. Uses the CSS Custom Highlight API instead —
  // supported in Chrome/Edge 105+ and Safari 17.2+ (not yet in Firefox), which
  // fits this app's enterprise Chrome/Edge target; it's a no-op elsewhere rather
  // than an error.
  useEffect(() => {
    const supportsHighlightApi = typeof CSS !== 'undefined' && 'highlights' in CSS;
    if (!supportsHighlightApi) return undefined;

    if (!isMarkdown) {
      CSS.highlights.delete('dms-md-match');
      CSS.highlights.delete('dms-md-match-active');
      return undefined;
    }

    const container = markdownContainerRef.current;
    const trimmed = searchQuery.trim().toLowerCase();
    if (!container || !trimmed) {
      CSS.highlights.delete('dms-md-match');
      CSS.highlights.delete('dms-md-match-active');
      setMdMatchCount(0);
      return undefined;
    }

    const ranges: Range[] = [];
    const walker = window.document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? '';
      const lowerText = text.toLowerCase();
      let cursor = 0;
      while (true) {
        const idx = lowerText.indexOf(trimmed, cursor);
        if (idx === -1) break;
        const range = new Range();
        range.setStart(node, idx);
        range.setEnd(node, idx + trimmed.length);
        ranges.push(range);
        cursor = idx + trimmed.length;
      }
      node = walker.nextNode();
    }

    setMdMatchCount(ranges.length);
    const clampedActive = ranges.length > 0 ? Math.min(mdActiveMatchIndex, ranges.length - 1) : -1;
    const activeRange = clampedActive >= 0 ? ranges[clampedActive] : undefined;
    const restRanges = activeRange ? ranges.filter((_, i) => i !== clampedActive) : ranges;

    CSS.highlights.set('dms-md-match', new Highlight(...restRanges));
    if (activeRange) {
      CSS.highlights.set('dms-md-match-active', new Highlight(activeRange));
      activeRange.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      CSS.highlights.delete('dms-md-match-active');
    }
    return undefined;
  }, [isMarkdown, document.preview, searchQuery, mdActiveMatchIndex]);

  useEffect(() => () => {
    if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
      CSS.highlights.delete('dms-md-match');
      CSS.highlights.delete('dms-md-match-active');
    }
  }, []);

  function goToMdMatch(direction: 1 | -1) {
    if (mdMatchCount === 0) return;
    setMdActiveMatchIndex((current) => (current + direction + mdMatchCount) % mdMatchCount);
  }

  // A PDF/image iframe or <img> that never fires load/error (a corrupted blob, or
  // a silent CSP/X-Frame-Options block some browsers don't surface as an `error`
  // event) used to leave the loading spinner spinning forever with no way out.
  useEffect(() => {
    setHasTimedOut(false);
    if (!isLoading || !isRetryableLoad) return;
    const timer = window.setTimeout(() => setHasTimedOut(true), STUCK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading, isRetryableLoad, document, retryKey]);

  function handleRetryLoad() {
    setHasTimedOut(false);
    setHasError(false);
    setIsLoading(true);
    setRetryKey((key) => key + 1);
  }

  const totalPages = document.preview.kind === 'word'
    ? chunkArray(document.preview.paragraphs, PARAGRAPHS_PER_PAGE).length
    : document.preview.kind === 'presentation'
      ? document.preview.slides.length
      : document.preview.kind === 'spreadsheet'
        ? document.preview.sheets.length
        : 0;

  const searchIndex = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    const byGroup = new Map<string, SearchOccurrence[]>();
    const matchPages: number[] = [];
    if (!trimmed) return { totalMatches: 0, byGroup, matchPages };

    const groups = buildSearchGroups(document.preview);
    let globalIndex = 0;
    for (const group of groups) {
      const lowerText = group.text.toLowerCase();
      const occurrences: SearchOccurrence[] = [];
      let cursor = 0;
      while (true) {
        const idx = lowerText.indexOf(trimmed, cursor);
        if (idx === -1) break;
        occurrences.push({ globalIndex, start: idx });
        matchPages.push(group.pageIndex);
        globalIndex += 1;
        cursor = idx + trimmed.length;
      }
      if (occurrences.length > 0) byGroup.set(group.key, occurrences);
    }
    return { totalMatches: globalIndex, byGroup, matchPages };
  }, [document.preview, searchQuery]);

  // Reset to the first match whenever the query changes, and jump the page/slide/
  // sheet view to wherever the active match actually lives.
  useEffect(() => { setActiveMatchIndex(0); setMdActiveMatchIndex(0); }, [searchQuery]);
  useEffect(() => {
    if (searchIndex.totalMatches === 0) return;
    const clampedIndex = Math.min(activeMatchIndex, searchIndex.totalMatches - 1);
    const targetPage = searchIndex.matchPages[clampedIndex];
    if (targetPage !== undefined) setPageIndex(targetPage);
  }, [activeMatchIndex, searchIndex]);
  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMatchIndex, pageIndex, searchQuery]);

  function renderSearchable(groupKey: string, text: string): ReactNode {
    if (!searchQuery.trim()) return text;
    const occurrences = searchIndex.byGroup.get(groupKey);
    if (!occurrences || occurrences.length === 0) return text;

    const nodes: ReactNode[] = [];
    let cursor = 0;
    occurrences.forEach((occurrence, i) => {
      if (occurrence.start > cursor) nodes.push(text.slice(cursor, occurrence.start));
      const isActive = occurrence.globalIndex === Math.min(activeMatchIndex, searchIndex.totalMatches - 1);
      nodes.push(
        <mark
          key={`${groupKey}-${i}`}
          ref={isActive ? (el) => { activeMatchRef.current = el; } : undefined}
          className={isActive ? 'rounded bg-orange-400 px-0.5 text-white' : 'rounded bg-yellow-300/70 px-0.5 text-[#26334d]'}
        >
          {text.slice(occurrence.start, occurrence.start + searchQuery.trim().length)}
        </mark>,
      );
      cursor = occurrence.start + searchQuery.trim().length;
    });
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
  }

  function goToMatch(direction: 1 | -1) {
    if (searchIndex.totalMatches === 0) return;
    setActiveMatchIndex((current) => {
      const next = (current + direction + searchIndex.totalMatches) % searchIndex.totalMatches;
      return next;
    });
  }

  function handlePrint() {
    if (document.preview.kind === 'pdf' || document.preview.kind === 'office-embed') {
      const frameWindow = pdfIframeRef.current?.contentWindow;
      if (frameWindow) {
        frameWindow.focus();
        frameWindow.print();
        return;
      }
    }
    window.print();
  }

  // Separate from the Escape/Tab handler below since it needs to react to
  // document/totalPages changes directly instead of stale closures.
  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if (!isTypingTarget && isSearchable && event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (isTypingTarget) return;

      if (canPaginate && event.key === 'ArrowDown') {
        event.preventDefault();
        setPageIndex((current) => Math.min(current + 1, totalPages - 1));
      } else if (canPaginate && event.key === 'ArrowUp') {
        event.preventDefault();
        setPageIndex((current) => Math.max(current - 1, 0));
      } else if (canPaginate && event.key === 'Home') {
        event.preventDefault();
        setPageIndex(0);
      } else if (canPaginate && event.key === 'End') {
        event.preventDefault();
        setPageIndex(Math.max(totalPages - 1, 0));
      } else if (isZoomable && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
      } else if (isZoomable && event.key === '-') {
        event.preventDefault();
        setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
      } else if (isZoomable && event.key === '0') {
        event.preventDefault();
        setZoom(100);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [document, totalPages, canPaginate, isZoomable, isSearchable]);

  useEffect(() => {
    const previouslyFocused = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    const previousBodyOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    // Marks the body so the print stylesheet knows to hide everything except the
    // preview's #dms-printable-preview content — see globals.css.
    window.document.body.classList.add('dms-preview-open');
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
      window.document.body.classList.remove('dms-preview-open');
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const renderPreview = () => {
    if (hasError) return <PreviewFallback onDownload={() => onDownload(document)} />;

    switch (document.preview.kind) {
      case 'loading':
        return null;
      case 'markdown':
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <PreviewToolbar
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
            />
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <div ref={markdownContainerRef} style={getZoomStyle(zoom) as ZoomableStyle}>
                <MarkdownViewer content={document.preview.content} />
              </div>
            </div>
          </div>
        );
      case 'text':
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <PreviewToolbar
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
            />
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <div style={getZoomStyle(zoom) as ZoomableStyle}>
                <pre className="whitespace-pre-wrap rounded-[4px] border border-[#e2e8f0] bg-white p-6 font-mono text-sm leading-7 text-[#334155] shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200">{renderSearchable('content', document.preview.content)}</pre>
              </div>
            </div>
          </div>
        );
      case 'image':
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <PreviewToolbar
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#eef2f7] p-6 dark:bg-slate-950">
              <div style={getZoomStyle(zoom) as ZoomableStyle}>
                <img key={retryKey} src={document.preview.url} alt={document.preview.alt} className="max-h-[65vh] max-w-full rounded object-contain shadow-lg" onLoad={() => setIsLoading(false)} onError={() => { setIsLoading(false); setHasError(true); }} />
              </div>
            </div>
            {document.preview.ocrText ? (
              <div className="max-h-40 flex-shrink-0 overflow-auto border-t border-[#e2e8f0] bg-white p-4 dark:border-white/10 dark:bg-slate-900">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8494ac] dark:text-slate-500">Extracted text (searchable)</p>
                <pre className="whitespace-pre-wrap font-mono text-sm leading-6 text-[#334155] dark:text-slate-200">{renderSearchable('ocr', document.preview.ocrText)}</pre>
              </div>
            ) : (
              <p className="flex-shrink-0 border-t border-[#e2e8f0] bg-white px-4 py-2 text-xs text-[#8494ac] dark:border-white/10 dark:bg-slate-900 dark:text-slate-500">
                Extracting text from this image for search…
              </p>
            )}
          </div>
        );
      case 'pdf':
        return (
          <>
            <PdfJsViewer
              key={retryKey}
              ref={pdfViewerRef}
              url={document.preview.url}
              searchQuery={searchQuery}
              onReady={() => setIsLoading(false)}
              onError={() => { setIsLoading(false); setHasError(true); }}
              onMatchInfoChange={setPdfMatchInfo}
            />
            {/* Hidden — exists only so Print can trigger the browser's native PDF
                print dialog via contentWindow.print(); the visible viewer above is
                the pdf.js canvas renderer, which has no print API of its own. */}
            <iframe
              ref={pdfIframeRef}
              src={document.preview.url}
              title=""
              aria-hidden="true"
              tabIndex={-1}
              style={{ position: 'fixed', width: 0, height: 0, border: 'none', left: '-9999px' }}
            />
          </>
        );
      case 'word': {
        const pages = chunkArray(document.preview.paragraphs, PARAGRAPHS_PER_PAGE);
        const safePageIndex = Math.min(pageIndex, pages.length - 1);
        const currentParagraphs = pages[safePageIndex] ?? [];
        const totalParagraphs = document.preview.totalParagraphs ?? document.preview.paragraphs.length;
        return (
          <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
            <PreviewToolbar
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
              <RenderNoticeBanner message={document.preview.renderNotice} />
              <TruncationBanner shown={document.preview.paragraphs.length} total={totalParagraphs} unit="paragraphs" />
              <div className="mx-auto" style={{ ...getZoomStyle(zoom), maxWidth: '760px' } as ZoomableStyle}>
                <div className="px-8 py-10 sm:px-14">
                  {safePageIndex === 0 && <h3 className="text-2xl font-semibold text-[#2f3e83] dark:text-white">{document.preview.title}</h3>}
                  <div className="mt-8 space-y-5 text-[15px] leading-7 text-[#3f4d65] dark:text-slate-300">
                    {currentParagraphs.map((paragraph, idx) => {
                      const globalIndex = safePageIndex * PARAGRAPHS_PER_PAGE + idx;
                      return <p key={globalIndex}>{renderSearchable(`p-${globalIndex}`, paragraph)}</p>;
                    })}
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
            <PreviewToolbar
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
              onZoomReset={() => setZoom(100)}
              pageLabel={`Sheet ${safeSheetIndex + 1} of ${sheets.length}`}
              onPrev={() => setPageIndex((i) => Math.max(i - 1, 0))}
              onNext={() => setPageIndex((i) => Math.min(i + 1, sheets.length - 1))}
              canPrev={safeSheetIndex > 0}
              canNext={safeSheetIndex < sheets.length - 1}
            />
            <div className="flex-shrink-0 px-4 pt-3">
              <TruncationBanner shown={activeSheet.rows.length} total={activeSheet.totalRows ?? activeSheet.rows.length} unit="rows" />
              {(activeSheet.totalColumns ?? activeSheet.columns.length) > activeSheet.columns.length && (
                <TruncationBanner shown={activeSheet.columns.length} total={activeSheet.totalColumns ?? activeSheet.columns.length} unit="columns" />
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div style={getZoomStyle(zoom) as ZoomableStyle}>
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[#eff6f1] text-[#3f5e49] dark:bg-emerald-950/40 dark:text-emerald-100">
                    <tr>
                      {activeSheet.rowNumbers && (
                        <th className="sticky left-0 z-20 w-10 border-b border-r border-[#dbe2ec] bg-[#eff6f1] px-2 py-3 text-center font-semibold dark:border-white/10 dark:bg-emerald-950/40" />
                      )}
                      {activeSheet.columns.map((column, columnIndex) => (
                        <th key={column} className={`border-b border-r border-[#dbe2ec] px-4 py-3 font-semibold last:border-r-0 dark:border-white/10 ${activeSheet.rowNumbers ? 'text-center' : ''}`}>
                          {renderSearchable(`header-${safeSheetIndex}-${columnIndex}`, column)}
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
                            {renderSearchable(`cell-${safeSheetIndex}-${rowIndex}-${cellIndex}`, cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        const totalSlides = document.preview.totalSlides ?? slides.length;
        return (
          <div className="flex h-full w-full flex-col">
            <PreviewToolbar
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
              <RenderNoticeBanner message={document.preview.renderNotice} />
              <TruncationBanner shown={slides.length} total={totalSlides} unit="slides" />
              <div className="mx-auto" style={getZoomStyle(zoom) as ZoomableStyle}>
                <section className="aspect-video w-[720px] max-w-full rounded-[5px] border border-[#dbe2ec] bg-white p-8 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-12">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#94a3b8]">Slide {safeSlideIndex + 1}</span>
                  <h3 className="mt-4 text-2xl font-semibold text-[#2f3e83] dark:text-white">{renderSearchable(`slide-${safeSlideIndex}-title`, slide.title)}</h3>
                  <ul className="mt-7 space-y-3 text-base text-[#52627a] dark:text-slate-300">{slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex} className="flex gap-3"><span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#3f8bca]" />{renderSearchable(`slide-${safeSlideIndex}-bullet-${bulletIndex}`, bullet)}</li>)}</ul>
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
            ref={pdfIframeRef}
            src={document.preview.url}
            title={`Preview of ${document.fileName}`}
            className="block h-full w-full rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10"
            sandbox="allow-same-origin allow-scripts allow-forms allow-modals"
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
        <header className="flex flex-shrink-0 flex-col gap-2 border-b border-[#dbe2ec] bg-white px-6 py-3 dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <h2 id="document-preview-title" className="text-base font-semibold text-[#283a7a] dark:text-white truncate">{document.fileName}</h2>
              <span className="inline-flex items-center gap-1 rounded bg-[#d8f5e4] px-2 py-0.5 text-xs font-medium text-[#27885a]"><Lock className="h-3 w-3" />View Only</span>
            </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            {isSearchable && (
              <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-[#f7fafc] dark:border-white/10 dark:bg-slate-800">
                <Search className="ml-2 h-3.5 w-3.5 text-[#8494ac]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const direction = event.shiftKey ? -1 : 1;
                      if (isPdf) pdfViewerRef.current?.goToMatch(direction);
                      else if (isMarkdown) goToMdMatch(direction);
                      else goToMatch(direction);
                    } else if (event.key === 'Escape' && searchQuery) {
                      event.stopPropagation();
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search in document (/)"
                  aria-label="Search in document"
                  className="w-40 bg-transparent px-2 py-1.5 text-xs text-[#34425b] outline-none placeholder:text-[#9aa7ba] dark:text-slate-200"
                />
                {searchQuery && (() => {
                  const totalMatches = isPdf ? pdfMatchInfo.total : isMarkdown ? mdMatchCount : searchIndex.totalMatches;
                  const currentIndex = isPdf ? pdfMatchInfo.activeIndex : isMarkdown ? mdActiveMatchIndex : activeMatchIndex;
                  const handlePrevMatch = () => (isPdf ? pdfViewerRef.current?.goToMatch(-1) : isMarkdown ? goToMdMatch(-1) : goToMatch(-1));
                  const handleNextMatch = () => (isPdf ? pdfViewerRef.current?.goToMatch(1) : isMarkdown ? goToMdMatch(1) : goToMatch(1));
                  return (
                    <>
                      <span className="whitespace-nowrap px-1 text-xs text-[#718198] dark:text-slate-400">
                        {(isPdf && pdfMatchInfo.isIndexing) || isImageIndexing ? 'Indexing…' : totalMatches > 0 ? `${Math.min(currentIndex, totalMatches - 1) + 1}/${totalMatches}` : '0/0'}
                      </span>
                      <button type="button" onClick={handlePrevMatch} disabled={totalMatches === 0 || isImageIndexing} aria-label="Previous match" title="Previous match (Shift+Enter)" className="border-l border-[#dbe2ec] p-1.5 text-[#52627a] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-900">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={handleNextMatch} disabled={totalMatches === 0 || isImageIndexing} aria-label="Next match" title="Next match (Enter)" className="border-l border-[#dbe2ec] p-1.5 text-[#52627a] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-900">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" title="Clear search" className="border-l border-[#dbe2ec] p-1.5 text-[#52627a] hover:bg-white dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-900">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
            <button
              onClick={handlePrint}
              disabled={!permissions?.viewOnly}
              title={!permissions?.viewOnly ? 'Your role does not have permission to view this document' : 'Print'}
              className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
              aria-label={`Print ${document.fileName}`}
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            {document.status === 'draft' && onSubmitForApproval && (
              <button
                onClick={() => onSubmitForApproval(document)}
                disabled={!permissions?.submitForApproval}
                title={!permissions?.submitForApproval ? 'Your role does not have Submit for Approval permission' : undefined}
                className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#399a68] px-3 text-xs font-medium text-white hover:bg-[#2f895b] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#399a68]"
                aria-label={`Submit ${document.fileName} for approval`}
              >
                Submit for Approval
              </button>
            )}
            <button
              onClick={() => setShowEditModal(true)}
              disabled={!permissions?.edit}
              title={!permissions?.edit ? 'Your role does not have permission to edit this document' : 'Edit description, tags, version, category, department, owner'}
              className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
              aria-label={`Edit ${document.fileName}`}
            >
              <FilePen className="h-4 w-4" /> Edit
            </button>
            {permissions?.downloadForEditing && onDownloadForEditing && (
              <button onClick={() => onDownloadForEditing(document)} className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label={`Download ${document.fileName} for editing`} title="Download the original file for editing — locks it for you for 1 hour">
                <PencilLine className="h-4 w-4" /> Download for Editing
              </button>
            )}
            <input
              ref={newVersionInputRef}
              type="file"
              className="hidden"
              aria-label="Upload new version"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setPendingVersionFile(file);
                event.target.value = '';
              }}
            />
            {permissions?.upload && (
              <button
                onClick={() => newVersionInputRef.current?.click()}
                className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
                aria-label={`Upload updated file for ${document.fileName}`}
                title={document.checkoutStatus === 'checked_out' ? 'Uploading the updated file replaces this version and unlocks it' : 'Upload the updated file as a new version'}
              >
                <UploadCloud className="h-4 w-4" /> {document.checkoutStatus === 'checked_out' ? 'Upload Updated File to Unlock' : 'Upload Updated File'}
              </button>
            )}
            <button
              onClick={() => setShowVersionHistory(true)}
              disabled={!permissions?.viewOnly}
              title={!permissions?.viewOnly ? 'Your role does not have permission to view this document' : 'Version history'}
              className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
              aria-label={`View version history of ${document.fileName}`}
            >
              <History className="h-4 w-4" /> History
            </button>
            <LegacyMetadataHistoryAction
              documentId={document.documentId}
              fileName={document.fileName}
            />
            <button
              onClick={() => setShowRelatedTasks(true)}
              disabled={!permissions?.viewOnly}
              title={!permissions?.viewOnly ? 'Your role does not have permission to view this document' : 'View every task ever raised against this document'}
              className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
              aria-label={`View related tasks for ${document.fileName}`}
            >
              <ClipboardList className="h-4 w-4" /> Related Tasks
            </button>
            <button
              onClick={() => onDownload(document)}
              disabled={!permissions?.downloadReadOnly}
              title={!permissions?.downloadReadOnly ? 'Your role does not have Download permission' : undefined}
              className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#3f8bca] px-3 text-xs font-medium text-white hover:bg-[#2f6f9f] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
              aria-label={`Download ${document.fileName}`}
            >
              <Download className="h-4 w-4" /> Download
            </button>
            <button ref={closeButtonRef} onClick={onClose} className="rounded p-2 text-[#718198] hover:bg-[#eef2f7] hover:text-[#283a7a] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label="Close document preview"><X className="h-5 w-5" /></button>
          </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-[#52627a] dark:text-slate-300">
            <div className="flex flex-wrap gap-3">
              {document.originalDocumentId && (
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Doc ID</p>
                  <p className="truncate font-mono">{document.originalDocumentId}</p>
                </div>
              )}
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
              {document.versionLabel && (
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Version</p>
                  <p className="truncate">{document.versionLabel}</p>
                </div>
              )}
              {document.checkoutStatus === 'checked_out' && (
                <div>
                  <p className="font-medium text-[#34425b] dark:text-slate-200">Lock</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-[#fde1e2] px-2 py-0.5 text-xs font-medium text-[#c73c44] dark:bg-red-500/15 dark:text-red-300">
                      <Lock className="h-3 w-3" /> Locked for editing{document.checkedOutByName ? ` by ${document.checkedOutByName}` : ''}
                    </span>
                    {permissions?.adminForceUnlock && onForceUnlock && (
                      <button
                        onClick={() => onForceUnlock(document)}
                        className="text-xs font-medium text-[#3f8bca] underline hover:text-[#2f6f9f]"
                        title="Unlock this document even though someone else checked it out"
                      >
                        Force Unlock
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <p className="font-medium text-[#34425b] dark:text-slate-200">Department</p>
                <p className="truncate">{document.department}</p>
              </div>
              <div>
                <p className="font-medium text-[#34425b] dark:text-slate-200">Category</p>
                <p className="truncate">{document.category || '\u2014'}</p>
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
              <div>
                <p className="font-medium text-[#34425b] dark:text-slate-200">Description</p>
                <p className="truncate text-[#52627a] dark:text-slate-400">{document.description || '—'}</p>
              </div>
            </div>
          </div>
        </header>

        <div data-testid="document-preview-body" className={`relative min-h-0 flex-1 overflow-hidden ${['pdf', 'word', 'presentation', 'spreadsheet', 'image', 'markdown', 'text'].includes(document.preview.kind) ? '' : 'p-6'}`}>
          {isLoading && hasTimedOut && isRetryableLoad && (
            <div className="absolute inset-6 z-10 flex items-center justify-center rounded-[4px] bg-white/95 dark:bg-slate-900/95" role="status">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <AlertCircle className="h-8 w-8 text-[#93a4bd]" />
                <p className="text-sm text-[#52627a] dark:text-slate-300">This is taking longer than expected to load.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={handleRetryLoad}>Retry</Button>
                  <Button variant="secondary" onClick={() => onDownload(document)} leftIcon={<Download className="h-4 w-4" />}>Download instead</Button>
                </div>
              </div>
            </div>
          )}
          {isLoading && !(hasTimedOut && isRetryableLoad) && (
            <div className="absolute inset-6 z-10 flex items-center justify-center rounded-[4px] bg-white/95 dark:bg-slate-900/95" role="status">
              <div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" /><p className="mt-3 text-sm text-[#718198]">{document.preview.kind === 'loading' ? document.preview.message : 'Loading preview...'}</p></div>
            </div>
          )}
          <div id="dms-printable-preview" className={`h-full w-full ${['pdf', 'word', 'presentation', 'spreadsheet', 'image', 'markdown', 'text'].includes(document.preview.kind) ? '' : 'overflow-auto'}`}>
            {renderPreview()}
          </div>
        </div>
      </section>

      {showEditModal && (
        <EditDocumentModal
          documentId={document.documentId}
          fileName={document.fileName}
          onClose={() => setShowEditModal(false)}
          onSaved={() => onDocumentUpdated?.()}
        />
      )}

      {pendingVersionFile && (
        <UploadNewVersionModal
          documentId={document.documentId}
          file={pendingVersionFile}
          onClose={() => setPendingVersionFile(null)}
          onUploaded={() => onDocumentUpdated?.()}
        />
      )}

      {showVersionHistory && (
        <VersionHistoryModal
          documentId={document.documentId}
          fileName={document.fileName}
          currentVersionId={document.currentVersionId}
          onClose={() => setShowVersionHistory(false)}
          onReverted={() => onDocumentUpdated?.()}
        />
      )}

      {showRelatedTasks && (
        <RelatedTasksModal
          documentId={document.documentId}
          fileName={document.fileName}
          onClose={() => setShowRelatedTasks(false)}
        />
      )}
    </div>
  );
}
