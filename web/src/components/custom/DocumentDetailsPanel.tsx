import { useState } from 'react';
import { Badge } from '../ui/Badge';
import type { Document, DocumentVersion } from '../../types';
import { formatFileSize, formatDate } from '../../utils/formatters';

interface DocumentDetailsPanelProps {
  document: Document;
  onLockForEditing?: () => void;
  onSubmitApproval?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onDownload?: () => void;
  isLockingLoading?: boolean;
}

export function DocumentDetailsPanel({
  document,
  onLockForEditing,
  onSubmitApproval,
  onApprove,
  onReject,
  onDownload,
  isLockingLoading = false,
}: DocumentDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'timeline' | 'metadata'>('info');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Mock version history
  const versions: DocumentVersion[] = [
    {
      versionId: 'v1',
      documentId: document.documentId,
      version: 1,
      uploadedBy: 'user-2',
      uploadedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      fileSize: 2048576,
      changeNotes: 'Initial upload',
    },
    {
      versionId: 'v2',
      documentId: document.documentId,
      version: 2,
      uploadedBy: 'user-3',
      uploadedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      fileSize: 2097152,
      changeNotes: 'Updated with corrections',
    },
  ];

  // Mock approval timeline
  const timeline = [
    { step: 1, action: 'Draft Created', actor: 'Ahmed Ali', timestamp: formatDate(document.uploadedAt), status: 'completed' as const },
    { step: 2, action: 'Submitted for Approval', actor: 'Ahmed Ali', timestamp: formatDate(new Date().toISOString()), status: 'pending' as const },
    { step: 3, action: 'Manager Approval', actor: 'Waiting', timestamp: '—', status: 'pending' as const },
    { step: 4, action: 'Released', actor: '—', timestamp: '—', status: 'pending' as const },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
          {document.name}
        </h2>
        <div className="flex items-center gap-2 mt-2">
          <Badge status={document.status === 'released' ? 'success' : document.status === 'draft' ? 'warning' : 'info'} size="sm">
            {document.status.replace('_', ' ')}
          </Badge>
          {document.checkoutStatus === 'checked_out' && (
            <Badge status="warning" size="sm">
              Locked by {document.checkedOutBy}
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {['info', 'timeline', 'metadata'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'info' && 'Basic Info'}
            {tab === 'timeline' && 'Timeline'}
            {tab === 'metadata' && 'Metadata'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Basic Info Tab */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            {/* Document Info */}
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Document Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Owner:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{document.uploadedByUser?.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Uploaded:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{formatDate(document.uploadedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Size:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{formatFileSize(document.fileSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Type:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{document.contentType}</span>
                </div>
              </div>
            </div>

            {/* Version History */}
            <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Version History</h3>
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.versionId} className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">v{v.version}</p>
                        <p className="text-gray-600 dark:text-gray-400 text-xs">{v.changeNotes || 'No notes'}</p>
                      </div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">{formatFileSize(v.fileSize)}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{formatDate(v.uploadedAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Approval Workflow</h3>
            <div className="space-y-3">
              {timeline.map((item, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        item.status === 'completed'
                          ? 'bg-success text-white'
                          : 'bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {item.status === 'completed' ? '✓' : item.step}
                    </div>
                    {idx < timeline.length - 1 && (
                      <div className={`w-0.5 h-8 ${item.status === 'completed' ? 'bg-success' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    )}
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{item.action}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{item.actor}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">{item.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata Tab */}
        {activeTab === 'metadata' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Metadata</h3>
            <div className="space-y-2 text-sm">
              <div className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                <p className="text-gray-600 dark:text-gray-400">Classification:</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">Confidential</p>
              </div>
              <div className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                <p className="text-gray-600 dark:text-gray-400">Department:</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">Quality Management</p>
              </div>
              <div className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                <p className="text-gray-600 dark:text-gray-400">Tags:</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge status="info" size="sm">Procedure</Badge>
                  <Badge status="info" size="sm">ISO 9001</Badge>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 space-y-3">
        {/* Lock File for Editing */}
        <div className="flex gap-2">
          <button
            onClick={onLockForEditing}
            disabled={isLockingLoading || document.checkoutStatus === 'checked_out'}
            className="flex-1 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
          >
            {isLockingLoading ? 'Locking...' : document.checkoutStatus === 'checked_out' ? 'Locked' : 'Lock File for Editing'}
          </button>
        </div>

        {/* Approval Actions */}
        <div className="flex gap-2">
          {document.status === 'draft' ? (
            <button
              onClick={onSubmitApproval}
              className="flex-1 px-3 py-2 bg-warning hover:bg-amber-500 text-white rounded-md font-medium text-sm transition-colors"
            >
              Submit for Approval
            </button>
          ) : document.status === 'pending_approval' ? (
            <>
              <button
                onClick={onApprove}
                className="flex-1 px-3 py-2 bg-success hover:bg-green-600 text-white rounded-md font-medium text-sm transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => setShowRejectForm(!showRejectForm)}
                className="flex-1 px-3 py-2 bg-error hover:bg-red-600 text-white rounded-md font-medium text-sm transition-colors"
              >
                Reject
              </button>
            </>
          ) : null}
        </div>

        {/* Reject Form */}
        {showRejectForm && (
          <div className="space-y-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
            <textarea
              placeholder="Rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-red-300 dark:border-red-600 bg-white dark:bg-gray-800 rounded"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onReject?.();
                  setShowRejectForm(false);
                  setRejectReason('');
                }}
                className="flex-1 px-3 py-1 bg-error hover:bg-red-600 text-white rounded text-sm font-medium"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="flex-1 px-3 py-1 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100 rounded text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Download */}
        <button
          onClick={onDownload}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Download
        </button>
      </div>
    </div>
  );
}
