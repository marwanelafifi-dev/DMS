import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomOut,
  ZoomIn,
  Search,
  RotateCw,
  Printer,
  Download,
  X,
} from 'lucide-react';

interface PDFToolbarProps {
  currentPage: number;
  totalPages: number;
  zoom: number;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onPrint: () => void;
  onDownload: () => void;
  onSearch: (query: string) => void;
  onRotate: () => void;
}

export function PDFToolbar({
  currentPage,
  totalPages,
  zoom,
  onPageChange,
  onZoomChange,
  onPrint,
  onDownload,
  onSearch,
  onRotate,
}: PDFToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const navButtonClass =
    'p-2 text-white hover:text-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded';
  const actionButtonClass =
    'p-2 text-white hover:text-cyan-400 transition-all rounded';
  const secondaryButtonClass =
    'p-2 text-white hover:text-cyan-400 transition-all rounded';

  return (
    <div className="bg-navy-900 border-b border-navy-700 px-4 py-3 space-y-3">
      {/* Top Row: Page Navigation & Zoom */}
      <div className="flex items-center justify-between gap-4">
        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className={navButtonClass}
            title="Previous page"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 px-2">
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) =>
                onPageChange(Math.min(totalPages, Math.max(1, parseInt(e.target.value) || 1)))
              }
              className="w-12 px-2 py-1 text-sm text-white text-center bg-transparent focus:outline-none"
            />
            <span className="text-sm text-white font-medium">/ {totalPages}</span>
          </div>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className={navButtonClass}
            title="Next page"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onZoomChange(Math.max(50, zoom - 10))}
            className={secondaryButtonClass}
            title="Zoom out"
          >
            <ZoomOut className="w-5 h-5" />
          </button>

          <select
            value={zoom}
            onChange={(e) => onZoomChange(parseInt(e.target.value))}
            className="px-3 py-1.5 text-sm bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-cyan-400 font-medium cursor-pointer rounded"
          >
            <option value={50}>50%</option>
            <option value={75}>75%</option>
            <option value={100}>100%</option>
            <option value={125}>125%</option>
            <option value={150}>150%</option>
            <option value={200}>200%</option>
          </select>

          <button
            onClick={() => onZoomChange(Math.min(200, zoom + 10))}
            className={secondaryButtonClass}
            title="Zoom in"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={actionButtonClass}
            title="Search in document"
          >
            <Search className="w-5 h-5" />
          </button>

          <button
            onClick={onRotate}
            className={actionButtonClass}
            title="Rotate page"
          >
            <RotateCw className="w-5 h-5" />
          </button>

          <button
            onClick={onPrint}
            className={actionButtonClass}
            title="Print document"
          >
            <Printer className="w-5 h-5" />
          </button>

          <button
            onClick={onDownload}
            className={actionButtonClass}
            title="Download document"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 pt-2 border-t border-navy-700">
          <Search className="w-5 h-5 text-white flex-shrink-0" />
          <input
            type="text"
            placeholder="Search in document..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              onSearch(e.target.value);
            }}
            autoFocus
            className="flex-1 px-3 py-2 text-sm border border-gray-300 bg-white text-navy-900 placeholder-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
          />
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery('');
              onSearch('');
            }}
            className="p-1 text-navy-300 hover:text-white transition-colors rounded"
            title="Close search"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
