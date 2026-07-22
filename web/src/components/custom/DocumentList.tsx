import { useMemo, useState } from 'react';
import { Download, Eye, LockKeyhole, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import type { Document } from '../../types';

interface DocumentListProps {
  documents: Document[];
  isLoading?: boolean;
  onDocumentClick: (docId: string) => void;
  onDelete?: (docId: string, docName: string) => void;
  onDownload?: (docId: string) => void;
  onDownloadForEdit?: (docId: string) => void;
}

const statusStyles: Record<Document['status'], string> = {
  draft: 'bg-[#edf1f5] text-[#62718a]',
  pending_approval: 'bg-[#fff1c9] text-[#b96a08]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  archived: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<Document['status'], string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};

export function DocumentList({ documents, isLoading = false, onDocumentClick, onDelete, onDownload, onDownloadForEdit }: DocumentListProps) {
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'updatedAt'>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedDocuments = useMemo(() => [...documents].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
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
      <table className="data-table min-w-[920px]">
        <thead>
          <tr>
            <th className="w-10 px-3">
              <input type="checkbox" checked={documents.length > 0 && selected.size === documents.length} onChange={toggleAll} aria-label="Select all documents" className="h-4 w-4 rounded border-slate-300 accent-[#3f8bca]" />
            </th>
            <th><button onClick={() => setSortBy('name')} className={sortBy === 'name' ? 'text-[#283a7a]' : ''}>Document</button></th>
            <th className="w-[90px]">Version</th>
            <th className="w-[120px]"><button onClick={() => setSortBy('status')} className={sortBy === 'status' ? 'text-[#283a7a]' : ''}>Status</button></th>
            <th className="w-[120px]">Owner</th>
            <th className="w-[140px]"><button onClick={() => setSortBy('updatedAt')} className={sortBy === 'updatedAt' ? 'text-[#283a7a]' : ''}>Modified</button></th>
            <th className="min-w-[360px] text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedDocuments.map((document) => {
            const versionNumber = document.versions?.[0]?.versionNumber ?? document.versions?.[0]?.version ?? 1;
            const isLocked = document.checkoutStatus === 'checked_out';
            return (
              <tr key={document.documentId} className="bg-white hover:bg-[#fbfcfe] dark:bg-slate-900 dark:hover:bg-slate-800/60">
                <td className="px-3">
                  <input type="checkbox" checked={selected.has(document.documentId)} onChange={() => toggleSelected(document.documentId)} aria-label={`Select ${document.name}`} className="h-4 w-4 rounded border-slate-300 accent-[#3f8bca]" />
                </td>
                <td>
                  <button onClick={() => onDocumentClick(document.documentId)} className="block max-w-[280px] text-left">
                    <span className="block truncate text-sm font-semibold text-[#2e4083] dark:text-slate-100">{document.trackingCode || document.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#718198]">{document.description || document.fileName || document.name}</span>
                  </button>
                </td>
                <td><span className="rounded bg-[#f0f3f7] px-2 py-1 text-xs text-[#64748b] dark:bg-slate-800">v{Number(versionNumber).toFixed(1)}</span></td>
                <td><span className={`rounded px-2 py-1 text-xs font-medium ${statusStyles[document.status]}`}>{statusLabels[document.status]}</span></td>
                <td className="whitespace-nowrap text-[#334155] dark:text-slate-200">{document.uploadedByUser?.fullName || 'Unknown'}</td>
                <td className="whitespace-nowrap text-[#718198]">{new Date(document.updatedAt || document.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    {isLocked && <span className="mr-1 rounded bg-[#fff0c7] px-2 py-1.5 text-[11px] text-[#b56a09]">Checked out{document.checkedOutBy ? ` by ${document.checkedOutBy}` : ''}</span>}
                    <button onClick={() => onDocumentClick(document.documentId)} className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[#2f3e83] px-2.5 text-xs font-medium text-white hover:bg-[#263472]">
                      <Eye className="h-3.5 w-3.5" /> View Only
                    </button>
                    <button onClick={() => onDownload?.(document.documentId)} className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[#f1f4f8] px-2.5 text-xs font-medium text-[#52627a] hover:bg-[#e7ecf2]">
                      <Download className="h-3.5 w-3.5" /> Download (RO)
                    </button>
                    <button
                      onClick={() => !isLocked && onDownloadForEdit?.(document.documentId)}
                      disabled={isLocked}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-[#3f8bca] px-2.5 text-xs font-medium text-white hover:bg-[#317bb8] disabled:bg-[#edf1f5] disabled:text-[#a9b5c6]"
                    >
                      {isLocked ? <LockKeyhole className="h-3.5 w-3.5" /> : <PencilLine className="h-3.5 w-3.5" />}
                      {isLocked ? 'Locked' : 'Download for Edit'}
                    </button>
                    {onDelete && <details className="relative"><summary className="list-none rounded p-1.5 text-[#9aa7ba] hover:bg-slate-100 hover:text-[#52627a]" aria-label={`More actions for ${document.name}`}><MoreHorizontal className="h-4 w-4" /></summary><button onClick={() => onDelete(document.documentId, document.name)} className="absolute right-0 top-8 z-20 inline-flex w-28 items-center gap-2 rounded border border-[#e2e8f0] bg-white px-3 py-2 text-left text-xs text-red-600 shadow-lg hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Delete</button></details>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
