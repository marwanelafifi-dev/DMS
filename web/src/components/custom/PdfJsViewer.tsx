import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import { PreviewToolbar } from './PreviewToolbar';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
// Building a full-document search index means fetching every page's text content
// up front — bounded so a pathologically large PDF can't hang the tab.
const MAX_INDEXED_PAGES = 300;
// How far outside the visible viewport a page is still eagerly rendered — lets
// scrolling feel continuous (the next page is usually already drawn by the
// time it comes into view) without rendering every page in a large document
// up front.
const RENDER_ROOT_MARGIN = '200px 0px';

interface PageSize {
  width: number;
  height: number;
}

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

// One page within the continuous-scroll list. Renders lazily (only once its
// container has scrolled near the viewport) so a large document doesn't pay
// the cost of rendering every page up front — the whole point of switching
// away from the old one-page-at-a-time viewer is that scrolling should feel
// like a normal PDF reader, not that every page renders immediately.
function PdfPage({
  pdfDoc, pageNumber, scale, estimatedSize, searchQuery, localActiveIndex, registerContainer, registerTextLayer, onRendered,
}: {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  estimatedSize: PageSize;
  searchQuery: string;
  localActiveIndex: number;
  registerContainer: (pageNumber: number, el: HTMLDivElement | null) => void;
  registerTextLayer: (pageNumber: number, layer: TextLayer | null) => void;
  onRendered: (pageNumber: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setShouldRender(true); },
      { rootMargin: RENDER_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setSize({ width: viewport.width, height: viewport.height });
        textLayerInstanceRef.current = null;
        registerTextLayer(pageNumber, null);
        if (textLayerRef.current) textLayerRef.current.innerHTML = '';

        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        renderTask = null;
        if (cancelled) return;
        onRendered(pageNumber);
      } catch (error) {
        const isCancellation = error instanceof Error && error.name === 'RenderingCancelledException';
        if (!cancelled && !isCancellation) console.error(`Failed to render PDF page ${pageNumber}:`, error);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // Re-render when the page becomes visible or the zoom scale changes — search
    // query/active-index changes re-highlight in place instead (see the effect
    // below), they don't need a full re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRender, scale, pageNumber, pdfDoc]);

  // Text-layer construction can add thousands of positioned spans to a dense
  // legacy Word/PDF page. It is useful for in-document search, but doing it
  // before the first paint made opening a DOC look frozen long after its canvas
  // was already available. Build it only when the user actually searches; the
  // visual page stays complete and read-only without paying that startup cost.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!shouldRender || !query) return;

    const existingLayer = textLayerInstanceRef.current;
    if (existingLayer) {
      applySearchHighlight(existingLayer, query, localActiveIndex);
      return;
    }

    let cancelled = false;
    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const container = textLayerRef.current;
      if (!container) return;
      container.innerHTML = '';
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      container.style.setProperty('--scale-factor', String(scale));
      const textContent = await page.getTextContent();
      if (cancelled) return;
      const textLayer = new TextLayer({ textContentSource: textContent, container, viewport });
      await textLayer.render();
      if (cancelled) return;
      textLayerInstanceRef.current = textLayer;
      registerTextLayer(pageNumber, textLayer);
      applySearchHighlight(textLayer, query, localActiveIndex);
    })().catch((error) => {
      if (!cancelled) console.error(`Failed to build PDF text layer for page ${pageNumber}:`, error);
    });

    return () => { cancelled = true; };
  }, [shouldRender, searchQuery, localActiveIndex, scale, pageNumber, pdfDoc, registerTextLayer]);

  return (
    <div
      ref={(el) => { wrapperRef.current = el; registerContainer(pageNumber, el); }}
      className="relative mx-auto mb-4 bg-white shadow-lg"
      style={size
        ? { width: size.width, height: size.height, maxWidth: '100%' }
        : { width: estimatedSize.width, maxWidth: '100%', aspectRatio: `${estimatedSize.width} / ${estimatedSize.height}` }}
    >
      {shouldRender && (
        <>
          <canvas ref={canvasRef} className="block" />
          <div ref={textLayerRef} className="textLayer absolute left-0 top-0" />
        </>
      )}
    </div>
  );
}

export const PdfJsViewer = forwardRef<PdfJsViewerHandle, PdfJsViewerProps>(function PdfJsViewer(
  { url, searchQuery, onReady, onError, onMatchInfoChange },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageTextLayerRefs = useRef<Map<number, TextLayer>>(new Map());
  const searchStateRef = useRef<SearchState>({ query: '', activeMatchIndex: 0, pageMatchCounts: null });

  const [numPages, setNumPages] = useState(0);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [baseScale, setBaseScale] = useState(1);
  const [pageBaseSize, setPageBaseSize] = useState<PageSize | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isDocLoading, setIsDocLoading] = useState(true);
  const [hasDocError, setHasDocError] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [pageMatchCounts, setPageMatchCounts] = useState<number[] | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const [indexedPageCount, setIndexedPageCount] = useState(0);
  const hasNotifiedReadyRef = useRef(false);

  useEffect(() => {
    searchStateRef.current = { query: searchQuery, activeMatchIndex, pageMatchCounts };
  }, [searchQuery, activeMatchIndex, pageMatchCounts]);

  // Load the PDF document whenever the source URL changes.
  useEffect(() => {
    let cancelled = false;
    setIsDocLoading(true);
    setHasDocError(false);
    setNumPages(0);
    setPdfDoc(null);
    setCurrentPage(1);
    setPageBaseSize(null);
    setActiveMatchIndex(0);
    setPageMatchCounts(null);
    setIsIndexed(false);
    hasNotifiedReadyRef.current = false;
    pageTextCacheRef.current = new Map();
    pageContainerRefs.current = new Map();
    pageTextLayerRefs.current = new Map();

    const loadingTask = getDocument(url);
    loadingTask.promise.then((doc) => {
      if (cancelled) {
        void doc.destroy();
        return;
      }
      pdfDocRef.current = doc;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setIsDocLoading(false);
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
      setPageBaseSize({ width: viewport.width, height: viewport.height });
      setBaseScale(fitScale);
    });
    return () => { cancelled = true; };
  }, [numPages]);

  const effectiveScale = baseScale * (zoomPercent / 100);
  const estimatedSize = pageBaseSize
    ? { width: pageBaseSize.width * effectiveScale, height: pageBaseSize.height * effectiveScale }
    : null;

  // Tracks which page is most visible in the scroll container so the toolbar's
  // "Page X of Y" label reflects normal scrolling, not just explicit Prev/Next
  // clicks — same idea as a real PDF reader's page counter.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || numPages === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) return;
        const pageNum = Number((mostVisible.target as HTMLElement).dataset.pageNumber);
        if (pageNum) setCurrentPage(pageNum);
      },
      { root, threshold: [0.5] },
    );
    pageContainerRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, effectiveScale]);

  const registerContainer = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) {
      el.dataset.pageNumber = String(pageNumber);
      pageContainerRefs.current.set(pageNumber, el);
    } else {
      pageContainerRefs.current.delete(pageNumber);
    }
  }, []);

  const registerTextLayer = useCallback((pageNumber: number, layer: TextLayer | null) => {
    if (layer) pageTextLayerRefs.current.set(pageNumber, layer);
    else pageTextLayerRefs.current.delete(pageNumber);
  }, []);

  // Build a full-document text index the first time a search is attempted.
  useEffect(() => {
    if (!searchQuery.trim() || isIndexed || isIndexing || !pdfDocRef.current || numPages === 0) return;
    const pdfDocForIndex = pdfDocRef.current;
    const pagesToIndex = Math.min(numPages, MAX_INDEXED_PAGES);
    setIsIndexing(true);

    (async () => {
      const batchSize = 8;
      for (let start = 1; start <= pagesToIndex; start += batchSize) {
        const batch: number[] = [];
        for (let p = start; p < start + batchSize && p <= pagesToIndex; p += 1) batch.push(p);
        await Promise.all(batch.map(async (p) => {
          if (pageTextCacheRef.current.has(p)) return;
          const page = await pdfDocForIndex.getPage(p);
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

  // Scroll to whichever page the active match lives on, and re-highlight in
  // place (no re-render needed — the page's TextLayer instance is preserved
  // once it's been rendered once) whenever the active match or query changes.
  useEffect(() => {
    if (!pageMatchCounts) return;
    let cumulative = 0;
    for (let p = 0; p < pageMatchCounts.length; p += 1) {
      const count = pageMatchCounts[p];
      if (activeMatchIndex < cumulative + count) {
        const targetPage = p + 1;
        const localIndex = computeLocalActiveIndex(targetPage, { query: searchQuery, activeMatchIndex, pageMatchCounts });
        const container = pageContainerRefs.current.get(targetPage);
        container?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const textLayer = pageTextLayerRefs.current.get(targetPage);
        if (textLayer) {
          const activeElement = applySearchHighlight(textLayer, searchQuery, localIndex);
          activeElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }
      cumulative += count;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchIndex, pageMatchCounts]);

  // Clearing the query should immediately un-highlight every already-rendered
  // page even though nothing is re-rendering.
  useEffect(() => {
    if (searchQuery.trim()) return;
    pageTextLayerRefs.current.forEach((layer) => applySearchHighlight(layer, '', -1));
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

  const scrollToPage = useCallback((pageNumber: number) => {
    const target = Math.min(Math.max(pageNumber, 1), Math.max(numPages, 1));
    pageContainerRefs.current.get(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [numPages]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      // Arrow/Page keys nudge one page at a time for parity with the old
      // paginated viewer; regular scrolling (wheel/trackpad/scrollbar) moves
      // continuously through the whole document as normal.
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        scrollToPage(currentPage + 1);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        scrollToPage(currentPage - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        scrollToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        scrollToPage(numPages);
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
  }, [currentPage, numPages, scrollToPage]);

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
        pageLabel={`Page ${currentPage} of ${numPages || 1}`}
        onPrev={() => scrollToPage(currentPage - 1)}
        onNext={() => scrollToPage(currentPage + 1)}
        canPrev={currentPage > 1}
        canNext={currentPage < numPages}
      />
      {isIndexed && indexedPageCount < numPages && (
        <div className="flex-shrink-0 border-b border-[#f3d48a] bg-[#fff8e6] px-4 py-1.5 text-xs font-medium text-[#8a6412] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Search only covers the first {indexedPageCount} of {numPages} pages.
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-[#eef2f7] p-6 dark:bg-slate-950">
        {!isDocLoading && pdfDoc && estimatedSize && Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            pdfDoc={pdfDoc}
            pageNumber={pageNumber}
            scale={effectiveScale}
            estimatedSize={estimatedSize}
            searchQuery={searchQuery}
            localActiveIndex={computeLocalActiveIndex(pageNumber, searchStateRef.current)}
            registerContainer={registerContainer}
            registerTextLayer={registerTextLayer}
            onRendered={(renderedPageNumber) => {
              if (renderedPageNumber === 1 && !hasNotifiedReadyRef.current) {
                hasNotifiedReadyRef.current = true;
                onReady?.();
              }
            }}
          />
        ))}
      </div>
    </div>
  );
});
