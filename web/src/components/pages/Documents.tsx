import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { DocumentList } from '../custom/DocumentList';
import { DocumentGrid } from '../custom/DocumentGrid';
import { UploadZone } from '../custom/UploadZone';
import { SearchFilter } from '../custom/SearchFilter';
import { useToast } from '../../hooks/useToast';
import type { Folder, Document } from '../../types';

export function Documents() {
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<any>({});

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

  // Load Documents for Selected Folder
  useEffect(() => {
    if (!selectedFolderId) return;

    const loadDocuments = async () => {
      setIsLoadingDocs(true);
      try {
        // Mock Documents Data
        const mockDocuments: Document[] = [
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
          },
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
          },
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
          },
        ];

        setDocuments(mockDocuments);
      } catch (error) {
        showError('Failed to load documents');
      } finally {
        setIsLoadingDocs(false);
      }
    };

    loadDocuments();
  }, [selectedFolderId, showError]);

  // Filter Documents
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !filters.status || doc.status === filters.status;
    const matchesOwner = !filters.owner || doc.uploadedByUser?.fullName.includes(filters.owner);

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

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this document?')) {
      // In real implementation, would delete the document
      showSuccess('Document deleted successfully');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white dark:text-white">Documents</h1>
          <p className="text-navy-200 dark:text-navy-200 mt-1 font-serif">
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
            <p className="text-sm font-semibold text-navy-300 dark:text-navy-300">
              {filteredDocuments.length} document{filteredDocuments.length !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('table')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'table'
                    ? 'bg-cyan-600 text-white shadow-md'
                    : 'bg-navy-600 dark:bg-navy-600 text-white dark:text-white hover:shadow-sm'
                }`}
                title="Table view"
              >
                ≡
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === 'grid'
                    ? 'bg-cyan-600 text-white shadow-md'
                    : 'bg-navy-600 dark:bg-navy-600 text-white dark:text-white hover:shadow-sm'
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
              onDelete={handleDelete}
            />
          ) : (
            <DocumentGrid
              documents={filteredDocuments}
              isLoading={isLoadingDocs}
              onDocumentClick={handleDocumentClick}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
