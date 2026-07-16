import { Card, CardBody, Badge } from '../ui';
import type { Document } from '../../types';
import { formatFileSize, formatDate } from '../../utils/formatters';

interface DocumentGridProps {
  documents: Document[];
  isLoading?: boolean;
  onDocumentClick: (docId: string) => void;
  onDelete?: (docId: string) => void;
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 bg-gray-200 dark:bg-gray-700 rounded-lg animate-skeleton" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400">No documents found</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {documents.map((doc) => (
        <Card
          key={doc.documentId}
          className="cursor-pointer hover:shadow-lg transition-all"
          onClick={() => onDocumentClick(doc.documentId)}
        >
          <CardBody className="space-y-3">
            {/* Document Icon & Name */}
            <div className="flex items-start gap-3">
              <svg className="w-10 h-10 flex-shrink-0 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 4a2 2 0 012-2h6a1 1 0 01.707.293l4 4a1 1 0 01.293.707v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
              </svg>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {doc.name}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {doc.fileName}
                </p>
              </div>
            </div>

            {/* Status Badge */}
            <div>
              <Badge status={getStatusColor(doc.status)} size="sm">
                {doc.status.replace('_', ' ')}
              </Badge>
            </div>

            {/* Metadata */}
            <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex justify-between">
                <span>Owner:</span>
                <span className="font-medium">{doc.uploadedByUser?.fullName || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span>Size:</span>
                <span className="font-medium">{formatFileSize(doc.fileSize)}</span>
              </div>
              <div className="flex justify-between">
                <span>Uploaded:</span>
                <span className="font-medium">{formatDate(doc.uploadedAt)}</span>
              </div>
            </div>

            {/* Checkout Status */}
            {doc.checkoutStatus === 'checked_out' && (
              <div className="flex items-center gap-1 text-xs text-warning bg-warning/10 px-2 py-1 rounded">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" />
                </svg>
                Locked by {doc.checkedOutBy}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload?.(doc.documentId);
                }}
                className="flex-1 px-2 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
              >
                Download
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(doc.documentId);
                }}
                className="flex-1 px-2 py-1.5 text-xs font-medium text-error hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              >
                Delete
              </button>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
