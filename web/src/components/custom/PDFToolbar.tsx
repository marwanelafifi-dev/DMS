import { useState } from 'react';

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

  return (
    <div className="bg-gray-100 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600 px-4 py-3 space-y-2">
      {/* Top Row: Page Navigation & Zoom */}
      <div className="flex items-center justify-between gap-4">
        {/* Page Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded disabled:opacity-50"
            title="Previous page"
          >
            ◀
          </button>

          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => onPageChange(Math.min(totalPages, Math.max(1, parseInt(e.target.value))))}
              className="w-12 px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-600 rounded text-center"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">/ {totalPages}</span>
          </div>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded disabled:opacity-50"
            title="Next page"
          >
            ▶
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onZoomChange(Math.max(50, zoom - 10))}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Zoom out"
          >
            🔍−
          </button>

          <select
            value={zoom}
            onChange={(e) => onZoomChange(parseInt(e.target.value))}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-600 rounded"
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
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Zoom in"
          >
            🔍+
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Search in document"
          >
            🔍
          </button>

          <button
            onClick={onRotate}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Rotate page"
          >
            ↻
          </button>

          <button
            onClick={onPrint}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Print document"
          >
            🖨️
          </button>

          <button
            onClick={onDownload}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            title="Download document"
          >
            ⬇️
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            placeholder="Search in document..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              onSearch(e.target.value);
            }}
            autoFocus
            className="flex-1 px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-600 rounded"
          />
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery('');
              onSearch('');
            }}
            className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
