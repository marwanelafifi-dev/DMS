import { useState, useRef, useEffect } from 'react';
import { PDFToolbar } from './PDFToolbar';

interface PDFViewerProps {
  fileUrl: string;
  fileName: string;
}

export function PDFViewer({ fileUrl, fileName }: PDFViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mock PDF rendering - in production would use PDF.js
  useEffect(() => {
    // Simulate loading a PDF with 10 pages
    setTotalPages(10);
    renderPage();
  }, [currentPage, zoom, rotation]);

  const renderPage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mock PDF page rendering
    const width = 800 * (zoom / 100);
    const height = 1000 * (zoom / 100);

    canvas.width = width;
    canvas.height = height;

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw page number
    ctx.fillStyle = '#333333';
    ctx.font = `${24 * (zoom / 100)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${currentPage}`, width / 2, height / 2);

    // Draw subtle border
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // Apply rotation
    if (rotation !== 0) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-width / 2, -height / 2);
      ctx.restore();
    }
  };

  const handlePrint = () => {
    const printWindow = window.open(fileUrl, '_blank');
    if (printWindow) {
      printWindow.print();
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  const handleSearch = (query: string) => {
    console.log('Searching for:', query);
    // In production, would search PDF text
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  return (
    <div className="bg-white dark:bg-navy-900 rounded-lg border border-gray-200 dark:border-navy-800 overflow-hidden flex flex-col h-full shadow-sm">
      {/* Toolbar */}
      <PDFToolbar
        currentPage={currentPage}
        totalPages={totalPages}
        zoom={zoom}
        onPageChange={setCurrentPage}
        onZoomChange={setZoom}
        onPrint={handlePrint}
        onDownload={handleDownload}
        onSearch={handleSearch}
        onRotate={handleRotate}
      />

      {/* PDF Canvas Area */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-navy-950 flex items-center justify-center p-6">
        <div
          className="bg-white rounded-lg shadow-md overflow-hidden transition-transform"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <canvas
            ref={canvasRef}
            className="max-w-full"
            style={{ height: 'auto' }}
          />
        </div>
      </div>

      {/* Page Info Footer */}
      <div className="bg-navy-900 border-t border-navy-800 px-4 py-3 text-center text-sm text-white font-medium">
        Page <span className="text-white">{currentPage}</span> of{' '}
        <span className="text-white">{totalPages}</span> • Zoom{' '}
        <span className="text-white">{zoom}%</span>
      </div>
    </div>
  );
}
