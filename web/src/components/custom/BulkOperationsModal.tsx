import { useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { CheckCircle2, XCircle, Trash2, Download, X, AlertCircle } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import type { Document } from '../../types';

interface BulkOperationsModalProps {
  selectedDocuments: Document[];
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkOperationsModal({
  selectedDocuments,
  onClose,
  onSuccess,
}: BulkOperationsModalProps) {
  const { showSuccess, showError } = useToast();
  const [operation, setOperation] = useState<'approve' | 'reject' | 'delete' | 'download' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [comments, setComments] = useState('');
  const [reason, setReason] = useState('');

  const handleBulkApprove = async () => {
    setIsProcessing(true);
    try {
      const docIds = selectedDocuments.map(d => d.documentId);
      await apiClient.bulkApprove(docIds, comments);
      showSuccess(`${docIds.length} documents approved`);
      onSuccess();
      onClose();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to approve documents');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (!reason.trim()) {
      showError('Rejection reason is required');
      return;
    }
    setIsProcessing(true);
    try {
      const docIds = selectedDocuments.map(d => d.documentId);
      await apiClient.bulkReject(docIds, reason);
      showSuccess(`${docIds.length} documents rejected`);
      onSuccess();
      onClose();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to reject documents');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    setIsProcessing(true);
    try {
      const docIds = selectedDocuments.map(d => d.documentId);
      await apiClient.bulkDelete(docIds);
      showSuccess(`${docIds.length} documents deleted`);
      onSuccess();
      onClose();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete documents');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkDownload = async () => {
    setIsProcessing(true);
    try {
      const docIds = selectedDocuments.map(d => d.documentId);
      const blob = await apiClient.bulkDownload(docIds);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'documents.zip';
      a.click();
      showSuccess(`${docIds.length} documents downloaded`);
      onClose();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to download documents');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!operation) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
            <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Bulk Operations</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <CardBody className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Selected: {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''}
            </p>

            <button
              onClick={() => setOperation('approve')}
              className="w-full flex items-center gap-3 p-4 border border-gray-200 dark:border-navy-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors text-left"
            >
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium text-navy-900 dark:text-white">Approve All</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Submit approval for all selected</p>
              </div>
            </button>

            <button
              onClick={() => setOperation('reject')}
              className="w-full flex items-center gap-3 p-4 border border-gray-200 dark:border-navy-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
            >
              <XCircle className="w-5 h-5 text-red-600" />
              <div>
                <p className="font-medium text-navy-900 dark:text-white">Reject All</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Reject all selected documents</p>
              </div>
            </button>

            <button
              onClick={() => setOperation('download')}
              className="w-full flex items-center gap-3 p-4 border border-gray-200 dark:border-navy-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
            >
              <Download className="w-5 h-5 text-blue-600" />
              <div>
                <p className="font-medium text-navy-900 dark:text-white">Download All</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">Download as ZIP file</p>
              </div>
            </button>

            <button
              onClick={() => setOperation('delete')}
              className="w-full flex items-center gap-3 p-4 border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
            >
              <Trash2 className="w-5 h-5 text-red-600" />
              <div>
                <p className="font-medium text-red-600">Delete All</p>
                <p className="text-xs text-red-600">Permanently delete all selected</p>
              </div>
            </button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Approve/Reject/Delete/Download confirmation
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
          <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">
            {operation === 'approve' && 'Approve Documents'}
            {operation === 'reject' && 'Reject Documents'}
            {operation === 'delete' && 'Delete Documents'}
            {operation === 'download' && 'Download Documents'}
          </h2>
          <button
            onClick={() => setOperation(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <CardBody className="space-y-4">
          {(operation === 'approve' || operation === 'reject') && (
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">
                {operation === 'approve' ? 'Comments (optional)' : 'Reason *'}
              </label>
              <textarea
                placeholder={operation === 'approve' ? 'Add comments...' : 'Explain rejection reason...'}
                value={operation === 'approve' ? comments : reason}
                onChange={(e) =>
                  operation === 'approve'
                    ? setComments(e.target.value)
                    : setReason(e.target.value)
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24"
              />
            </div>
          )}

          {operation === 'delete' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300">
                  This will permanently delete {selectedDocuments.length} document
                  {selectedDocuments.length !== 1 ? 's' : ''}. This action cannot be undone.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Selected Documents:</p>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {selectedDocuments.slice(0, 5).map((doc) => (
                <p key={doc.documentId} className="text-xs text-gray-600 dark:text-gray-400">
                  • {doc.title}
                </p>
              ))}
              {selectedDocuments.length > 5 && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  + {selectedDocuments.length - 5} more
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              onClick={() => setOperation(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={operation === 'delete' ? 'danger' : 'primary'}
              onClick={() => {
                if (operation === 'approve') handleBulkApprove();
                else if (operation === 'reject') handleBulkReject();
                else if (operation === 'delete') handleBulkDelete();
                else if (operation === 'download') handleBulkDownload();
              }}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Confirm'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
