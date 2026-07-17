import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PDFViewer } from '../custom/PDFViewer';
import { DocumentDetailsPanel } from '../custom/DocumentDetailsPanel';
import { useToast } from '../../hooks/useToast';
import { useDocumentStore } from '../../hooks/useDocumentState';
import type { Document } from '../../types';
import { SkeletonCard } from '../ui';

export function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();
  const { updateDocument, applyChanges } = useDocumentStore();

  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLockingLoading, setIsLockingLoading] = useState(false);
  const [statusChanged, setStatusChanged] = useState(false);

  // Load Document
  useEffect(() => {
    const loadDocument = async () => {
      try {
        setIsLoading(true);

        // Mock Document Data - keyed by ID
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
            checkoutStatus: 'checked_out',
            checkedOutBy: 'user-1',
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
          'doc-4': {
            documentId: 'doc-4',
            folderId: 'folder-1',
            name: 'Audit Results Q2 2026',
            fileName: 'audit-results-q2.xlsx',
            fileSize: 512000,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            status: 'released',
            uploadedBy: 'user-4',
            uploadedByUser: { userId: 'user-4', fullName: 'Sarah Johnson', email: 'sarah@si-ware.com', role: 'Manager', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
          'doc-5': {
            documentId: 'doc-5',
            folderId: 'folder-1',
            name: 'Employee Training Records',
            fileName: 'training-records.docx',
            fileSize: 1024000,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 'pending_approval',
            uploadedBy: 'user-5',
            uploadedByUser: { userId: 'user-5', fullName: 'Lisa Chen', email: 'lisa@si-ware.com', role: 'Writer', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
          'doc-6': {
            documentId: 'doc-6',
            folderId: 'folder-1',
            name: 'Company Logo High Resolution',
            fileName: 'logo-hires.png',
            fileSize: 3072000,
            contentType: 'image/png',
            status: 'released',
            uploadedBy: 'user-6',
            uploadedByUser: { userId: 'user-6', fullName: 'Design Team', email: 'design@si-ware.com', role: 'Manager', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
          'doc-7': {
            documentId: 'doc-7',
            folderId: 'folder-1',
            name: 'Q3 2026 Management Review',
            fileName: 'q3-management-review.pptx',
            fileSize: 4096000,
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            status: 'draft',
            uploadedBy: 'user-2',
            uploadedByUser: { userId: 'user-2', fullName: 'Ahmed Ali', email: 'ahmed@si-ware.com', role: 'Manager', isActive: true, createdAt: '' },
            uploadedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
          },
        };

        const mockDocument = mockDocuments[id || 'doc-1'] || mockDocuments['doc-1'];
        const documentWithChanges = applyChanges(mockDocument);
        setDocument(documentWithChanges);
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
      // Call backend API: POST /api/documents/{id}/versions/{versionId}/checkout
      showInfo('Locking file for editing...');
      // const response = await apiClient.checkoutDocument(document.documentId, document.uploadedAt);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const updatedDoc = {
        ...document,
        checkoutStatus: 'checked_out',
        checkedOutBy: 'user-1',
        checkedOutAt: new Date().toISOString(),
      };
      setDocument(updatedDoc);
      updateDocument(document.documentId, {
        checkoutStatus: 'checked_out',
        checkedOutBy: 'user-1',
        checkedOutAt: new Date().toISOString(),
      });

      setStatusChanged(true);
      setTimeout(() => setStatusChanged(false), 2000);
      showSuccess('✓ File locked for editing (60-min timeout)');
    } catch (error) {
      showError('Lock failed');
    } finally {
      setIsLockingLoading(false);
    }
  };

  const handleSubmitApproval = async () => {
    if (!document) return;

    try {
      // Call backend API: POST /api/documents/{id}/submit
      showInfo('Submitting for approval...');
      // const response = await apiClient.submitForApproval(document.documentId);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const updatedDoc = {
        ...document,
        status: 'pending_approval' as const,
      };
      setDocument(updatedDoc);
      updateDocument(document.documentId, { status: 'pending_approval' });
      setStatusChanged(true);
      setTimeout(() => setStatusChanged(false), 2000);
      showSuccess('✓ Document submitted for approval! Status: DRAFT → PENDING APPROVAL');
    } catch (error) {
      showError('Submission failed');
    }
  };

  const handleApprove = async () => {
    if (!document) return;

    try {
      // Call backend API: POST /api/documents/{id}/approve
      showInfo('Approving document...');
      // const response = await apiClient.approveDocument(document.documentId);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const updatedDoc = {
        ...document,
        status: 'released' as const,
      };
      setDocument(updatedDoc);
      updateDocument(document.documentId, { status: 'released' });

      setStatusChanged(true);
      setTimeout(() => setStatusChanged(false), 2000);
      showSuccess('✓ Document approved! Status: PENDING APPROVAL → RELEASED');
    } catch (error) {
      showError('Approval failed');
    }
  };

  const handleReject = async () => {
    if (!document) return;

    try {
      // Call backend API: POST /api/documents/{id}/reject
      showInfo('Rejecting document...');
      // const response = await apiClient.rejectDocument(document.documentId);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const updatedDoc = {
        ...document,
        status: 'draft' as const,
      };
      setDocument(updatedDoc);
      updateDocument(document.documentId, { status: 'draft' });

      setStatusChanged(true);
      setTimeout(() => setStatusChanged(false), 2000);
      showSuccess('✓ Document rejected and returned to DRAFT for corrections');
    } catch (error) {
      showError('Rejection failed');
    }
  };

  const handleUnlock = async () => {
    if (!document) return;

    try {
      // Call backend API: DELETE /api/documents/{id}/versions/{versionId}/checkout
      showInfo('Unlocking file...');
      // const response = await apiClient.checkinDocument(document.documentId);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const updatedDoc = {
        ...document,
        checkoutStatus: 'checked_in',
        checkedOutBy: undefined,
        checkedOutAt: undefined,
      };
      setDocument(updatedDoc);
      updateDocument(document.documentId, {
        checkoutStatus: 'checked_in',
        checkedOutBy: undefined,
        checkedOutAt: undefined,
      });
      setStatusChanged(true);
      setTimeout(() => setStatusChanged(false), 2000);
      showSuccess('✓ File unlocked by admin');
    } catch (error) {
      showError('Unlock failed');
    }
  };

  const handleDownload = async () => {
    if (!document) return;

    try {
      // Call backend API: GET /api/documents/{id}/download
      showInfo('Downloading document...');
      // const response = await apiClient.downloadDocument(document.documentId);
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
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-navy-900">{document.name}</h1>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold transition-all ${
            document.status === 'released' ? 'bg-green-100 text-green-800' :
            document.status === 'pending_approval' ? 'bg-blue-100 text-blue-800' :
            'bg-orange-100 text-orange-800'
          }`}>
            {document.status.replace('_', ' ').toUpperCase()}
          </span>
          {statusChanged && (
            <span className="text-sm text-green-600 font-semibold animate-pulse">✓ Updated</span>
          )}
        </div>
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
            onUnlock={handleUnlock}
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
