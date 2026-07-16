import { useState } from 'react';
import { Download, Trash2, Lock, ChevronUp, ChevronDown, FileText } from 'lucide-react';
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
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-navy-700 dark:to-navy-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Card className="shadow-sm border border-gray-200 dark:border-navy-700">
        <CardBody className="text-center py-16">
          <FileText className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No documents found</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Upload a document to get started</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort Controls */}
      <div className="flex gap-3">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="px-4 py-2 text-sm font-medium bg-white dark:bg-navy-800 border border-gray-300 dark:border-navy-600 text-navy-900 dark:text-white rounded-lg hover:border-gray-400 dark:hover:border-navy-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-navy-900 transition-colors"
        >
          <option value="name">Name</option>
          <option value="date">Date</option>
          <option value="size">Size</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="px-4 py-2 text-sm font-medium bg-white dark:bg-navy-800 border border-gray-300 dark:border-navy-600 text-navy-900 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-navy-700 hover:border-gray-400 dark:hover:border-navy-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-navy-900 transition-colors flex items-center gap-2"
        >
          {sortOrder === 'asc' ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Document Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm hover:shadow-md transition-shadow">
        <table className="w-full text-sm bg-white dark:bg-navy-800">
          {/* Table Header */}
          <thead className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900">
            <tr className="text-left text-white">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Name</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Status</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Owner</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-right">Size</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Uploaded</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-center">Lock</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-right">Actions</th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-gray-200 dark:divide-navy-700">
            {sortedDocs.map((doc, idx) => (
              <tr
                key={doc.documentId}
                className={`${
                  idx % 2 === 0
                    ? 'bg-white dark:bg-navy-800'
                    : 'bg-gray-50 dark:bg-navy-850'
                } hover:bg-gray-100 dark:hover:bg-navy-700/50 cursor-pointer transition-colors`}
              >
                {/* Name Column */}
                <td
                  className="px-6 py-4 font-semibold text-navy-900 dark:text-white"
                  onClick={() => onDocumentClick(doc.documentId)}
                >
                  <div className="truncate max-w-xs">{doc.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{doc.fileName}</div>
                </td>

                {/* Status Column */}
                <td className="px-6 py-4">
                  <Badge status={getStatusColor(doc.status)} size="sm">
                    {doc.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                </td>

                {/* Owner Column */}
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                  <span className="font-medium">{doc.uploadedByUser?.fullName || 'Unknown'}</span>
                </td>

                {/* Size Column */}
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300 text-right font-medium">
                  {formatFileSize(doc.fileSize)}
                </td>

                {/* Date Column */}
                <td className="px-6 py-4 text-gray-700 dark:text-gray-300">
                  {formatDate(doc.uploadedAt)}
                </td>

                {/* Lock Status Column */}
                <td className="px-6 py-4 text-center">
                  {doc.checkoutStatus === 'checked_out' && (
                    <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                      <Lock className="w-4 h-4" />
                      <span className="text-xs font-medium">Locked</span>
                    </div>
                  )}
                </td>

                {/* Actions Column */}
                <td className="px-6 py-4 text-center">
                  <div className="flex justify-center gap-3">
                    {/* Download Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload?.(doc.documentId);
                      }}
                      className="inline-flex items-center justify-center p-2 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-navy-700 rounded-lg transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-1 dark:focus:ring-offset-navy-800"
                      title="Download document"
                      aria-label="Download"
                    >
                      <Download className="w-5 h-5" />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(doc.documentId);
                      }}
                      className="inline-flex items-center justify-center p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-navy-700 rounded-lg transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 dark:focus:ring-offset-navy-800"
                      title="Delete document"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
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
