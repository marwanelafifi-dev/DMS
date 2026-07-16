import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PDFViewer } from '../custom/PDFViewer';
import { DocumentDetailsPanel } from '../custom/DocumentDetailsPanel';
import { useToast } from '../../hooks/useToast';
import type { Document } from '../../types';
import { SkeletonCard } from '../ui';

export function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLockingLoading, setIsLockingLoading] = useState(false);

  // Load Document
  useEffect(() => {
    const loadDocument = async () => {
      try {
        setIsLoading(true);

        // Mock Document Data
        const mockDocument: Document = {
          documentId: id || 'doc-1',
          folderId: 'folder-1',
          name: 'ISO 9001:2015 Quality Procedure',
          fileName: 'quality-procedure.pdf',
          fileSize: 2048576,
          contentType: 'application/pdf',
          status: 'released',
          uploadedBy: 'user-2',
          uploadedByUser: {
            userId: 'user-2',
            fullName: 'Ahmed Ali',
            email: 'ahmed@si-ware.com',
            role: 'Manager',
            isActive: true,
            createdAt: '',
          },
          uploadedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          checkoutStatus: 'checked_in',
        };

        setDocument(mockDocument);
      } catch (error) {
        showError('Failed to load document');
        navigate('/documents');
      } finally {
        setIsLoading(false);
      }
    };

    loadDocument();
  }, [id, navigate, showError]);

  const handleLockForEditing = async () => {
    if (!document) return;

    try {
      setIsLockingLoading(true);
      // In real implementation, would call apiClient.checkoutDocument()
      showInfo('Locking file for editing...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update local state
      setDocument({
        ...document,
        checkoutStatus: 'checked_out',
        checkedOutBy: 'user-1',
        checkedOutAt: new Date().toISOString(),
      });

      showSuccess('File locked for editing (60-min timeout)');
    } catch (error) {
      showError('Lock failed');
    } finally {
      setIsLockingLoading(false);
    }
  };

  const handleSubmitApproval = async () => {
    if (!document) return;

    try {
      // In real implementation, would call apiClient.submitForApproval()
      showInfo('Submitting for approval...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setDocument({
        ...document,
        status: 'pending_approval',
      });

      showSuccess('Document submitted for approval');
    } catch (error) {
      showError('Submission failed');
    }
  };

  const handleApprove = async () => {
    if (!document) return;

    try {
      // In real implementation, would call apiClient.approveDocument()
      showInfo('Approving document...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setDocument({
        ...document,
        status: 'released',
      });

      showSuccess('Document approved');
    } catch (error) {
      showError('Approval failed');
    }
  };

  const handleReject = async () => {
    if (!document) return;

    try {
      // In real implementation, would call apiClient.rejectDocument()
      showInfo('Rejecting document...');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setDocument({
        ...document,
        status: 'draft',
      });

      showSuccess('Document rejected, returned to draft');
    } catch (error) {
      showError('Rejection failed');
    }
  };

  const handleDownload = async () => {
    if (!document) return;

    try {
      // In real implementation, would call apiClient.downloadDocument()
      showInfo('Downloading document...');
      const link = globalThis.document.createElement('a');
      link.href = `/documents/${document.documentId}/download`;
      link.download = document.fileName;
      link.click();
      showSuccess('Download started');
    } catch (error) {
      showError('Download failed');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Document Viewer</h1>
        <SkeletonCard />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">Document not found</p>
        <button
          onClick={() => navigate('/documents')}
          className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-md"
        >
          Back to Documents
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/documents')}
            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 text-sm mb-2"
          >
            ← Back to Documents
          </button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Document Viewer</h1>
        </div>
      </div>

      {/* Main Content: Split Screen (60% PDF, 40% Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
        {/* Left: PDF Viewer (60%) */}
        <div className="lg:col-span-2">
          <PDFViewer fileUrl="" fileName={document.fileName} />
        </div>

        {/* Right: Document Details Panel (40%) */}
        <div className="lg:col-span-1">
          <DocumentDetailsPanel
            document={document}
            onLockForEditing={handleLockForEditing}
            onSubmitApproval={handleSubmitApproval}
            onApprove={handleApprove}
            onReject={handleReject}
            onDownload={handleDownload}
            isLockingLoading={isLockingLoading}
          />
        </div>
      </div>

      {/* Mobile Layout: Stacked */}
      <style>{`
        @media (max-width: 1024px) {
          .grid {
            grid-template-columns: 1fr !important;
            height: auto !important;
          }
        }
      `}</style>
    </div>
  );
}
