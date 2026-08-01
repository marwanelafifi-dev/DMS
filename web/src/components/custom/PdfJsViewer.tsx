import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import { PreviewToolbar } from './PreviewToolbar';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
// Building a full-document search index means fetching every page's text content
// up front — bounded so a pathologically large PDF can't hang the tab.
const MAX_INDEXED_PAGES = 300;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function countMatches(text: string, query: string): number {
  if (!query) return 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (true) {
    const idx = lowerText.indexOf(lowerQuery, cursor);
    if (idx === -1) break;
    count += 1;
    cursor = idx + lowerQuery.length;
  }
  return count;
}

// Highlights every occurrence of `query` inside a rendered TextLayer's spans and
// marks the one at `activeLocalIndex` (0-based, within this page only) distinctly.
// Caveat: a match that spans two adjacent text-layer spans (pdf.js splits text
// into line/run fragments, not whole sentences) won't be detected here — the same
// granularity limitation pdf.js's own built-in find feature has.
function applySearchHighlight(textLayer: TextLayer, query: string, activeLocalIndex: number): HTMLElement | null {
  const trimmed = query.trim();
  let runningIndex = 0;
  let activeElement: HTMLElement | null = null;

  textLayer.textDivs.forEach((div, i) => {
    const original = textLayer.textContentItemsStr[i] ?? '';
    if (!trimmed) {
      div.textContent = original;
      return;
    }
    const lowerOriginal = original.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    if (!lowerOriginal.includes(lowerQuery)) {
      div.textContent = original;
      return;
    }

    let html = '';
    let cursor = 0;
    while (true) {
      const idx = lowerOriginal.indexOf(lowerQuery, cursor);
      if (idx === -1) break;
      const isActive = runningIndex === activeLocalIndex;
      html += escapeHtml(original.slice(cursor, idx));
      html += `<mark class="${isActive ? 'dms-pdf-match-active' : 'dms-pdf-match'}">${escapeHtml(original.slice(idx, idx + trimmed.length))}</mark>`;
      cursor = idx + trimmed.length;
      runningIndex += 1;
    }
    html += escapeHtml(original.slice(cursor));
    div.innerHTML = html;

    if (!activeElement) {
      const active = div.querySelector('.dms-pdf-match-active');
      if (active instanceof HTMLElement) activeElement = active;
    }
  });

  return activeElement;
}

interface SearchState {
  query: string;
  activeMatchIndex: number;
  pageMatchCounts: number[] | null;
}

function computeLocalActiveIndex(pageNumber: number, state: SearchState): number {
  if (!state.pageMatchCounts) return -1;
  let cumulative = 0;
  for (let p = 0; p < pageNumber - 1; p += 1) cumulative += state.pageMatchCounts[p] ?? 0;
  const countOnPage = state.pageMatchCounts[pageNumber - 1] ?? 0;
  const local = state.activeMatchIndex - cumulative;
  return local >= 0 && local < countOnPage ? local : -1;
}

export interface PdfMatchInfo {
  total: number;
  activeIndex: number;
  isIndexing: boolean;
}

export interface PdfJsViewerHandle {
  goToMatch: (direction: 1 | -1) => void;
}

interface PdfJsViewerProps {
  url: string;
  searchQuery: string;
  onReady?: () => void;
  onError?: () => void;
  onMatchInfoChange?: (info: PdfMatchInfo) => void;
}

export const PdfJsViewer = forwardRef<PdfJsViewerHandle, PdfJsViewerProps>(function PdfJsViewer(
  { url, searchQuery, onReady, onError, onMatchInfoChange },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const currentTextLayerRef = useRef<TextLayer | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const searchStateRef = useRef<SearchState>({ query: '', activeMatchIndex: 0, pageMatchCounts: null });

  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [baseScale, setBaseScale] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isDocLoading, setIsDocLoading] = useState(true);
  const [hasDocError, setHasDocError] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [pageMatchCounts, setPageMatchCounts] = useState<number[] | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const [indexedPageCount, setIndexedPageCount] = useState(0);

  useEffect(() => {
    searchStateRef.current = { query: searchQuery, activeMatchIndex, pageMatchCounts };
  }, [searchQuery, activeMatchIndex, pageMatchCounts]);

  // Load the PDF document whenever the source URL changes.
  useEffect(() => {
    let cancelled = false;
    setIsDocLoading(true);
    setHasDocError(false);
    setNumPages(0);
    setPageNumber(1);
    setActiveMatchIndex(0);
    setPageMatchCounts(null);
    setIsIndexed(false);
    pageTextCacheRef.current = new Map();

    const loadingTask = getDocument(url);
    loadingTask.promise.then((doc) => {
      if (cancelled) {
        void doc.destroy();
        return;
      }
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
      setIsDocLoading(false);
      onReady?.();
    }).catch((error) => {
      if (cancelled) return;
      console.error('Failed to load PDF document:', error);
      setIsDocLoading(false);
      setHasDocError(true);
      onError?.();
    });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
      pdfDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Fit-to-width base scale, computed once the document and its first page are ready.
  useEffect(() => {
    if (numPages === 0 || !pdfDocRef.current || !containerRef.current) return;
    let cancelled = false;
    pdfDocRef.current.getPage(1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current?.clientWidth ?? viewport.width;
      const fitScale = Math.max(0.3, (containerWidth - 48) / viewport.width);
      setBaseScale(fitScale);
    });
    return () => { cancelled = true; };
  }, [numPages]);

  const effectiveScale = baseScale * (zoomPercent / 100);

  // Render the current page to canvas + text layer whenever the page or scale changes.
  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;
    if (!pdfDoc || !canvas || !textLayerContainer || pageNumber < 1 || numPages === 0) return;

    let cancelled = false;

    (async () => {
      try {
        // A prior render onto this same canvas (e.g. still in flight when
        // baseScale/effectiveScale changes right after the initial fit-to-width
        // calculation) must be cancelled before starting a new one — pdf.js
        // throws "Cannot use the same canvas during multiple render() operations"
        // otherwise, which aborted the page render entirely.
        renderTaskRef.current?.cancel();

        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: effectiveScale });
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
        if (cancelled) return;

        textLayerContainer.innerHTML = '';
        textLayerContainer.style.width = `${viewport.width}px`;
        textLayerContainer.style.height = `${viewport.height}px`;
        // pdf.js's TextLayer sizes/positions every text span via calc(var(--scale-factor) * ...)
        // (see pdf.mjs's TextLayer div styling) — not "--total-scale-factor", which isn't read
        // anywhere in pdf.js. Setting the wrong variable name left this permanently unset, so
        // the text layer silently fell back to the global default of 1 regardless of the actual
        // render scale, making the (normally invisible) text spans — and any <mark> highlight
        // inside them — render undersized and mispositioned relative to the canvas.
        textLayerContainer.style.setProperty('--scale-factor', String(effectiveScale));

        const textContent = await page.getTextContent();
        if (cancelled) return;
        const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerContainer, viewport });
        await textLayer.render();
        if (cancelled) return;
        currentTextLayerRef.current = textLayer;

        const localIndex = computeLocalActiveIndex(pageNumber, searchStateRef.current);
        applySearchHighlight(textLayer, searchStateRef.current.query, localIndex);
      } catch (error) {
        // A render task cancelled by the guard above (or by this effect's own
        // cleanup below) rejects with RenderingCancelledException — expected
        // when a newer render supersedes it, not a real failure to surface.
        const isCancellation = error instanceof Error && error.name === 'RenderingCancelledException';
        if (!cancelled && !isCancellation) console.error('Failed to render PDF page:', error);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, effectiveScale, numPages]);

  // Build a full-document text index the first time a search is attempted.
  useEffect(() => {
    if (!searchQuery.trim() || isIndexed || isIndexing || !pdfDocRef.current || numPages === 0) return;
    const pdfDoc = pdfDocRef.current;
    const pagesToIndex = Math.min(numPages, MAX_INDEXED_PAGES);
    setIsIndexing(true);

    (async () => {
      const batchSize = 8;
      for (let start = 1; start <= pagesToIndex; start += batchSize) {
        const batch: number[] = [];
        for (let p = start; p < start + batchSize && p <= pagesToIndex; p += 1) batch.push(p);
        await Promise.all(batch.map(async (p) => {
          if (pageTextCacheRef.current.has(p)) return;
          const page = await pdfDoc.getPage(p);
          const content = await page.getTextContent();
          const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
          pageTextCacheRef.current.set(p, text);
        }));
      }
      setIndexedPageCount(pagesToIndex);
      setIsIndexing(false);
      setIsIndexed(true);
    })();
  }, [searchQuery, isIndexed, isIndexing, numPages]);

  // Recompute per-page match counts once the index is ready or the query changes.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!isIndexed || !trimmed) {
      setPageMatchCounts(null);
      return;
    }
    const counts: number[] = [];
    for (let p = 1; p <= numPages; p += 1) {
      counts.push(countMatches(pageTextCacheRef.current.get(p) ?? '', trimmed));
    }
    setPageMatchCounts(counts);
    setActiveMatchIndex(0);
  }, [searchQuery, isIndexed, numPages]);

  // Jump to whichever page the active match lives on, and re-highlight in place
  // when the active match is already on the currently rendered page.
  useEffect(() => {
    if (!pageMatchCounts) return;
    let cumulative = 0;
    for (let p = 0; p < pageMatchCounts.length; p += 1) {
      const count = pageMatchCounts[p];
      if (activeMatchIndex < cumulative + count) {
        const targetPage = p + 1;
        if (targetPage !== pageNumber) {
          setPageNumber(targetPage);
        } else if (currentTextLayerRef.current) {
          const localIndex = computeLocalActiveIndex(targetPage, { query: searchQuery, activeMatchIndex, pageMatchCounts });
          const activeElement = applySearchHighlight(currentTextLayerRef.current, searchQuery, localIndex);
          activeElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }
      cumulative += count;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchIndex, pageMatchCounts]);

  // Clearing the query should immediately un-highlight the current page even
  // though no page/scale change (and therefore no re-render) is happening.
  useEffect(() => {
    if (searchQuery.trim() || !currentTextLayerRef.current) return;
    applySearchHighlight(currentTextLayerRef.current, '', -1);
  }, [searchQuery]);

  const totalMatches = pageMatchCounts?.reduce((sum, count) => sum + count, 0) ?? 0;

  function goToMatch(direction: 1 | -1) {
    if (totalMatches === 0) return;
    setActiveMatchIndex((current) => (current + direction + totalMatches) % totalMatches);
  }

  useImperativeHandle(forwardedRef, () => ({ goToMatch }), [totalMatches]);

  // The search box itself lives in the shared DocumentPreview header (consistent
  // placement across every preview kind) — report match state up so it can render
  // the "X/Y" counter and enable/disable the prev/next buttons for this PDF too.
  useEffect(() => {
    onMatchInfoChange?.({ total: totalMatches, activeIndex: activeMatchIndex, isIndexing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMatches, activeMatchIndex, isIndexing]);

  function goToPage(next: number) {
    setPageNumber(Math.min(Math.max(next, 1), Math.max(numPages, 1)));
  }

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        goToPage(pageNumber + 1);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(pageNumber - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToPage(numPages);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoomPercent((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
      } else if (event.key === '-') {
        event.preventDefault();
        setZoomPercent((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
      } else if (event.key === '0') {
        event.preventDefault();
        setZoomPercent(100);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [pageNumber, numPages]);

  if (hasDocError) return null;

  return (
    <div data-testid="pdf-js-viewer" className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
      <PreviewToolbar
        zoom={zoomPercent}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomIn={() => setZoomPercent((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
        onZoomOut={() => setZoomPercent((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
        onZoomReset={() => setZoomPercent(100)}
        pageLabel={`Page ${pageNumber} of ${numPages || 1}`}
        onPrev={() => goToPage(pageNumber - 1)}
        onNext={() => goToPage(pageNumber + 1)}
        canPrev={pageNumber > 1}
        canNext={pageNumber < numPages}
      />
      {isIndexed && indexedPageCount < numPages && (
        <div className="flex-shrink-0 border-b border-[#f3d48a] bg-[#fff8e6] px-4 py-1.5 text-xs font-medium text-[#8a6412] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Search only covers the first {indexedPageCount} of {numPages} pages.
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-[#eef2f7] p-6 dark:bg-slate-950">
        {isDocLoading ? null : (
          <div className="relative mx-auto w-fit shadow-lg">
            <canvas ref={canvasRef} className="block" />
            <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
          </div>
        )}
      </div>
    </div>
  );
});
