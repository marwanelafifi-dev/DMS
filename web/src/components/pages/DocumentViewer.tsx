import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronRight, Download, Lock, Unlock, CheckCircle2, XCircle, X } from 'lucide-react';
import { PDFViewer } from '../custom/PDFViewer';
import { useToast } from '../../hooks/useToast';
import { apiClient } from '../../utils/api';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonCard } from '../ui/Skeleton';
import type { Document } from '../../types';
import { formatFileSize, formatDate } from '../../utils/formatters';

const getCurrentVersionId = (document: Document) =>
  document.currentVersionId ?? document.versions?.[0]?.versionId;

export function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOperating, setIsOperating] = useState(false);

  // Modals
  const [rejectModal, setRejectModal] = useState({ isOpen: false, reason: '' });
  const [approveModal, setApproveModal] = useState({ isOpen: false, comments: '' });

  const requireCurrentVersionId = (missingVersionMessage = 'This document does not have an uploaded file version') => {
    if (!document) return undefined;

    const versionId = getCurrentVersionId(document);
    if (!versionId) showError(missingVersionMessage);
    return versionId;
  };

  // Load Document from Backend (with mock fallback for testing)
  useEffect(() => {
    const loadDocument = async () => {
      if (!id) {
        showError('No document ID provided');
        navigate('/documents');
        return;
      }

      try {
        setIsLoading(true);

        // Mock data for testing Document Viewer features
        const mockDocuments: Record<string, Document> = {
          'doc-1': {
            documentId: 'doc-1',
            folderId: 'folder-1',
            name: 'ISO 9001:2015 Quality Procedure',
            fileName: 'quality-procedure.pdf',
            fileSize: 2048576,
            contentType: 'application/pdf',
            status: 'released',
            uploadedBy: 'user-2',
            uploadedByUser: { userId: 'user-2', fullName: 'Ahmed Ali', email: 'ahmed@si-ware.com', role: 'Manager', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
          'doc-2': {
            documentId: 'doc-2',
            folderId: 'folder-1',
            name: 'Document Control Procedure',
            fileName: 'doc-control.pdf',
            fileSize: 1536000,
            contentType: 'application/pdf',
            status: 'pending_approval',
            uploadedBy: 'user-3',
            uploadedByUser: { userId: 'user-3', fullName: 'Mohammed Anwar', email: 'mohamm@si-ware.com', role: 'Writer', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
          'doc-3': {
            documentId: 'doc-3',
            folderId: 'folder-1',
            name: 'Records Management Policy',
            fileName: 'records-policy.pdf',
            fileSize: 2097152,
            contentType: 'application/pdf',
            status: 'draft',
            uploadedBy: 'user-1',
            uploadedByUser: { userId: 'user-1', fullName: 'You', email: 'you@si-ware.com', role: 'Writer', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
        };

        const mockDoc = mockDocuments[id];
        if (mockDoc) {
          setDocument(mockDoc);
        } else {
          // Try to load from API
          const res = await apiClient.getDocument(id);
          if (res.data) {
            setDocument(res.data);
          } else {
            showError('Document not found');
            navigate('/documents');
          }
        }
      } catch (err: any) {
        showError(err.response?.data?.error || 'Failed to load document');
        navigate('/documents');
      } finally {
        setIsLoading(false);
      }
    };

    loadDocument();
  }, [id, navigate, showError]);

  // Handle Lock Document
  const handleLock = async () => {
    if (!document) return;

    const versionId = requireCurrentVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      await apiClient.checkoutDocument(document.documentId, versionId);
      showSuccess('✓ Document locked for editing (60-min timeout)');

      // Reload document
      const res = await apiClient.getDocument(document.documentId);
      if (res.data) setDocument(res.data);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to lock document');
    } finally {
      setIsOperating(false);
    }
  };

  // Handle Unlock Document
  const handleUnlock = async () => {
    if (!document) return;

    const versionId = requireCurrentVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      await apiClient.checkinDocument(document.documentId, versionId);
      showSuccess('✓ Document unlocked');

      // Reload document
      const res = await apiClient.getDocument(document.documentId);
      if (res.data) setDocument(res.data);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to unlock document');
    } finally {
      setIsOperating(false);
    }
  };

  // Handle Submit for Approval
  const handleSubmitApproval = async () => {
    if (!document) return;

    const versionId = requireCurrentVersionId('Upload a document version before submitting it for approval');
    if (!versionId) return;

    setIsOperating(true);
    try {
      await apiClient.submitForApproval(document.documentId, versionId);
      showSuccess('✓ Document submitted for approval');

      // Reload document
      const res = await apiClient.getDocument(document.documentId);
      if (res.data) setDocument(res.data);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to submit document');
    } finally {
      setIsOperating(false);
    }
  };

  // Handle Approve Document
  const handleApprove = async () => {
    if (!document) return;

    const versionId = requireCurrentVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      await apiClient.approveDocument(document.documentId, versionId, approveModal.comments);
      showSuccess('✓ Document approved');
      setApproveModal({ isOpen: false, comments: '' });

      // Reload document
      const res = await apiClient.getDocument(document.documentId);
      if (res.data) setDocument(res.data);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to approve document');
    } finally {
      setIsOperating(false);
    }
  };

  // Handle Reject Document
  const handleReject = async () => {
    if (!document || !rejectModal.reason.trim()) {
      showError('Please provide a rejection reason');
      return;
    }

    const versionId = requireCurrentVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      await apiClient.rejectDocument(document.documentId, versionId, rejectModal.reason);
      showSuccess('✓ Document rejected and returned to draft');
      setRejectModal({ isOpen: false, reason: '' });

      // Reload document
      const res = await apiClient.getDocument(document.documentId);
      if (res.data) setDocument(res.data);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to reject document');
    } finally {
      setIsOperating(false);
    }
  };

  // Handle Download
  const handleDownload = async () => {
    if (!document) return;

    const versionId = requireCurrentVersionId();
    if (!versionId) return;

    try {
      await apiClient.downloadDocument(document.documentId, versionId);
      showSuccess('Document download started');
    } catch (err: any) {
      showError('Failed to download document');
    }
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-navy-500 dark:text-navy-300">
          <button
            onClick={() => navigate('/documents')}
            className="text-blue-600 dark:text-cyan-400 hover:text-blue-700 dark:hover:text-cyan-300 font-medium"
          >
            Documents
          </button>
          <ChevronRight className="w-4 h-4" />
          <span>Loading...</span>
        </div>
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Document Viewer</h1>
        <SkeletonCard />
      </div>
    );
  }

  // Not Found State
  if (!document) {
    return (
      <div className="space-y-8 text-center py-12">
        <div>
          <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white mb-2">Document Not Found</h2>
          <p className="text-navy-500 dark:text-navy-300">The document you're looking for doesn't exist or has been deleted.</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/documents')}>
          Back to Documents
        </Button>
      </div>
    );
  }

  const getStatusColor = (status: Document['status']): any => {
    switch (status) {
      case 'draft':
        return 'warning';
      case 'pending_approval':
        return 'info';
      case 'released':
        return 'success';
      case 'rejected':
        return 'error';
      case 'archived':
        return 'default';
      default:
        return 'default';
    }
  };

  const isCheckedOut = document.checkoutStatus === 'checked_out';
  const isDraft = document.status === 'draft';
  const isPending = document.status === 'pending_approval';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate('/documents')}
          className="text-blue-600 dark:text-cyan-400 hover:text-blue-700 dark:hover:text-cyan-300 font-medium"
        >
          Documents
        </button>
        <ChevronRight className="w-4 h-4 text-navy-400" />
        <span className="text-navy-600 dark:text-navy-300 truncate">{document.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white truncate">
            {document.name}
          </h1>
          <Badge status={getStatusColor(document.status)} variant="outline">
            {document.status.replace('_', ' ')}
          </Badge>
          {isCheckedOut && (
            <Badge status="warning" variant="outline">
              🔒 Locked
            </Badge>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={handleDownload}
          disabled={isOperating}
        >
          <Download className="w-4 h-4 mr-2 inline" />
          Download
        </Button>
      </div>

      {/* Main Content: PDF + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* PDF Viewer */}
        <div className="lg:col-span-2">
          <Card>
            <div className="bg-white dark:bg-navy-950 rounded-lg p-4 h-[500px] flex items-center justify-center">
              <PDFViewer fileUrl="" fileName={document.fileName} />
            </div>
          </Card>
        </div>

        {/* Sidebar: Document Details & Actions */}
        <div className="lg:col-span-1 space-y-4">
          {/* Document Info Card */}
          <Card>
            <div className="p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Document Info</h2>
            </div>
            <CardBody className="space-y-4 text-sm">
              <div>
                <p className="text-gray-600 dark:text-gray-400">File Name</p>
                <p className="font-medium text-navy-900 dark:text-white break-all">{document.fileName}</p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">File Size</p>
                <p className="font-medium text-navy-900 dark:text-white">{formatFileSize(document.fileSize)}</p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">Uploaded By</p>
                <p className="font-medium text-navy-900 dark:text-white">{document.uploadedByUser?.fullName || 'Unknown'}</p>
                <p className="text-xs text-gray-500">{document.uploadedByUser?.email}</p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400">Uploaded At</p>
                <p className="font-medium text-navy-900 dark:text-white">{formatDate(document.uploadedAt)}</p>
              </div>
              {document.description && (
                <div>
                  <p className="text-gray-600 dark:text-gray-400">Description</p>
                  <p className="font-medium text-navy-900 dark:text-white">{document.description}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Checkout Status Card */}
          {isCheckedOut && (
            <Card className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900">
              <CardBody className="text-sm space-y-3">
                <p className="font-medium text-yellow-900 dark:text-yellow-300">
                  🔒 This document is locked for editing
                </p>
                <p className="text-xs text-yellow-800 dark:text-yellow-400">
                  Checked out by: <span className="font-medium">{document.checkedOutBy}</span>
                </p>
                {document.checkedOutAt && (
                  <p className="text-xs text-yellow-800 dark:text-yellow-400">
                    Since: <span className="font-medium">{formatDate(document.checkedOutAt)}</span>
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {/* Document Actions */}
          <Card>
            <div className="p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Actions</h2>
            </div>
            <CardBody className="space-y-2">
              {/* Lock/Unlock Actions */}
              {isDraft && !isCheckedOut && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLock}
                  disabled={isOperating}
                  className="w-full justify-center"
                >
                  <Lock className="w-4 h-4 mr-2 inline" />
                  Lock for Editing
                </Button>
              )}

              {isCheckedOut && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUnlock}
                  disabled={isOperating}
                  className="w-full justify-center"
                >
                  <Unlock className="w-4 h-4 mr-2 inline" />
                  Unlock
                </Button>
              )}

              {/* Submit for Approval */}
              {isDraft && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSubmitApproval}
                  disabled={isOperating || isCheckedOut}
                  className="w-full justify-center"
                >
                  📤 Submit for Approval
                </Button>
              )}

              {/* Approve/Reject (for Managers) */}
              {isPending && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setApproveModal({ isOpen: true, comments: '' })}
                    disabled={isOperating}
                    className="w-full justify-center bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 inline" />
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setRejectModal({ isOpen: true, reason: '' })}
                    disabled={isOperating}
                    className="w-full justify-center"
                  >
                    <XCircle className="w-4 h-4 mr-2 inline" />
                    Reject
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Approval Modal */}
      {approveModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700 bg-green-50 dark:bg-green-900/20">
              <h2 className="text-lg font-serif font-bold text-green-900 dark:text-green-300">Approve Document</h2>
              <button
                onClick={() => setApproveModal({ isOpen: false, comments: '' })}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">
                  Comments (Optional)
                </label>
                <textarea
                  placeholder="Add approval comments..."
                  value={approveModal.comments}
                  onChange={(e) => setApproveModal({ ...approveModal, comments: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-green-500 h-24"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setApproveModal({ isOpen: false, comments: '' })}
                  disabled={isOperating}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleApprove}
                  disabled={isOperating}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isOperating ? 'Approving...' : 'Approve'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700 bg-red-50 dark:bg-red-900/20">
              <h2 className="text-lg font-serif font-bold text-red-900 dark:text-red-300">Reject Document</h2>
              <button
                onClick={() => setRejectModal({ isOpen: false, reason: '' })}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">
                  Rejection Reason *
                </label>
                <textarea
                  placeholder="Explain why this document is being rejected..."
                  value={rejectModal.reason}
                  onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-red-500 h-24"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setRejectModal({ isOpen: false, reason: '' })}
                  disabled={isOperating}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleReject}
                  disabled={isOperating || !rejectModal.reason.trim()}
                >
                  {isOperating ? 'Rejecting...' : 'Reject'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
