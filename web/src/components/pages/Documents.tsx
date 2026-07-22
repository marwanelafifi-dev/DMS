import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Columns3, Upload, UploadCloud, X } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { DocumentList } from '../custom/DocumentList';
import { SkeletonTable } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import type { Document, Folder } from '../../types';

export function Documents() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; docId?: string; docName?: string }>({ isOpen: false });

  useEffect(() => {
    const loadFolders = async () => {
      setIsLoadingFolders(true);
      try {
        const res = await apiClient.getFolders();
        const foldersList = res.data || [];
        setFolders(foldersList);
        if (foldersList.length > 0) {
          setSelectedFolder(foldersList[0]);
          setSelectedFolderId(foldersList[0].folderId);
        }
      } catch (err) {
        showError('Failed to load folders');
        console.error(err);
      } finally {
        setIsLoadingFolders(false);
      }
    };

    loadFolders();
  }, []);

  useEffect(() => {
    if (!selectedFolderId) return;

    const loadDocuments = async () => {
      setIsLoadingDocs(true);
      try {
        const res = await apiClient.getDocuments(selectedFolderId);
        setDocuments(res.data || []);
      } catch (err) {
        showError('Failed to load documents');
        console.error(err);
      } finally {
        setIsLoadingDocs(false);
      }
    };

    loadDocuments();
  }, [selectedFolderId]);

  useEffect(() => {
    if (!showUploadModal && !deleteConfirm.isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showUploadModal && !isUploading) {
        setShowUploadModal(false);
        setUploadFile(null);
      }
      if (deleteConfirm.isOpen) setDeleteConfirm({ isOpen: false });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirm.isOpen, isUploading, showUploadModal]);

  const handleFolderSelect = (folderId: string) => {
    const folder = folders.find((candidate) => candidate.folderId === folderId);
    if (!folder) return;
    setSelectedFolder(folder);
    setSelectedFolderId(folder.folderId);
  };

  const filteredDocuments = documents.filter((document) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = document.name.toLowerCase().includes(query)
      || (document.uploadedByUser?.fullName?.toLowerCase().includes(query) ?? false);
    const matchesStatus = !statusFilter || document.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const reloadDocuments = async () => {
    if (!selectedFolderId) return;
    const res = await apiClient.getDocuments(selectedFolderId);
    setDocuments(res.data || []);
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await apiClient.deleteDocument(docId);
      showSuccess('Document deleted successfully');
      setDeleteConfirm({ isOpen: false });
      await reloadDocuments();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete document');
    }
  };

  const handleDownloadDocument = async (docId: string) => {
    try {
      const document = documents.find((candidate) => candidate.documentId === docId);
      if (!document?.currentVersionId) {
        showError('This document does not have an uploaded file version');
        return;
      }
      await apiClient.downloadDocument(docId, document.currentVersionId);
      showSuccess('Document download started');
    } catch {
      showError('Failed to download document');
    }
  };

  const handleDownloadForEdit = async (docId: string) => {
    const document = documents.find((candidate) => candidate.documentId === docId);
    if (!document?.currentVersionId) {
      showError('This document does not have an uploaded file version');
      return;
    }

    try {
      await apiClient.checkoutDocument(docId, document.currentVersionId);
      await apiClient.downloadDocument(docId, document.currentVersionId);
      showSuccess('Document checked out and downloaded for editing');
      await reloadDocuments();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to check out document for editing');
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedFolderId || !uploadFile) {
      showError('Please select a folder and file');
      return;
    }

    setIsUploading(true);
    try {
      const docRes = await apiClient.createDocument({
        folderId: selectedFolderId,
        title: uploadFile.name.replace(/\.[^/.]+$/, ''),
        ownerId: DEV_USER_ID,
      });

      if (docRes.data?.documentId) {
        await apiClient.uploadDocument(docRes.data.documentId, uploadFile);
        showSuccess('Document uploaded successfully');
        setShowUploadModal(false);
        setUploadFile(null);
        await reloadDocuments();
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload document');
    } finally {
      setIsUploading(false);
    }
  };

  const stageFile = (file?: File) => {
    if (!file) return;
    setUploadFile(file);
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setUploadFile(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Document Library</h1>
        <p className="page-subtitle">Secure vault · Documents are view-only by default</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(235px,0.72fr)_minmax(0,3.2fr)]">
        <div>
          {isLoadingFolders ? (
            <div className="space-y-2 rounded-[5px] border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900">
              {[1, 2, 3].map((item) => <div key={item} className="h-8 animate-skeleton rounded bg-slate-100 dark:bg-slate-800" />)}
            </div>
          ) : folders.length === 0 ? (
            <div className="rounded-[5px] border border-[#dbe2ec] bg-white p-5 text-center dark:border-white/10 dark:bg-slate-900">
              <p className="text-sm">No folders available</p>
            </div>
          ) : (
            <FolderTree folders={folders} selectedFolderId={selectedFolderId} onSelectFolder={handleFolderSelect} />
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div
            className="flex min-h-[100px] cursor-pointer items-center justify-center rounded-[5px] border-2 border-dashed border-[#cbd5e3] bg-white px-5 text-center hover:border-[#74a8d2] dark:border-slate-700 dark:bg-slate-900"
            onClick={() => setShowUploadModal(true)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              stageFile(event.dataTransfer.files?.[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === 'Enter' && setShowUploadModal(true)}
          >
            <div>
              <UploadCloud className="mx-auto h-7 w-7 text-[#93a4bd]" />
              <p className="mt-2 text-sm text-[#718198]">Drag &amp; drop files here, or <span className="font-medium text-[#3f8bca]">browse</span>. New uploads enter the C-Doc workflow.</p>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[#e2e8f0] p-3 dark:border-white/10 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Filter by name..."
                className="field-control h-9 w-full sm:max-w-[230px]"
                aria-label="Filter documents by name"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <select className="field-control h-9 w-full sm:w-[150px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter documents by status">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">In Review</option>
                <option value="released">Released</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
              <button className="ml-auto inline-flex h-9 items-center gap-2 px-2 text-sm text-[#64748b] hover:text-[#283a7a]" type="button">
                <Columns3 className="h-4 w-4" /> Columns
              </button>
            </div>

            {isLoadingDocs ? (
              <div className="p-4"><SkeletonTable /></div>
            ) : filteredDocuments.length === 0 ? (
              <div className="p-12 text-center">
                <p className="mb-4 text-sm text-[#718198]">{documents.length === 0 ? 'No documents in this folder' : 'No documents matching your filters'}</p>
                {documents.length === 0 && selectedFolder && (
                  <Button onClick={() => setShowUploadModal(true)} leftIcon={<Upload className="h-4 w-4" />}>Upload First Document</Button>
                )}
              </div>
            ) : (
              <DocumentList
                documents={filteredDocuments}
                onDocumentClick={(docId) => navigate(`/documents/${docId}`)}
                onDownload={handleDownloadDocument}
                onDownloadForEdit={handleDownloadForEdit}
                onDelete={(docId, docName) => setDeleteConfirm({ isOpen: true, docId, docName })}
              />
            )}
          </Card>
        </div>
      </div>

      {showUploadModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-document-title">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-5 dark:border-white/10">
              <h2 id="upload-document-title" className="section-heading">Upload Document</h2>
              <button onClick={closeUploadModal} className="text-slate-500 hover:text-slate-700 dark:text-slate-400" aria-label="Close upload dialog">
                <X className="h-5 w-5" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div className="rounded-[5px] border-2 border-dashed border-[#cbd5e3] p-6 text-center dark:border-slate-700">
                <input type="file" id="fileInput" className="hidden" onChange={(event) => stageFile(event.target.files?.[0])} />
                <label htmlFor="fileInput" className="cursor-pointer">
                  <UploadCloud className="mx-auto mb-3 h-7 w-7 text-[#93a4bd]" />
                  <p className="mb-2 text-sm font-medium text-[#26334d] dark:text-white">{uploadFile ? uploadFile.name : 'Click to select a file or drag and drop'}</p>
                  {!uploadFile && <p className="text-xs text-[#718198]">PDF, Word, Excel, PowerPoint, or images</p>}
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeUploadModal} disabled={isUploading}>Cancel</Button>
                <Button onClick={handleUploadDocument} disabled={!uploadFile || isUploading}>{isUploading ? 'Uploading...' : 'Upload'}</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-5 dark:border-white/10">
              <h2 id="delete-document-title" className="section-heading">Delete Document</h2>
              <button onClick={() => setDeleteConfirm({ isOpen: false })} className="text-slate-500 hover:text-slate-700" aria-label="Close delete dialog"><X className="h-5 w-5" /></button>
            </div>
            <CardBody>
              <p className="mb-6 text-sm text-[#52627a]">Are you sure you want to delete <span className="font-semibold text-[#26334d]">“{deleteConfirm.docName}”</span>? This action cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteConfirm({ isOpen: false })}>Cancel</Button>
                <Button variant="danger" onClick={() => deleteConfirm.docId && handleDeleteDocument(deleteConfirm.docId)}>Delete</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
