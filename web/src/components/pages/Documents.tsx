import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { UploadCloud, X } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { defaultVisibleDocumentColumns, DocumentList, type OptionalDocumentColumn } from '../custom/DocumentList';
import { DocumentPreview } from '../custom/DocumentPreview';
import { ColumnVisibilityMenu, LibraryBulkActions, type LibraryBulkAction } from '../custom/LibraryMenus';
import { SkeletonTable } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import {
  createUnavailableLibraryDocument,
  mockLibraryDocuments,
  mockLibraryFolders,
  type MockLibraryDocument,
} from '../../fixtures/documentLibrary';
import type { Document } from '../../types';
import {
  copyLibraryItems,
  deleteLibraryItems,
  getInvalidDestinationIds,
  moveLibraryItems,
  renameLibraryItem,
  selectionContainsNonEmptyFolder,
} from '../../services/documentLibraryOperations';

const defaultFolder = mockLibraryFolders[0];

export function Documents() {
  const { showSuccess, showError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folders, setFolders] = useState(() => mockLibraryFolders.map((folder) => ({ ...folder })));
  const [allDocuments, setAllDocuments] = useState(() => mockLibraryDocuments.map((document) => ({ ...document, tags: [...document.tags] })));
  const [selectedFolderId, setSelectedFolderId] = useState(defaultFolder.folderId);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ complete: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [previewDocument, setPreviewDocument] = useState<MockLibraryDocument | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<OptionalDocumentColumn>>(() => new Set(defaultVisibleDocumentColumns));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const documents = useMemo(() => allDocuments.filter((document) => document.folderId === selectedFolderId), [allDocuments, selectedFolderId]);
  const selectedFolder = folders.find((folder) => folder.folderId === selectedFolderId) ?? folders[0];
  const selectedItemCount = selectedDocumentIds.size + selectedFolderIds.size;
  const selectedNames = [
    ...folders.filter((folder) => selectedFolderIds.has(folder.folderId)).map((folder) => folder.name),
    ...allDocuments.filter((document) => selectedDocumentIds.has(document.documentId)).map((document) => document.fileName),
  ];
  const renameDocument = selectedDocumentIds.size === 1 && selectedFolderIds.size === 0
    ? allDocuments.find((document) => selectedDocumentIds.has(document.documentId))
    : undefined;
  const renameFolder = selectedFolderIds.size === 1 && selectedDocumentIds.size === 0
    ? folders.find((folder) => selectedFolderIds.has(folder.folderId))
    : undefined;
  const librarySelection = { folderIds: selectedFolderIds, documentIds: selectedDocumentIds };

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoadingFolders(false), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setIsLoadingDocs(true);
    const timer = window.setTimeout(() => setIsLoadingDocs(false), 80);
    return () => window.clearTimeout(timer);
  }, [selectedFolderId]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const findLibraryDocument = useCallback(
    (documentId: string) => allDocuments.find((document) => document.documentId === documentId),
    [allDocuments],
  );

  useEffect(() => {
    if (folders.some((folder) => folder.folderId === selectedFolderId)) return;
    setSelectedFolderId(folders[0]?.folderId ?? '');
  }, [folders, selectedFolderId]);

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

  const filteredDocuments = useMemo(() => documents.filter((document) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query
      || document.fileName.toLowerCase().includes(query)
      || document.department.toLowerCase().includes(query)
      || document.owner.fullName.toLowerCase().includes(query)
      || document.tags.some((tag) => tag.toLowerCase().includes(query))
      || document.folderName.toLowerCase().includes(query);
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
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
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

  const clearSelection = () => {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
  };

  const handleBulkAction = (action: LibraryBulkAction, value?: string) => {
    try {
      const currentState = { folders, documents: allDocuments };
      const nextState = action === 'copy'
        ? copyLibraryItems(currentState, librarySelection, value ?? '')
        : action === 'move'
          ? moveLibraryItems(currentState, librarySelection, value ?? '')
          : action === 'delete'
            ? deleteLibraryItems(currentState, librarySelection)
            : renameLibraryItem(currentState, librarySelection, value ?? '');
      setFolders(nextState.folders);
      setAllDocuments(nextState.documents);
      if (action === 'delete' && !nextState.folders.some((folder) => folder.folderId === selectedFolderId)) {
        setSelectedFolderId(nextState.folders[0]?.folderId ?? '');
      }
      if (previewDocument && !nextState.documents.some((document) => document.documentId === previewDocument.documentId)) closePreview();
      clearSelection();
      showSuccess(`${action[0].toUpperCase()}${action.slice(1)} completed successfully`);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The operation could not be completed.';
      showError(message);
      return message;
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedFolder) {
      showError('Create or restore a folder before uploading documents');
      return;
    }
    if (uploadFiles.length === 0) {
      showError('Please select at least one file');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ complete: 0, total: uploadFiles.length });
    const uploaded: MockLibraryDocument[] = [];
    const errors: string[] = [];
    try {
      for (const uploadFile of uploadFiles) {
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
          objectUrlsRef.current.add(sourceUrl);
          const timestamp = new Date().toISOString();
          const source: Document = {
            documentId: docRes.data.documentId,
            currentVersionId: docRes.data.currentVersionId,
            folderId: selectedFolderId,
            folder: selectedFolder,
            name: uploadFile.name.replace(/\.[^/.]+$/, ''),
            fileName: uploadFile.name,
            fileSize: uploadFile.size,
            contentType: uploadFile.type || 'application/octet-stream',
            status: docRes.data.status ?? 'draft',
            department: 'General',
            tags: [],
            uploadedBy: DEV_USER_ID,
            uploadedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
            modifiedAt: timestamp,
          };
          const uploadedDocument = createUnavailableLibraryDocument(
            source,
            'A browser preview is not available for this newly uploaded file. Download the read-only source to view it locally.',
          );
          uploadedDocument.sourceUrl = sourceUrl;
          if (extension === 'txt') uploadedDocument.preview = { kind: 'text', content: await uploadFile.text() };
          if (extension === 'pdf') uploadedDocument.preview = { kind: 'pdf', url: sourceUrl };
          if (['png', 'jpg', 'jpeg'].includes(extension ?? '')) uploadedDocument.preview = { kind: 'image', url: sourceUrl, alt: uploadFile.name };
          uploaded.push(uploadedDocument);
        } catch (error: any) {
          errors.push(error.response?.data?.error || `${uploadFile.name} could not be uploaded`);
        } finally {
          setUploadProgress((current) => ({ ...current, complete: current.complete + 1 }));
        }
      }
      if (uploaded.length > 0) setAllDocuments((current) => [...current, ...uploaded]);
      if (errors.length > 0) showError(`${uploaded.length} uploaded; ${errors.length} failed`);
      else showSuccess(`${uploaded.length} ${uploaded.length === 1 ? 'document' : 'documents'} uploaded successfully`);
      if (errors.length === 0) {
        setShowUploadModal(false);
        setUploadFiles([]);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const stageFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!selectedFolder) {
      showError('Create or restore a folder before uploading documents');
      return;
    }
    setUploadFiles(files);
    setUploadProgress({ complete: 0, total: files.length });
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setUploadFiles([]);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Document Library</h1>
        <p className="page-subtitle">Secure vault · Documents are view-only by default</p>
      </div>

      {isLoadingFolders ? (
        <div className="w-full space-y-2 rounded-[5px] border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900" role="status" aria-label="Loading folders">
          {[1, 2].map((item) => <div key={item} className="h-12 animate-skeleton rounded bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : folders.length === 0 ? (
        <div className="w-full rounded-[5px] border border-[#dbe2ec] bg-white p-5 text-center dark:border-white/10 dark:bg-slate-900"><p className="text-sm">No folders available</p></div>
      ) : (
        <FolderTree
          folders={folders}
          selectedFolderId={selectedFolderId}
          selectedFolderIds={selectedFolderIds}
          onSelectFolder={handleFolderSelect}
          onToggleFolderSelection={(folderId) => setSelectedFolderIds((current) => {
            const next = new Set(current);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
          })}
        />
      )}

      <div className="min-w-0 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Select documents to upload"
            onChange={(event) => {
              stageFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <div
            className="flex min-h-[100px] flex-col items-center justify-center gap-3 rounded-[5px] border-2 border-dashed border-[#cbd5e3] bg-white px-5 py-4 text-center hover:border-[#74a8d2] dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:justify-between sm:text-left"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); stageFiles(Array.from(event.dataTransfer.files ?? [])); }}
          >
            <div className="flex items-center gap-3">
              <UploadCloud className="h-7 w-7 flex-shrink-0 text-[#93a4bd]" />
              <p className="text-sm text-[#718198]">Drag &amp; drop files here, or choose files. New uploads enter the C-Doc workflow.</p>
            </div>
            <Button type="button" aria-label="Upload files" disabled={!selectedFolder} title={selectedFolder ? 'Upload files to the selected folder' : 'A folder is required before uploading'} onClick={() => fileInputRef.current?.click()} leftIcon={<UploadCloud className="h-4 w-4" />}>Upload</Button>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[#e2e8f0] p-3 dark:border-white/10 sm:flex-row sm:items-center">
              <input type="text" placeholder="Search" className="field-control h-9 w-full sm:max-w-[230px]" aria-label="Search documents" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <select className="field-control h-9 w-full sm:w-[150px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter documents by status">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">In Review</option>
                <option value="released">Released</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
              <div className="ml-auto flex items-center gap-2">
                <LibraryBulkActions
                  selectedCount={selectedItemCount}
                  selectedNames={selectedNames}
                  canRename={selectedItemCount === 1}
                  renameCurrentName={renameDocument?.fileName ?? renameFolder?.name}
                  renameIsFile={Boolean(renameDocument)}
                  folders={folders}
                  disabledDestinationIds={getInvalidDestinationIds(folders, selectedFolderIds)}
                  containsNonEmptyFolder={selectionContainsNonEmptyFolder({ folders, documents: allDocuments }, librarySelection)}
                  onConfirm={handleBulkAction}
                />
                <ColumnVisibilityMenu visibleColumns={visibleColumns} onChange={setVisibleColumns} />
              </div>
            </div>

            {isLoadingDocs ? (
              <div className="p-4" role="status" aria-label="Loading documents"><SkeletonTable /></div>
            ) : filteredDocuments.length === 0 ? (
              <div className="p-12 text-center"><p className="text-sm text-[#718198]">{documents.length === 0 ? 'No documents in this folder' : 'No documents matching your filters'}</p></div>
            ) : (
              <DocumentList
                documents={filteredDocuments}
                selectedDocumentIds={selectedDocumentIds}
                visibleColumns={visibleColumns}
                onSelectedDocumentIdsChange={setSelectedDocumentIds}
                onDocumentClick={openDocumentPreview}
                onDownload={handleDownloadDocument}
              />
            )}
          </Card>
      </div>

      {previewDocument && <DocumentPreview document={previewDocument} onClose={closePreview} onDownload={downloadMockDocument} />}

      <Dialog.Root open={showUploadModal} onOpenChange={(open) => open ? setShowUploadModal(true) : closeUploadModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
          <Dialog.Content asChild>
            <Card className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-5 dark:border-white/10">
              <Dialog.Title className="section-heading">Upload Documents</Dialog.Title>
              <Dialog.Close asChild><button type="button" disabled={isUploading} className="text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400" aria-label="Close upload dialog"><X className="h-5 w-5" /></button></Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Review selected files and upload them to the current folder.</Dialog.Description>
            <CardBody className="space-y-4">
              <div className="rounded-[5px] border-2 border-dashed border-[#cbd5e3] p-5 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#26334d] dark:text-white">{uploadFiles.length} {uploadFiles.length === 1 ? 'file' : 'files'} ready</p>
                    <p className="mt-1 text-xs text-[#718198]">PDF, Word, Excel, PowerPoint, text, or images</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>Choose files</Button>
                </div>
                <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs text-[#52627a]">
                  {uploadFiles.map((file) => <li key={`${file.name}-${file.size}`} className="truncate">{file.name}</li>)}
                </ul>
              </div>
              <p className="text-xs text-[#718198]">{selectedFolder ? `Uploading to ${selectedFolder.name}. New documents remain view-only while entering review.` : 'A folder is required before uploading documents.'}</p>
              {isUploading && (
                <div role="status" aria-label="Upload progress" className="space-y-1.5">
                  <div className="flex justify-between text-xs text-[#52627a]"><span>Uploading</span><span>{uploadProgress.complete} / {uploadProgress.total}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#3f8bca] transition-all" style={{ width: `${uploadProgress.total ? (uploadProgress.complete / uploadProgress.total) * 100 : 0}%` }} /></div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeUploadModal} disabled={isUploading}>Cancel</Button>
                <Button onClick={handleUploadDocument} disabled={uploadFiles.length === 0 || isUploading}>{isUploading ? 'Uploading...' : `Upload ${uploadFiles.length} ${uploadFiles.length === 1 ? 'file' : 'files'}`}</Button>
              </div>
            </CardBody>
            </Card>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
