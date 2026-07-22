import { useEffect, useRef, useState } from 'react';
import { PDFToolbar } from './PDFToolbar';

interface PDFViewerProps {
  fileUrl: string;
  fileName: string;
  readOnly?: boolean;
}

export function PDFViewer({ fileUrl, fileName, readOnly = false }: PDFViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fileType = (() => {
    const extension = fileName.toLowerCase().split('.').pop();
    if (extension === 'pdf') return 'PDF Document';
    if (['xlsx', 'xls', 'csv'].includes(extension || '')) return 'Excel Spreadsheet';
    if (['docx', 'doc'].includes(extension || '')) return 'Word Document';
    if (['pptx', 'ppt'].includes(extension || '')) return 'PowerPoint Presentation';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')) return 'Image File';
    return 'Document';
  })();

  useEffect(() => {
    setTotalPages(10);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const scale = zoom / 100;
    const width = (readOnly ? 1100 : 800) * scale;
    const height = (readOnly ? 700 : 1000) * scale;
    canvas.width = width;
    canvas.height = height;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    if (readOnly) {
      context.textAlign = 'center';
      context.fillStyle = '#718198';
      context.font = `${13 * scale}px Inter, Arial`;
      context.fillText('SI-WARE SYSTEMS', width / 2, 70 * scale);
      context.fillStyle = '#2f3e83';
      context.font = `600 ${25 * scale}px Inter, Arial`;
      context.fillText('Standard Operating Procedure', width / 2, 108 * scale);
      context.fillStyle = '#52627a';
      context.font = `${15 * scale}px Inter, Arial`;
      context.fillText(fileName, width / 2, 135 * scale);

      const sections = [
        ['1. Purpose.', 'This procedure defines the calibration cadence and acceptance criteria for controlled production equipment.'],
        ['2. Scope.', 'Applies to all calibrated instruments listed in the Master Equipment Register and associated laboratories.'],
        ['3. Responsibilities.', 'The Production Manager assigns calibration tasks; QA verifies results and records the outcome.'],
        ['4. Procedure.', 'Each instrument is calibrated at the defined interval. Out-of-tolerance results trigger corrective action.'],
        ['5. Records.', 'Calibration certificates are retained as read-only controlled copies in the document vault.'],
      ];

      context.textAlign = 'left';
      sections.forEach(([heading, copy], index) => {
        const y = (205 + index * 70) * scale;
        context.fillStyle = '#26334d';
        context.font = `600 ${15 * scale}px Inter, Arial`;
        context.fillText(heading, 120 * scale, y);
        context.fillStyle = '#52627a';
        context.font = `${15 * scale}px Inter, Arial`;
        context.fillText(copy, 255 * scale, y);
      });

      context.strokeStyle = '#9aa8c1';
      context.lineWidth = 2;
      context.strokeRect(395 * scale, 555 * scale, 310 * scale, 95 * scale);
      context.textAlign = 'center';
      context.fillStyle = '#718198';
      context.font = `${11 * scale}px Inter, Arial`;
      context.fillText('DIGITALLY SIGNED', width / 2, 585 * scale);
      context.fillStyle = '#2f3e83';
      context.font = `600 ${16 * scale}px Inter, Arial`;
      context.fillText('A. Khaled', width / 2, 612 * scale);
    } else {
      context.fillStyle = '#333333';
      context.font = `${24 * scale}px Arial`;
      context.textAlign = 'center';
      context.fillText(fileType, width / 2, height / 2 - 40);
      context.font = `${16 * scale}px Arial`;
      context.fillText(`Page ${currentPage}`, width / 2, height / 2);
    }

    context.strokeStyle = '#e5e7eb';
    context.lineWidth = 1;
    context.strokeRect(0, 0, width, height);
  }, [currentPage, fileName, fileType, readOnly, rotation, zoom]);

  const handlePrint = () => {
    const printWindow = window.open(fileUrl, '_blank');
    if (printWindow) printWindow.print();
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[4px] border border-[#e2e8f0] bg-white">
      {!readOnly && (
        <PDFToolbar
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          onPageChange={setCurrentPage}
          onZoomChange={setZoom}
          onPrint={handlePrint}
          onDownload={handleDownload}
          onSearch={(query) => console.log('Searching for:', query)}
          onRotate={() => setRotation((current) => (current + 90) % 360)}
        />
      )}

      <div className={`flex flex-1 items-center justify-center overflow-auto ${readOnly ? 'bg-white p-0' : 'bg-gray-50 p-6'}`}>
        <div className="overflow-hidden rounded bg-white shadow-sm" style={{ transform: `rotate(${rotation}deg)` }}>
          <canvas ref={canvasRef} className="max-w-full" style={{ height: 'auto' }} />
        </div>
      </div>

      {!readOnly && (
        <div className="border-t border-navy-800 bg-navy-900 px-4 py-3 text-center text-sm font-medium text-white">
          Page {currentPage} of {totalPages} · Zoom {zoom}%
        </div>
      )}
    </div>
  );
}
