import { ChevronDown, ChevronUp, ZoomIn, ZoomOut } from 'lucide-react';

export interface PreviewToolbarProps {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  pageLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}

// Shared across every preview kind (word/spreadsheet/presentation/markdown/image/
// text/pdf) so zoom controls and page/sheet/slide navigation always sit in the
// same place — right-aligned — regardless of format.
export function PreviewToolbar({
  zoom, minZoom = 50, maxZoom = 200, onZoomIn, onZoomOut, onZoomReset, pageLabel, onPrev, onNext, canPrev, canNext,
}: PreviewToolbarProps) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-4 border-b border-[#e2e8f0] bg-[#f7fafc] px-4 py-2.5 dark:border-white/10 dark:bg-slate-800">
      <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
        <button type="button" onClick={onZoomOut} disabled={zoom <= minZoom} aria-label="Zoom out" title="Zoom out (-)" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button type="button" onClick={onZoomReset} aria-label="Reset zoom" title="Reset zoom (0)" className="min-w-[3.25rem] border-x border-[#dbe2ec] px-1 py-1.5 text-xs font-medium text-[#34425b] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-800">
          {zoom}%
        </button>
        <button type="button" onClick={onZoomIn} disabled={zoom >= maxZoom} aria-label="Zoom in" title="Zoom in (+)" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
      {pageLabel !== undefined && (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs font-medium text-[#52627a] dark:text-slate-300">{pageLabel}</span>
          <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
            <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous" title="Previous (Up arrow / Home)" className="p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next" title="Next (Down arrow / End)" className="border-l border-[#dbe2ec] p-1.5 text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800">
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
