import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { DocumentList } from '../custom/DocumentList';
import { DocumentGrid } from '../custom/DocumentGrid';
import { useToast } from '../../hooks/useToast';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import { SkeletonTable } from '../ui/Skeleton';
import { Upload, Grid3x3, List, ChevronRight, X } from 'lucide-react';
import { Card, CardBody } from '../ui';
import type { Folder, Document } from '../../types';

export function Documents() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; docId?: string; docName?: string }>({ isOpen: false });

  // Load Folders from Backend
  useEffect(() => {
    const loadFolders = async () => {
      setIsLoadingFolders(true);
      try {
        const res = await apiClient.getFolders();
        const foldersList = res.data || [];
        setFolders(foldersList);

        // Set first folder as selected by default
        if (foldersList.length > 0) {
          setSelectedFolder(foldersList[0]);
          setSelectedFolderId(foldersList[0].folderId);
        }
      } catch (err: any) {
        showError('Failed to load folders');
        console.error(err);
      } finally {
        setIsLoadingFolders(false);
      }
    };

    loadFolders();
  }, []);

  // Load Documents for Selected Folder
  useEffect(() => {
    if (!selectedFolderId) return;

    const loadDocuments = async () => {
      setIsLoadingDocs(true);
      try {
        const res = await apiClient.getDocuments(selectedFolderId);
        const docsList = res.data || [];
        setDocuments(docsList);
      } catch (err: any) {
        showError('Failed to load documents');
        console.error(err);
      } finally {
        setIsLoadingDocs(false);
      }
    };

    loadDocuments();
  }, [selectedFolderId]);

  // Handle Folder Selection
  const handleFolderSelect = (folderId: string) => {
    const folder = folders.find(f => f.folderId === folderId);
    if (folder) {
      setSelectedFolder(folder);
      setSelectedFolderId(folder.folderId);
    }
  };

  // Filter Documents based on search
  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = (doc.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (doc.uploadedByUser?.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    return matchesSearch;
  });

  // Handle Document Delete
  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiClient.deleteDocument(docId);
      showSuccess('Document deleted successfully');
      setDeleteConfirm({ isOpen: false });
      // Reload documents
      if (selectedFolderId) {
        const res = await apiClient.getDocuments(selectedFolderId);
        setDocuments(res.data || []);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete document');
    }
  };

  // Handle Document Download
  const handleDownloadDocument = async (docId: string) => {
    try {
      const document = documents.find(doc => doc.documentId === docId);
      if (!document?.currentVersionId) {
        showError('This document does not have an uploaded file version');
        return;
      }

      await apiClient.downloadDocument(docId, document.currentVersionId);
      showSuccess('Document download started');
    } catch (err: any) {
      showError('Failed to download document');
    }
  };

  // Handle Document Upload
  const handleUploadDocument = async () => {
    if (!selectedFolderId || !uploadFile) {
      showError('Please select a folder and file');
      return;
    }

    setIsUploading(true);
    try {
      const file = uploadFile;

      // Create document record first
      const docRes = await apiClient.createDocument({
        folderId: selectedFolderId,
        title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        ownerId: DEV_USER_ID,
      });

      if (docRes.data?.documentId) {
        // Upload file
        await apiClient.uploadDocument(docRes.data.documentId, file);
        showSuccess('Document uploaded successfully');
        setShowUploadModal(false);
        setUploadFile(null);

        // Reload documents
        const res = await apiClient.getDocuments(selectedFolderId);
        setDocuments(res.data || []);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload document');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <span>Documents</span>
        {selectedFolder && (
          <>
            <ChevronRight className="w-4 h-4" />
            <span className="font-medium text-navy-900 dark:text-white">{selectedFolder.name}</span>
          </>
        )}
      </div>

      {/* Header with View Toggle */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Documents</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'table'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-navy-800 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-navy-700'
            }`}
            title="Table view"
          >
            <List className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'grid'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-navy-800 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-navy-700'
            }`}
            title="Grid view"
          >
            <Grid3x3 className="w-5 h-5" />
          </button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowUploadModal(true)}
            disabled={!selectedFolder || isUploading}
          >
            <Upload className="w-4 h-4 mr-2 inline" />
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Upload Document</h2>
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  setUploadFile(null);
                }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 dark:border-navy-700 rounded-lg p-6 text-center">
                <input
                  type="file"
                  id="fileInput"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setUploadFile(e.target.files[0]);
                    }
                  }}
                />
                <label htmlFor="fileInput" className="cursor-pointer">
                  <p className="text-sm font-medium text-navy-900 dark:text-white mb-2">
                    {uploadFile ? uploadFile.name : 'Click to select a file or drag and drop'}
                  </p>
                  {!uploadFile && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Supported formats: PDF, Word, Excel, PowerPoint, Images
                    </p>
                  )}
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadFile(null);
                  }}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleUploadDocument}
                  disabled={!uploadFile || isUploading}
                >
                  {isUploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Folder Tree */}
        <div className="lg:col-span-1">
          {isLoadingFolders ? (
            <div className="bg-white dark:bg-navy-950 rounded-lg p-4 space-y-2">
              <div className="h-8 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton" />
              <div className="h-8 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton" />
              <div className="h-8 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton" />
            </div>
          ) : folders.length === 0 ? (
            <div className="bg-gray-50 dark:bg-navy-950 rounded-lg p-4 text-center text-gray-500 dark:text-gray-400">
              <p className="text-sm">No folders available</p>
            </div>
          ) : (
            <FolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleFolderSelect}
            />
          )}
        </div>

        {/* Main - Document List */}
        <div className="lg:col-span-3 space-y-4">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search documents by name or owner..."
              className="w-full px-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Documents View */}
          {isLoadingDocs ? (
            <SkeletonTable />
          ) : filteredDocuments.length === 0 ? (
            <div className="bg-white dark:bg-navy-950 rounded-lg p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                {documents.length === 0 ? 'No documents in this folder' : 'No documents matching your search'}
              </p>
              {documents.length === 0 && selectedFolder && (
                <Button
                  variant="primary"
                  onClick={() => setShowUploadModal(true)}
                >
                  <Upload className="w-4 h-4 mr-2 inline" />
                  Upload First Document
                </Button>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <DocumentList
              documents={filteredDocuments}
              onDocumentClick={(docId: string) => navigate(`/documents/${docId}`)}
              onDownload={(docId: string) => handleDownloadDocument(docId)}
              onDelete={(docId: string, docName: string) => setDeleteConfirm({ isOpen: true, docId, docName })}
            />
          ) : (
            <DocumentGrid
              documents={filteredDocuments}
              onDocumentClick={(docId: string) => navigate(`/documents/${docId}`)}
              onDownload={(docId: string) => handleDownloadDocument(docId)}
              onDelete={(docId: string, docName: string) => setDeleteConfirm({ isOpen: true, docId, docName })}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Delete Document</h2>
              <button
                onClick={() => setDeleteConfirm({ isOpen: false })}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to delete <span className="font-semibold">"{deleteConfirm.docName}"</span>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteConfirm({ isOpen: false })}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => deleteConfirm.docId && handleDeleteDocument(deleteConfirm.docId)}
                >
                  Delete
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
