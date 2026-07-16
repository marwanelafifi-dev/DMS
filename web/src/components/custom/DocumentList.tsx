import { useState } from 'react';
import { Card, CardBody, Badge } from '../ui';
import type { Document } from '../../types';
import { formatFileSize, formatDate } from '../../utils/formatters';

interface DocumentListProps {
  documents: Document[];
  isLoading?: boolean;
  onDocumentClick: (docId: string) => void;
  onDelete?: (docId: string) => void;
  onDownload?: (docId: string) => void;
}

export function DocumentList({
  documents,
  isLoading = false,
  onDocumentClick,
  onDelete,
  onDownload,
}: DocumentListProps) {
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const getStatusColor = (status: Document['status']) => {
    const map: Record<Document['status'], any> = {
      draft: 'warning',
      pending_approval: 'info',
      released: 'success',
      rejected: 'error',
      archived: 'default',
    };
    return map[status];
  };

  const getLockStatusIcon = (doc: Document) => {
    if (doc.checkoutStatus === 'checked_out') {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" />
          </svg>
          Locked
        </span>
      );
    }
    return null;
  };

  const sortedDocs = [...documents].sort((a, b) => {
    let aVal: any = a[sortBy === 'name' ? 'name' : sortBy === 'date' ? 'uploadedAt' : 'fileSize'];
    let bVal: any = b[sortBy === 'name' ? 'name' : sortBy === 'date' ? 'uploadedAt' : 'fileSize'];

    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg animate-skeleton" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <svg className="w-12 h-12 mx-auto text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-slate-600 dark:text-slate-400">No documents found</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort Controls */}
      <div className="flex gap-2">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-3 py-2 text-sm border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg font-semibold hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
        >
          <option value="name">Sort by Name</option>
          <option value="date">Sort by Date</option>
          <option value="size">Sort by Size</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="px-4 py-2 text-sm border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg font-semibold hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Document Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 shadow-md">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700/50">
            <tr className="text-left text-slate-700 dark:text-slate-300 font-bold">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Lock Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {sortedDocs.map((doc) => (
              <tr
                key={doc.documentId}
                className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors"
              >
                <td
                  className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100"
                  onClick={() => onDocumentClick(doc.documentId)}
                >
                  <div className="truncate">{doc.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{doc.fileName}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge status={getStatusColor(doc.status)} size="sm">
                    {doc.status.replace('_', ' ')}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {doc.uploadedByUser?.fullName || 'Unknown'}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {formatFileSize(doc.fileSize)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {formatDate(doc.uploadedAt)}
                </td>
                <td className="px-4 py-3">
                  {getLockStatusIcon(doc)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload?.(doc.documentId);
                      }}
                      className="text-primary-600 hover:text-primary-700 dark:text-primary-400 font-semibold hover:scale-110 transition-transform"
                      title="Download"
                    >
                      ⬇️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(doc.documentId);
                      }}
                      className="text-error hover:text-red-700 dark:text-red-400 font-semibold hover:scale-110 transition-transform"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
