import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { DocumentList } from '../custom/DocumentList';
import { DocumentGrid } from '../custom/DocumentGrid';
import { UploadZone } from '../custom/UploadZone';
import { SearchFilter } from '../custom/SearchFilter';
import { useToast } from '../../hooks/useToast';
import { useDocumentStore } from '../../hooks/useDocumentState';
import type { Folder, Document } from '../../types';

export function Documents() {
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();
  const { applyChanges } = useDocumentStore();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<any>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; docId?: string; docName?: string }>({ isOpen: false });

  // Mock Folders Data
  useEffect(() => {
    const mockFolders: Folder[] = [
      {
        folderId: 'folder-1',
        name: 'QMS Documents',
        parentFolderId: undefined,
        ownerId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
        children: [
          {
            folderId: 'folder-1-1',
            name: 'Procedures',
            parentFolderId: 'folder-1',
            ownerId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isArchived: false,
            children: [],
          },
          {
            folderId: 'folder-1-2',
            name: 'Work Instructions',
            parentFolderId: 'folder-1',
            ownerId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isArchived: false,
            children: [],
          },
        ],
      },
      {
        folderId: 'folder-2',
        name: 'ISMS Documents',
        parentFolderId: undefined,
        ownerId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isArchived: false,
        children: [
          {
            folderId: 'folder-2-1',
            name: 'Policies',
            parentFolderId: 'folder-2',
            ownerId: 'user-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isArchived: false,
            children: [],
          },
        ],
      },
    ];

    setFolders(mockFolders);
    setSelectedFolderId('folder-1');
  }, []);

  // Subscribe to store changes to reload documents when they're updated
  const storeDocuments = useDocumentStore((state) => state.documents);

  // Load Documents for Selected Folder
  useEffect(() => {
    if (!selectedFolderId) return;

    const loadDocuments = async () => {
      setIsLoadingDocs(true);
      try {
        // Mock Documents Data - ordered by status (DRAFT first for testing)
        const baseMockDocuments: Document[] = [
          // DRAFT - can submit for approval
          {
            documentId: 'doc-3',
            folderId: selectedFolderId,
            name: 'Records Management Policy',
            fileName: 'records-policy.pdf',
            fileSize: 2097152,
            contentType: 'application/pdf',
            status: 'draft',
            uploadedBy: 'user-1',
            uploadedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_in',
            department: 'Compliance',
            tags: ['policy', 'records'],
          },
          {
            documentId: 'doc-7',
            folderId: selectedFolderId,
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
            department: 'Management',
            tags: ['review', 'q3'],
          },
          // PENDING_APPROVAL - can approve/reject
          {
            documentId: 'doc-2',
            folderId: selectedFolderId,
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
            department: 'QMS',
            tags: ['procedure', 'control'],
          },
          {
            documentId: 'doc-5',
            folderId: selectedFolderId,
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
            department: 'HR',
            tags: ['training', 'records'],
          },
          // RELEASED - already approved
          {
            documentId: 'doc-1',
            folderId: selectedFolderId,
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
            department: 'QMS',
            tags: ['quality', 'iso-9001'],
          },
          {
            documentId: 'doc-4',
            folderId: selectedFolderId,
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
            department: 'Audit',
            tags: ['audit', 'q2'],
          },
          {
            documentId: 'doc-6',
            folderId: selectedFolderId,
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
            department: 'Marketing',
            tags: ['branding', 'logo'],
          },
        ];

        // Apply any global state changes from Zustand store
        const documentsWithChanges = baseMockDocuments.map(doc => applyChanges(doc));

        setDocuments(documentsWithChanges);
      } catch (error) {
        showError('Failed to load documents');
      } finally {
        setIsLoadingDocs(false);
      }
    };

    loadDocuments();
  }, [selectedFolderId, showError, storeDocuments]);

  // Filter Documents
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = searchQuery === '' || doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !filters.status || filters.status === 'All Statuses' || doc.status === filters.status;
    const matchesOwner = !filters.owner || doc.uploadedByUser?.fullName.toLowerCase().includes(filters.owner.toLowerCase());

    return matchesSearch && matchesStatus && matchesOwner;
  });

  const handleFilesSelected = async (files: File[]) => {
    setIsUploading(true);
    try {
      for (const file of files) {
        // In real implementation, would call apiClient.uploadDocument()
        showInfo(`Uploading ${file.name}...`);
        // Simulate upload delay
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      showSuccess(`Successfully uploaded ${files.length} file(s)`);
      setShowUploadZone(false);
      // Reload documents
    } catch (error) {
      showError('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDocumentClick = (docId: string) => {
    navigate(`/documents/${docId}`);
  };

  const handleDownload = () => {
    showInfo('Downloading document...');
    // In real implementation, would call apiClient.downloadDocument()
  };

  const handleDelete = (docId: string, docName: string) => {
    setDeleteConfirm({ isOpen: true, docId, docName });
  };

  const handleConfirmDelete = () => {
    // In real implementation, would call apiClient.deleteDocument()
    showSuccess('Document deleted successfully');
    setDeleteConfirm({ isOpen: false });
    // Reload documents (in real app, would fetch from API)
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Documents</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1 font-serif">
            Manage and organize your documents
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowUploadZone(!showUploadZone)}
        >
          {showUploadZone ? 'Cancel' : '+ Upload Document'}
        </Button>
      </div>

      {/* Upload Zone */}
      {showUploadZone && (
        <UploadZone
          onFilesSelected={handleFilesSelected}
          isLoading={isUploading}
        />
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Folder Tree */}
        <div>
          <FolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
          />
        </div>

        {/* Main: Documents */}
        <div className="lg:col-span-3 space-y-6">
          {/* Search & Filter */}
          <SearchFilter
            onSearch={setSearchQuery}
            onAdvancedFilter={setFilters}
            showAdvanced={true}
          />

          {/* View Mode Toggle */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {filteredDocuments.length} document{filteredDocuments.length !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('table')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'table'
                    ? 'bg-gradient-primary text-white shadow-md'
                    : 'bg-white dark:bg-navy-700 text-navy-900 dark:text-white border border-gray-300 dark:border-navy-600 hover:shadow-sm'
                }`}
                title="Table view"
              >
                ≡
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'grid'
                    ? 'bg-gradient-primary text-white shadow-md'
                    : 'bg-white dark:bg-navy-700 text-navy-900 dark:text-white border border-gray-300 dark:border-navy-600 hover:shadow-sm'
                }`}
                title="Grid view"
              >
                ⊞
              </button>
            </div>
          </div>

          {/* Documents View */}
          {viewMode === 'table' ? (
            <DocumentList
              documents={filteredDocuments}
              isLoading={isLoadingDocs}
              onDocumentClick={handleDocumentClick}
              onDownload={handleDownload}
              onDelete={(docId, docName) => handleDelete(docId, docName)}
            />
          ) : (
            <DocumentGrid
              documents={filteredDocuments}
              isLoading={isLoadingDocs}
              onDocumentClick={handleDocumentClick}
              onDownload={handleDownload}
              onDelete={(docId, docName) => handleDelete(docId, docName)}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-navy-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200 dark:border-navy-700">
            {/* Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
              <h3 className="text-lg font-bold flex items-center gap-2 text-white">
                <span>⚠️</span> Delete Document
              </h3>
            </div>

            {/* Content */}
            <div className="px-6 py-4 space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                Are you sure you want to delete <span className="font-semibold text-navy-900 dark:text-blue-300">"{deleteConfirm.docName}"</span>?
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This action cannot be undone. The document will be permanently removed from the system.
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-navy-900 border-t border-gray-200 dark:border-navy-700 flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ isOpen: false })}
                className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
