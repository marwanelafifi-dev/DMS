import { useMemo, useState } from 'react';
import { Download, Eye, FileText } from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import { formatFileSize } from '../../utils/formatters';

interface DocumentListProps {
  documents: MockLibraryDocument[];
  isLoading?: boolean;
  onDocumentClick: (docId: string) => void;
  onDownload?: (docId: string) => void;
}

const statusStyles: Record<MockLibraryDocument['status'], string> = {
  draft: 'bg-[#edf1f5] text-[#62718a]',
  pending_approval: 'bg-[#fff1c9] text-[#b96a08]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  archived: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<MockLibraryDocument['status'], string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};

const extensionStyles: Record<MockLibraryDocument['extension'], string> = {
  txt: 'bg-slate-100 text-slate-600',
  doc: 'bg-blue-50 text-blue-700',
  docx: 'bg-blue-50 text-blue-700',
  xlsx: 'bg-emerald-50 text-emerald-700',
  pptx: 'bg-orange-50 text-orange-700',
  pdf: 'bg-red-50 text-red-700',
  png: 'bg-violet-50 text-violet-700',
  jpg: 'bg-violet-50 text-violet-700',
  jpeg: 'bg-violet-50 text-violet-700',
  file: 'bg-slate-100 text-slate-600',
};

export function DocumentList({ documents, isLoading = false, onDocumentClick, onDownload }: DocumentListProps) {
  const [sortBy, setSortBy] = useState<'fileName' | 'status' | 'updatedAt'>('fileName');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedDocuments = useMemo(() => [...documents].sort((a, b) => {
    if (sortBy === 'fileName') return a.fileName.localeCompare(b.fileName);
    if (sortBy === 'status') return a.status.localeCompare(b.status);
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }), [documents, sortBy]);

  const toggleSelected = (documentId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(selected.size === documents.length ? new Set() : new Set(documents.map((document) => document.documentId)));
  };

  if (isLoading) {
    return <div className="space-y-2 p-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded bg-slate-100" />)}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[930px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-10 px-3">
              <input type="checkbox" checked={documents.length > 0 && selected.size === documents.length} onChange={toggleAll} aria-label="Select all documents" className="h-4 w-4 rounded border-slate-300 accent-[#3f8bca]" />
            </th>
            <th><button onClick={() => setSortBy('fileName')} className={sortBy === 'fileName' ? 'text-[#283a7a]' : ''}>File name</button></th>
            <th className="w-[90px]">Type</th>
            <th className="w-[115px]">Folder</th>
            <th className="w-[105px]">Size</th>
            <th className="w-[150px]"><button onClick={() => setSortBy('updatedAt')} className={sortBy === 'updatedAt' ? 'text-[#283a7a]' : ''}>Modified</button></th>
            <th className="w-[120px]"><button onClick={() => setSortBy('status')} className={sortBy === 'status' ? 'text-[#283a7a]' : ''}>Status</button></th>
            <th className="min-w-[210px] text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedDocuments.map((document, index) => (
            <tr key={document.documentId} className={`${index % 2 ? 'bg-[#f8fafc] dark:bg-slate-800/35' : 'bg-white dark:bg-slate-900'} hover:bg-[#f2f6fa] dark:hover:bg-slate-800/60`}>
              <td className="px-3">
                <input type="checkbox" checked={selected.has(document.documentId)} onChange={() => toggleSelected(document.documentId)} aria-label={`Select ${document.fileName}`} className="h-4 w-4 rounded border-slate-300 accent-[#3f8bca]" />
              </td>
              <td>
                <button onClick={() => onDocumentClick(document.documentId)} className="flex max-w-[320px] items-center gap-2.5 text-left" aria-label={`Preview ${document.fileName}`}>
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded ${extensionStyles[document.extension]}`}><FileText className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#2e4083] dark:text-slate-100">{document.fileName}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#718198]">{document.description}</span>
                  </span>
                </button>
              </td>
              <td><span className={`rounded px-2 py-1 text-[11px] font-semibold uppercase ${extensionStyles[document.extension]}`}>{document.extension}</span></td>
              <td className="whitespace-nowrap text-[#52627a] dark:text-slate-200">{document.folderName}</td>
              <td className="whitespace-nowrap text-[#718198]">{formatFileSize(document.fileSize)}</td>
              <td className="whitespace-nowrap text-[#718198]">{new Date(document.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td><span className={`rounded px-2 py-1 text-xs font-medium ${statusStyles[document.status]}`}>{statusLabels[document.status]}</span></td>
              <td>
                <div className="flex items-center justify-end gap-1.5">
                  <button onClick={() => onDocumentClick(document.documentId)} className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[#2f3e83] px-2.5 text-xs font-medium text-white hover:bg-[#263472]" aria-label={`Open preview for ${document.fileName}`}>
                    <Eye className="h-3.5 w-3.5" /> View Only
                  </button>
                  <button onClick={() => onDownload?.(document.documentId)} className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[#f1f4f8] px-2.5 text-xs font-medium text-[#52627a] hover:bg-[#e7ecf2]" aria-label={`Download ${document.fileName}`}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
