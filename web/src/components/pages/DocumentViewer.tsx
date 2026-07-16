import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
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
        <div className="flex items-center gap-2 text-sm text-navy-300">
          <button
            onClick={() => navigate('/documents')}
            className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
          >
            Documents
          </button>
          <ChevronRight className="w-4 h-4 text-navy-500" />
          <span className="text-navy-400">Loading...</span>
        </div>
        <h1 className="text-3xl font-bold text-white">Document Viewer</h1>
        <SkeletonCard />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="space-y-8 text-center py-12">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Document Not Found</h2>
          <p className="text-navy-300">The document you're looking for doesn't exist or has been deleted.</p>
        </div>
        <button
          onClick={() => navigate('/documents')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg font-semibold shadow-md hover:shadow-lg transition-all"
        >
          Back to Documents
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate('/documents')}
          className="text-blue-600 hover:text-blue-700 transition-colors font-medium hover:underline"
        >
          Documents
        </button>
        <ChevronRight className="w-4 h-4 text-navy-400" />
        <span className="text-blue-600 font-medium truncate">{document.name}</span>
      </div>

      {/* Page Title */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-navy-900">{document.name}</h1>
      </div>

      {/* Main Content: Split Screen (60% PDF, 40% Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-280px)]">
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
