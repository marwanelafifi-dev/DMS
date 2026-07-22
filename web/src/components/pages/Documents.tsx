import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Columns3, UploadCloud, X } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { DocumentList } from '../custom/DocumentList';
import { DocumentPreview } from '../custom/DocumentPreview';
import { SkeletonTable } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import {
  createUnavailableLibraryDocument,
  getMockDocumentsByFolder,
  getMockLibraryDocument,
  mockLibraryFolders,
  type MockLibraryDocument,
} from '../../fixtures/documentLibrary';
import type { Document } from '../../types';

const defaultFolder = mockLibraryFolders[0];

export function Documents() {
  const { showSuccess, showError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedFolderId, setSelectedFolderId] = useState(defaultFolder.folderId);
  const [documents, setDocuments] = useState<MockLibraryDocument[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [previewDocument, setPreviewDocument] = useState<MockLibraryDocument | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<MockLibraryDocument[]>([]);
  const uploadedDocumentsRef = useRef<MockLibraryDocument[]>([]);

  const selectedFolder = mockLibraryFolders.find((folder) => folder.folderId === selectedFolderId) ?? defaultFolder;

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoadingFolders(false), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setIsLoadingDocs(true);
    const timer = window.setTimeout(() => {
      setDocuments([
        ...getMockDocumentsByFolder(selectedFolderId),
        ...uploadedDocuments.filter((document) => document.folderId === selectedFolderId),
      ]);
      setIsLoadingDocs(false);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedFolderId, uploadedDocuments]);

  useEffect(() => {
    uploadedDocumentsRef.current = uploadedDocuments;
  }, [uploadedDocuments]);

  useEffect(() => () => {
    uploadedDocumentsRef.current.forEach((document) => {
      if (document.sourceUrl) URL.revokeObjectURL(document.sourceUrl);
    });
  }, []);

  const findLibraryDocument = useCallback((documentId: string) => (
    getMockLibraryDocument(documentId)
    ?? uploadedDocuments.find((document) => document.documentId === documentId)
  ), [uploadedDocuments]);

  useEffect(() => {
    const previewId = searchParams.get('preview');
    if (!previewId) return;
    const requestedDocument = findLibraryDocument(previewId);
    if (requestedDocument) {
      setSelectedFolderId(requestedDocument.folderId);
      setPreviewDocument(requestedDocument);
      return;
    }

    let cancelled = false;
    const loadApiDocument = async () => {
      try {
        const response = await apiClient.getDocument(previewId);
        if (cancelled || !response.data) throw new Error('Document metadata was not returned');
        setPreviewDocument(createUnavailableLibraryDocument(
          response.data,
          'This live document does not expose a browser-safe preview. Download the read-only source to view it locally.',
        ));
      } catch {
        if (cancelled) return;
        const placeholder: Document = {
          documentId: previewId,
          folderId: defaultFolder.folderId,
          name: `Document ${previewId}`,
          fileName: `Document ${previewId}`,
          fileSize: 0,
          contentType: 'application/octet-stream',
          status: 'draft',
          uploadedBy: 'unknown',
          uploadedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setPreviewDocument(createUnavailableLibraryDocument(
          placeholder,
          'The preview could not be loaded. The document may be unavailable or the server may be offline.',
        ));
      }
    };
    void loadApiDocument();
    return () => { cancelled = true; };
  }, [findLibraryDocument, searchParams]);

  useEffect(() => {
    if (!showUploadModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isUploading) return;
      setShowUploadModal(false);
      setUploadFile(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUploading, showUploadModal]);

  const filteredDocuments = useMemo(() => documents.filter((document) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query
      || document.fileName.toLowerCase().includes(query)
      || document.description?.toLowerCase().includes(query);
    const matchesStatus = !statusFilter || document.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [documents, searchQuery, statusFilter]);

  const clearPreviewParam = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('preview');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closePreview = useCallback(() => {
    setPreviewDocument(null);
    clearPreviewParam();
  }, [clearPreviewParam]);

  const handleFolderSelect = (folderId: string) => {
    setSelectedFolderId(folderId);
    setPreviewDocument(null);
    clearPreviewParam();
  };

  const openDocumentPreview = (docId: string) => {
    const libraryDocument = findLibraryDocument(docId);
    if (!libraryDocument) {
      showError('Preview is not available for this document');
      return;
    }
    setPreviewDocument(libraryDocument);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('preview', libraryDocument.documentId);
      return next;
    }, { replace: true });
  };

  const downloadMockDocument = async (libraryDocument: MockLibraryDocument) => {
    try {
      let href: string | undefined;
      let fileName = libraryDocument.fileName;
      let shouldRevoke = false;

      if (libraryDocument.sourceUrl) {
        href = libraryDocument.sourceUrl;
      } else if (libraryDocument.preview.kind === 'image' || libraryDocument.preview.kind === 'pdf') {
        href = libraryDocument.preview.url;
      } else if (libraryDocument.fallbackDownload) {
        href = URL.createObjectURL(new Blob([libraryDocument.fallbackDownload.content], { type: 'text/plain;charset=utf-8' }));
        fileName = libraryDocument.fallbackDownload.fileName;
        shouldRevoke = true;
      } else if (libraryDocument.preview.kind === 'spreadsheet') {
        const csv = [libraryDocument.preview.columns, ...libraryDocument.preview.rows]
          .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
          .join('\n');
        href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        fileName = `${libraryDocument.fileName}-preview.csv`;
        shouldRevoke = true;
      }

      if (!href && libraryDocument.currentVersionId) {
        await apiClient.downloadDocument(libraryDocument.documentId, libraryDocument.currentVersionId);
        showSuccess('Read-only download started');
        return;
      }
      if (!href) throw new Error('No download source is available');
      const link = window.document.createElement('a');
      link.href = href;
      link.download = fileName;
      link.click();
      if (shouldRevoke) window.setTimeout(() => URL.revokeObjectURL(href), 0);
      showSuccess('Read-only download started');
    } catch (error) {
      console.error(error);
      showError('This sample is not available for download');
    }
  };

  const handleDownloadDocument = (docId: string) => {
    const libraryDocument = findLibraryDocument(docId);
    if (libraryDocument) void downloadMockDocument(libraryDocument);
  };

  const handleUploadDocument = async () => {
    if (!uploadFile) {
      showError('Please select a file');
      return;
    }

    setIsUploading(true);
    try {
      const docRes = await apiClient.createDocument({
        folderId: selectedFolderId,
        title: uploadFile.name.replace(/\.[^/.]+$/, ''),
        ownerId: DEV_USER_ID,
      });
      if (!docRes.data?.documentId) throw new Error('The server did not return a document ID');
      await apiClient.uploadDocument(docRes.data.documentId, uploadFile);

      const extension = uploadFile.name.toLowerCase().split('.').pop();
      const sourceUrl = URL.createObjectURL(uploadFile);
      const source: Document = {
        documentId: docRes.data.documentId,
        currentVersionId: docRes.data.currentVersionId,
        folderId: selectedFolderId,
        name: uploadFile.name.replace(/\.[^/.]+$/, ''),
        fileName: uploadFile.name,
        fileSize: uploadFile.size,
        contentType: uploadFile.type || 'application/octet-stream',
        status: docRes.data.status ?? 'draft',
        uploadedBy: DEV_USER_ID,
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const uploadedDocument = createUnavailableLibraryDocument(
        source,
        'A browser preview is not available for this newly uploaded file. Download the read-only source to view it locally.',
      );
      uploadedDocument.sourceUrl = sourceUrl;
      if (extension === 'txt') uploadedDocument.preview = { kind: 'text', content: await uploadFile.text() };
      if (extension === 'pdf') uploadedDocument.preview = { kind: 'pdf', url: sourceUrl };
      if (['png', 'jpg', 'jpeg'].includes(extension ?? '')) uploadedDocument.preview = { kind: 'image', url: sourceUrl, alt: uploadFile.name };
      setUploadedDocuments((current) => [...current, uploadedDocument]);
      showSuccess('Document uploaded successfully');
      setShowUploadModal(false);
      setUploadFile(null);
    } catch (error: any) {
      showError(error.response?.data?.error || 'Failed to upload document');
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
            <div className="space-y-2 rounded-[5px] border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900" role="status" aria-label="Loading folders">
              {[1, 2].map((item) => <div key={item} className="h-8 animate-skeleton rounded bg-slate-100 dark:bg-slate-800" />)}
            </div>
          ) : mockLibraryFolders.length === 0 ? (
            <div className="rounded-[5px] border border-[#dbe2ec] bg-white p-5 text-center dark:border-white/10 dark:bg-slate-900"><p className="text-sm">No folders available</p></div>
          ) : (
            <FolderTree folders={mockLibraryFolders} selectedFolderId={selectedFolderId} onSelectFolder={handleFolderSelect} />
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div
            className="flex min-h-[100px] cursor-pointer items-center justify-center rounded-[5px] border-2 border-dashed border-[#cbd5e3] bg-white px-5 text-center hover:border-[#74a8d2] dark:border-slate-700 dark:bg-slate-900"
            onClick={() => setShowUploadModal(true)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); stageFile(event.dataTransfer.files?.[0]); }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setShowUploadModal(true)}
          >
            <div>
              <UploadCloud className="mx-auto h-7 w-7 text-[#93a4bd]" />
              <p className="mt-2 text-sm text-[#718198]">Drag &amp; drop files here, or <span className="font-medium text-[#3f8bca]">browse</span>. New uploads enter the C-Doc workflow.</p>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[#e2e8f0] p-3 dark:border-white/10 sm:flex-row sm:items-center">
              <input type="text" placeholder="Filter by name..." className="field-control h-9 w-full sm:max-w-[230px]" aria-label="Filter documents by name" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <select className="field-control h-9 w-full sm:w-[150px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter documents by status">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">In Review</option>
                <option value="released">Released</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
              <button className="ml-auto inline-flex h-9 items-center gap-2 px-2 text-sm text-[#64748b] hover:text-[#283a7a]" type="button"><Columns3 className="h-4 w-4" /> Columns</button>
            </div>

            {isLoadingDocs ? (
              <div className="p-4" role="status" aria-label="Loading documents"><SkeletonTable /></div>
            ) : filteredDocuments.length === 0 ? (
              <div className="p-12 text-center"><p className="text-sm text-[#718198]">{documents.length === 0 ? 'No documents in this folder' : 'No documents matching your filters'}</p></div>
            ) : (
              <DocumentList documents={filteredDocuments} onDocumentClick={openDocumentPreview} onDownload={handleDownloadDocument} />
            )}
          </Card>
        </div>
      </div>

      {previewDocument && <DocumentPreview document={previewDocument} onClose={closePreview} onDownload={downloadMockDocument} />}

      {showUploadModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-document-title">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-5 dark:border-white/10">
              <h2 id="upload-document-title" className="section-heading">Upload Document</h2>
              <button onClick={closeUploadModal} className="text-slate-500 hover:text-slate-700 dark:text-slate-400" aria-label="Close upload dialog"><X className="h-5 w-5" /></button>
            </div>
            <CardBody className="space-y-4">
              <div className="rounded-[5px] border-2 border-dashed border-[#cbd5e3] p-6 text-center dark:border-slate-700">
                <input type="file" id="fileInput" className="hidden" onChange={(event) => stageFile(event.target.files?.[0])} />
                <label htmlFor="fileInput" className="cursor-pointer">
                  <UploadCloud className="mx-auto mb-3 h-7 w-7 text-[#93a4bd]" />
                  <p className="mb-2 text-sm font-medium text-[#26334d] dark:text-white">{uploadFile ? uploadFile.name : 'Click to select a file or drag and drop'}</p>
                  {!uploadFile && <p className="text-xs text-[#718198]">PDF, Word, Excel, PowerPoint, text, or images</p>}
                </label>
              </div>
              <p className="text-xs text-[#718198]">Uploading to {selectedFolder.name}. New documents remain view-only while entering review.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeUploadModal} disabled={isUploading}>Cancel</Button>
                <Button onClick={handleUploadDocument} disabled={!uploadFile || isUploading}>{isUploading ? 'Uploading...' : 'Upload'}</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
