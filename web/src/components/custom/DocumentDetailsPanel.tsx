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
    <div className="bg-navy-700 dark:bg-navy-700 rounded-xl border border-navy-600 dark:border-navy-600 flex flex-col h-full overflow-hidden shadow-lg dark:shadow-xl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-navy-600 dark:border-navy-600 bg-navy-800 dark:bg-navy-800">
        <h2 className="text-lg font-bold text-white dark:text-white truncate">
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
      <div className="flex border-b border-navy-600 dark:border-navy-600">
        {['info', 'timeline', 'metadata'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-cyan-600 text-cyan-400 dark:border-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-navy-400 dark:text-navy-400 hover:text-cyan-400 dark:hover:text-cyan-400'
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
              <h3 className="font-bold text-white dark:text-white">Document Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-navy-300 dark:text-navy-300">Owner:</span>
                  <span className="font-semibold text-cyan-300 dark:text-cyan-300">{document.uploadedByUser?.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-300 dark:text-navy-300">Uploaded:</span>
                  <span className="font-semibold text-cyan-300 dark:text-cyan-300">{formatDate(document.uploadedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-300 dark:text-navy-300">Size:</span>
                  <span className="font-semibold text-cyan-300 dark:text-cyan-300">{formatFileSize(document.fileSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-navy-300 dark:text-navy-300">Type:</span>
                  <span className="font-semibold text-cyan-300 dark:text-cyan-300">{document.contentType}</span>
                </div>
              </div>
            </div>

            {/* Version History */}
            <div className="space-y-3 pt-4 border-t border-navy-600 dark:border-navy-600">
              <h3 className="font-bold text-white dark:text-white">Version History</h3>
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.versionId} className="p-2 bg-navy-800 dark:bg-navy-800 rounded-lg text-sm shadow-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-white dark:text-white">v{v.version}</p>
                        <p className="text-navy-300 dark:text-navy-300 text-xs">{v.changeNotes || 'No notes'}</p>
                      </div>
                      <span className="text-navy-400 dark:text-navy-400 text-xs">{formatFileSize(v.fileSize)}</span>
                    </div>
                    <p className="text-xs text-navy-400 dark:text-navy-400 mt-1">{formatDate(v.uploadedAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div className="space-y-4">
            <h3 className="font-bold text-white dark:text-white">Approval Workflow</h3>
            <div className="space-y-3">
              {timeline.map((item, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-md ${
                        item.status === 'completed'
                          ? 'bg-cyan-600 text-white'
                          : 'bg-navy-600 dark:bg-navy-600 text-navy-300 dark:text-navy-300'
                      }`}
                    >
                      {item.status === 'completed' ? '✓' : item.step}
                    </div>
                    {idx < timeline.length - 1 && (
                      <div className={`w-1 h-8 rounded-full ${item.status === 'completed' ? 'bg-cyan-600' : 'bg-navy-600 dark:bg-navy-600'}`} />
                    )}
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="font-semibold text-white dark:text-white">{item.action}</p>
                    <p className="text-sm text-navy-300 dark:text-navy-300">{item.actor}</p>
                    <p className="text-xs text-navy-400 dark:text-navy-400">{item.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata Tab */}
        {activeTab === 'metadata' && (
          <div className="space-y-4">
            <h3 className="font-bold text-white dark:text-white">Metadata</h3>
            <div className="space-y-2 text-sm">
              <div className="p-3 bg-navy-800 dark:bg-navy-800 rounded-lg shadow-xs">
                <p className="text-navy-300 dark:text-navy-300">Classification:</p>
                <p className="font-semibold text-cyan-300 dark:text-cyan-300">Confidential</p>
              </div>
              <div className="p-3 bg-navy-800 dark:bg-navy-800 rounded-lg shadow-xs">
                <p className="text-navy-300 dark:text-navy-300">Department:</p>
                <p className="font-semibold text-cyan-300 dark:text-cyan-300">Quality Management</p>
              </div>
              <div className="p-3 bg-navy-800 dark:bg-navy-800 rounded-lg shadow-xs">
                <p className="text-navy-300 dark:text-navy-300">Tags:</p>
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
      <div className="px-6 py-4 border-t border-navy-600 dark:border-navy-600 bg-navy-800 dark:bg-navy-800 space-y-3">
        {/* Lock File for Editing */}
        <div className="flex gap-2">
          <button
            onClick={onLockForEditing}
            disabled={isLockingLoading || document.checkoutStatus === 'checked_out'}
            className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:shadow-none transition-all"
          >
            {isLockingLoading ? 'Locking...' : document.checkoutStatus === 'checked_out' ? 'Locked' : 'Lock File for Editing'}
          </button>
        </div>

        {/* Approval Actions */}
        <div className="flex gap-2">
          {document.status === 'draft' ? (
            <button
              onClick={onSubmitApproval}
              className="flex-1 px-3 py-2 bg-navy-600 hover:bg-navy-700 text-white rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all"
            >
              Submit for Approval
            </button>
          ) : document.status === 'pending_approval' ? (
            <>
              <button
                onClick={onApprove}
                className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all"
              >
                Approve
              </button>
              <button
                onClick={() => setShowRejectForm(!showRejectForm)}
                className="flex-1 px-3 py-2 bg-navy-700 hover:bg-navy-800 text-white rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all"
              >
                Reject
              </button>
            </>
          ) : null}
        </div>

        {/* Reject Form */}
        {showRejectForm && (
          <div className="space-y-2 p-3 bg-navy-600 dark:bg-navy-600 rounded-lg border-2 border-navy-700 dark:border-navy-700 shadow-sm">
            <textarea
              placeholder="Rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 text-sm border-2 border-navy-700 dark:border-navy-700 bg-navy-700 dark:bg-navy-700 text-white rounded-lg font-serif"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onReject?.();
                  setShowRejectForm(false);
                  setRejectReason('');
                }}
                className="flex-1 px-3 py-1 bg-navy-700 hover:bg-navy-800 text-white rounded-lg text-sm font-semibold shadow-md transition-all"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="flex-1 px-3 py-1 bg-navy-600 dark:bg-navy-600 text-white dark:text-white rounded-lg text-sm font-semibold hover:bg-navy-700 dark:hover:bg-navy-700 shadow-sm transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Download */}
        <button
          onClick={onDownload}
          className="w-full px-3 py-2 border-2 border-cyan-600 text-cyan-400 dark:text-cyan-400 dark:border-cyan-600 rounded-lg font-semibold text-sm hover:bg-navy-700 dark:hover:bg-navy-700 transition-all"
        >
          Download
        </button>
      </div>
    </div>
  );
}
