import { ArrowDownFromLine, Trash2, Lock, FileText } from 'lucide-react';
import { Card, CardBody, Badge } from '../ui';
import type { Document } from '../../types';
import { formatFileSize, formatDate } from '../../utils/formatters';

interface DocumentGridProps {
  documents: Document[];
  isLoading?: boolean;
  onDocumentClick: (docId: string) => void;
  onDelete?: (docId: string, docName: string) => void;
  onDownload?: (docId: string) => void;
}

export function DocumentGrid({
  documents,
  isLoading = false,
  onDocumentClick,
  onDelete,
  onDownload,
}: DocumentGridProps) {
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

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 bg-gradient-to-br from-gray-100 to-gray-50 dark:from-navy-700 dark:to-navy-800 rounded-xl animate-pulse"
          />
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {documents.map((doc) => (
        <Card
          key={doc.documentId}
          className="cursor-pointer hover:shadow-lg transition-all border border-gray-200 dark:border-navy-700 overflow-hidden group"
          onClick={() => onDocumentClick(doc.documentId)}
        >
          {/* Card Header */}
          <div className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900 px-6 py-4 flex items-start justify-between">
            <FileText className="w-6 h-6 text-white flex-shrink-0" />
            {doc.checkoutStatus === 'checked_out' && (
              <div className="flex items-center gap-1 text-amber-300 bg-amber-950/50 px-2 py-1 rounded-lg">
                <Lock className="w-4 h-4" />
              </div>
            )}
          </div>

          <CardBody className="space-y-4">
            {/* Document Name */}
            <div className="space-y-1">
              <h3 className="font-semibold text-navy-900 dark:text-white line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {doc.name}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                {doc.fileName}
              </p>
            </div>

            {/* Status Badge */}
            <div className="flex items-center gap-2">
              <Badge status={getStatusColor(doc.status)} size="sm">
                {doc.status.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>

            {/* Metadata */}
            <div className="space-y-2 text-xs border-t border-gray-200 dark:border-navy-700 pt-4">
              <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                <span className="text-gray-600 dark:text-gray-400">Owner:</span>
                <span className="font-medium">{doc.uploadedByUser?.fullName || 'Unknown'}</span>
              </div>
              <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                <span className="text-gray-600 dark:text-gray-400">Size:</span>
                <span className="font-medium">{formatFileSize(doc.fileSize)}</span>
              </div>
              <div className="flex justify-between items-center text-gray-700 dark:text-gray-300">
                <span className="text-gray-600 dark:text-gray-400">Uploaded:</span>
                <span className="font-medium">{formatDate(doc.uploadedAt)}</span>
              </div>
            </div>

            {/* Lock Status Detail */}
            {doc.checkoutStatus === 'checked_out' && (
              <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900/50">
                <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400 flex-shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  Locked by {doc.checkedOutBy}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-navy-700">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload?.(doc.documentId);
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/30 hover:bg-cyan-100 dark:hover:bg-cyan-950/50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-1 dark:focus:ring-offset-navy-800"
                title="Download document"
              >
                <ArrowDownFromLine className="w-4 h-4" />
                <span className="hidden sm:inline">Download</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(doc.documentId, doc.name);
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 dark:focus:ring-offset-navy-800"
                title="Delete document"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
