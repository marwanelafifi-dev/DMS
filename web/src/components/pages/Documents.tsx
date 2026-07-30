import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Files, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { defaultVisibleDocumentColumns, DocumentList, type OptionalDocumentColumn } from '../custom/DocumentList';
import { matchesDmsMetadata } from '../../utils/dmsMetadataSearch';
import { DocumentPreview } from '../custom/DocumentPreview';
import { BulkOperationsModal } from '../custom/BulkOperationsModal';
import { UploadApprovalModal } from '../custom/UploadApprovalModal';
import { ColumnVisibilityMenu, LibraryBulkActions, type LibraryBulkAction } from '../custom/LibraryMenus';
import { SkeletonTable } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import {
  createUnavailableLibraryDocument,
  mockLibraryDocuments,
  type LibraryPreview,
  type MockLibraryDocument,
} from '../../fixtures/documentLibrary';
import type { Document, Folder, User } from '../../types';
import {
  copyLibraryItems,
  deleteLibraryItems,
  getInvalidDestinationIds,
  moveLibraryItems,
  renameLibraryItem,
  selectionContainsNonEmptyFolder,
} from '../../services/documentLibraryOperations';
import { doclingApi } from '../../services/doclingApi';
import { loadSampleDocumentFiles } from '../../fixtures/sampleFiles';
import { downloadFolderAsZip } from '../../utils/folderDownload';
import { parseWordDocument, parseExcelDocument, parsePowerPointDocument } from '../../utils/officeParser';

function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The document text could not be read'));
    reader.readAsText(blob);
  });
}

const TEXT_PREVIEW_EXTENSIONS = new Set(['txt', 'csv', 'md', 'markdown', 'json', 'xml', 'log']);
const IMAGE_PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const MOCK_FILES_FOLDER_NAME = 'Mock Files';
const MOCK_FILES_FOLDER_DESCRIPTION = 'Local multi-format documents for upload, preview, OCR, and workflow testing';

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return { base: fileName, ext: '' };
  return { base: fileName.slice(0, dotIndex), ext: fileName.slice(dotIndex) };
}

async function createNativePreview(
  source: Blob,
  fileName: string,
  contentType: string,
  sourceUrl: string,
  registerObjectUrl?: (url: string) => void,
): Promise<LibraryPreview | null> {
  const extension = getFileExtension(fileName);
  if (contentType.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    const content = await readBlobAsText(source);
    return extension === 'md' || extension === 'markdown'
      ? { kind: 'markdown', content }
      : { kind: 'text', content };
  }
  if (contentType === 'application/pdf' || extension === 'pdf') {
    return { kind: 'pdf', url: sourceUrl };
  }
  if (contentType.startsWith('image/') || IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    return { kind: 'image', url: sourceUrl, alt: fileName };
  }
  const isWord = extension === 'docx' || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isPowerPoint = extension === 'pptx' || contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (isWord || isPowerPoint) {
    // Real Word/PowerPoint rendering: convert to PDF locally (LibreOffice, via the
    // OCR sidecar) and reuse the same pdf.js viewer already used for real PDFs —
    // true layout/fonts/images/tables instead of a plain-text reconstruction.
    try {
      const pdfBlob = await doclingApi.convertToPdf(source, fileName);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      registerObjectUrl?.(pdfUrl);
      return { kind: 'pdf', url: pdfUrl };
    } catch (error) {
      console.error(`Failed to render ${fileName} as PDF, falling back to text extraction:`, error);
      return isWord ? parseWordDocument(source, sourceUrl) : parsePowerPointDocument(source, sourceUrl);
    }
  }
  if (extension === 'xlsx' || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return parseExcelDocument(source, sourceUrl);
  }
  return null;
}

export function Documents() {
  const { showSuccess, showError } = useToast();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allDocuments, setAllDocuments] = useState(() => mockLibraryDocuments.map((document) => ({ ...document, tags: [...document.tags] })));
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [activeUploadStage, setActiveUploadStage] = useState<'uploading' | 'parsing'>('uploading');
  const [activeUploadFileName, setActiveUploadFileName] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadCustomCategory, setUploadCustomCategory] = useState('');
  const [uploadOwnerId, setUploadOwnerId] = useState(DEV_USER_ID);
  const [uploadDepartment, setUploadDepartment] = useState('');
  const [uploadCustomDepartment, setUploadCustomDepartment] = useState('');
  const [uploadApprovalNotes, setUploadApprovalNotes] = useState('');
  const [uploadOriginalDocumentId, setUploadOriginalDocumentId] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [canSetDocIdOnUpload, setCanSetDocIdOnUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ complete: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [previewDocument, setPreviewDocument] = useState<MockLibraryDocument | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [requestedFolderAction, setRequestedFolderAction] = useState<LibraryBulkAction | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<OptionalDocumentColumn>>(() => new Set(defaultVisibleDocumentColumns));
  const [showBulkOperationsModal, setShowBulkOperationsModal] = useState(false);
  const [pendingApprovalFiles, setPendingApprovalFiles] = useState<
    Array<{ documentId: string; filename: string; filesize: number; uploadedAt: string }>
  >([]);
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const previewRequestRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);

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
  // Approve/Reject/Delete/Download hit the real .NET API, so only documents with a
  // real GUID (not a bundled sample-fixture id like "folder-1-txt") are eligible —
  // sending a fixture id to the server would just come back as a per-item failure.
  const isServerDocumentId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const selectedServerDocuments = allDocuments.filter(
    (document) => selectedDocumentIds.has(document.documentId) && isServerDocumentId(document.documentId),
  );

  // Re-fetches server-backed documents and reconciles them into allDocuments —
  // used on mount and again after bulk approve/reject/delete so status changes
  // and deletions from the server are reflected without a full page reload.
  const refreshServerDocuments = useCallback(async (knownFolders: Folder[]) => {
    try {
      const [response, usersResponse] = await Promise.all([
        apiClient.getDocuments(),
        apiClient.getUsers().catch(() => ({ data: [] as User[] })),
      ]);
      if (!response.data || !Array.isArray(response.data)) return;

      // The API only returns ownerId (a GUID) on documents, not a nested owner
      // object — without resolving it here, createUnavailableLibraryDocument's
      // fallback kicks in and every single document shows the same placeholder
      // owner regardless of who actually uploaded it.
      const userById = new Map<string, User>(
        (usersResponse.data || []).map((user: User) => [user.userId, user]),
      );

      const liveDocuments = (response.data as Document[]).map((document) =>
        createUnavailableLibraryDocument(
          {
            ...document,
            owner: (document.ownerId ? userById.get(document.ownerId) : undefined) ?? document.owner,
            folder: knownFolders.find((folder) => folder.folderId === document.folderId),
          },
          'A browser preview is not available after reloading this document. Download the read-only source to view it locally.',
        ),
      );
      const liveIds = new Set(liveDocuments.map((document) => document.documentId));

      setAllDocuments((current) => {
        const merged = new Map(
          current
            // Drop server documents the server no longer has (e.g. bulk-deleted)
            // while leaving fixture/sample documents alone — they aren't server-backed.
            .filter((document) => liveIds.has(document.documentId) || !isServerDocumentId(document.documentId))
            .map((document) => [document.documentId, document] as const),
        );
        liveDocuments.forEach((document) => {
          const existing = merged.get(document.documentId);
          merged.set(document.documentId, existing ? {
            ...existing,
            ...document,
            preview: existing.preview.kind === 'unavailable' ? document.preview : existing.preview,
            sourceUrl: existing.sourceUrl,
            fallbackDownload: existing.fallbackDownload,
          } : document);
        });
        return [...merged.values()];
      });
    } catch (error) {
      console.error('Failed to load documents:', error);
      showError('Failed to load documents');
    }
  }, [showError]);

  useEffect(() => {
    apiClient.getUsers()
      .then((res) => setAllUsers(res.data || []))
      .catch(() => setAllUsers([]));
  }, []);

  // Document ID at upload time is System Admin only (QA only gets access to it
  // later, at First Review). This app has no global user role — roles are
  // granted per folder — so check the current user's role on whichever folder
  // the upload dialog is currently targeting.
  useEffect(() => {
    if (!selectedFolderId) {
      setCanSetDocIdOnUpload(false);
      return;
    }
    apiClient.getFolderPermissions(selectedFolderId)
      .then((res) => {
        const mine = (res.data || []).find((p: any) => p.userId === DEV_USER_ID);
        setCanSetDocIdOnUpload(mine?.role === 'Admin');
      })
      .catch(() => setCanSetDocIdOnUpload(false));
  }, [selectedFolderId]);

  useEffect(() => {
    let cancelled = false;
    const loadLibrary = async () => {
      let loadedFolders: Folder[] = [];
      try {
        const response = await apiClient.getFolders();
        if (response.data && Array.isArray(response.data)) {
          loadedFolders = response.data as Folder[];
          if (!cancelled) {
            setFolders(loadedFolders);
            if (loadedFolders.length > 0) {
              // Picking loadedFolders[0] unconditionally would often default to a
              // folder the current user only has read (or no) access to, which
              // makes uploads fail with a silent 403 the moment you hit Upload
              // without first clicking a different folder. Prefer the first
              // folder the user can actually write to.
              const writableRoles = new Set(['Writer', 'Manager', 'QA', 'Admin']);
              let defaultFolderId = loadedFolders[0].folderId;
              try {
                const permsRes = await apiClient.getUserPermissions(DEV_USER_ID);
                const writableFolderIds = new Set(
                  (permsRes.data || [])
                    .filter((permission: any) => writableRoles.has(permission.role))
                    .map((permission: any) => permission.folderId),
                );
                const writableFolder = loadedFolders.find((folder) => writableFolderIds.has(folder.folderId));
                if (writableFolder) defaultFolderId = writableFolder.folderId;
              } catch (error) {
                console.error('Failed to load folder permissions:', error);
              }
              if (!cancelled) setSelectedFolderId(defaultFolderId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load folders:', error);
        if (!cancelled) showError('Failed to load folders');
      } finally {
        if (!cancelled) setIsLoadingFolders(false);
      }

      if (!cancelled) await refreshServerDocuments(loadedFolders);
    };
    void loadLibrary();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  useEffect(() => {
    setIsLoadingDocs(true);
    const timer = window.setTimeout(() => setIsLoadingDocs(false), 80);
    return () => window.clearTimeout(timer);
  }, [selectedFolderId]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    previewAbortControllerRef.current?.abort();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const findLibraryDocument = useCallback(
    (documentId: string) => allDocuments.find((document) => document.documentId === documentId),
    [allDocuments],
  );

  const loadPersistedPreview = useCallback(async (
    libraryDocument: MockLibraryDocument,
    requestId: number,
    signal: AbortSignal,
  ) => {
    if (libraryDocument.preview.kind !== 'unavailable' || !libraryDocument.currentVersionId) return;

    const showLoadingPreview = (message: string) => {
      if (previewRequestRef.current !== requestId) return;
      setPreviewDocument({
        ...libraryDocument,
        preview: { kind: 'loading', message },
      });
    };

    showLoadingPreview(`Loading ${libraryDocument.fileName} from secure storage...`);

    let sourceUrl: string | undefined;
    try {
      const { blob, fileName } = await apiClient.getDocumentFile(
        libraryDocument.documentId,
        libraryDocument.currentVersionId,
        signal,
      );
      if (signal.aborted || previewRequestRef.current !== requestId) return;

      const resolvedFileName = fileName || libraryDocument.fileName;
      const contentType = blob.type || libraryDocument.contentType || 'application/octet-stream';

      sourceUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.add(sourceUrl);

      let preview = await createNativePreview(blob, resolvedFileName, contentType, sourceUrl, (url) => objectUrlsRef.current.add(url));
      let fallbackDownload = libraryDocument.fallbackDownload;

      if (!preview) {
        showLoadingPreview(`Converting ${resolvedFileName} locally with Docling...`);
        const parsedDocument = await doclingApi.convertDocument(
          new File([blob], resolvedFileName, { type: contentType }),
          signal,
        );
        preview = { kind: 'markdown', content: parsedDocument.content };
        fallbackDownload = {
          fileName: `${resolvedFileName.replace(/\.[^/.]+$/, '')}.md`,
          content: parsedDocument.content,
        };
      }

      if (signal.aborted || previewRequestRef.current !== requestId) {
        URL.revokeObjectURL(sourceUrl);
        objectUrlsRef.current.delete(sourceUrl);
        return;
      }

      const restoredDocument: MockLibraryDocument = {
        ...libraryDocument,
        fileName: resolvedFileName,
        contentType,
        sourceUrl,
        fallbackDownload,
        preview,
      };
      setAllDocuments((current) => current.map((document) =>
        document.documentId === restoredDocument.documentId ? restoredDocument : document,
      ));
      setPreviewDocument(restoredDocument);
    } catch (error) {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
        objectUrlsRef.current.delete(sourceUrl);
      }
      if (previewRequestRef.current !== requestId) return;

      const message = error instanceof Error ? error.message : 'The stored source could not be loaded';
      console.error('Failed to restore document preview:', error);
      setPreviewDocument({
        ...libraryDocument,
        preview: {
          kind: 'unavailable',
          message: `${message}. Download the read-only source to view it locally.`,
        },
      });
      showError('Document preview could not be loaded');
    }
  }, [showError]);

  const hydrateDocumentPreview = useCallback((libraryDocument: MockLibraryDocument) => {
    previewAbortControllerRef.current?.abort();
    const requestId = ++previewRequestRef.current;
    setPreviewDocument(libraryDocument);

    if (libraryDocument.preview.kind === 'unavailable' && libraryDocument.currentVersionId) {
      const controller = new AbortController();
      previewAbortControllerRef.current = controller;
      void loadPersistedPreview(libraryDocument, requestId, controller.signal);
    } else {
      previewAbortControllerRef.current = null;
    }
  }, [loadPersistedPreview]);

  useEffect(() => {
    if (folders.some((folder) => folder.folderId === selectedFolderId)) return;
    setSelectedFolderId(folders[0]?.folderId ?? '');
  }, [folders, selectedFolderId]);

  useEffect(() => {
    const previewId = searchParams.get('preview');
    if (!previewId) {
      // The `preview` param is gone from the URL — via the browser Back/Forward
      // buttons, or clicking a nav link (e.g. "Document Library" in the sidebar)
      // that navigates to a plain /documents URL. Without this, the full-screen
      // preview overlay stayed open and just kept covering the library, since
      // only the explicit X button used to close it. Closing here does NOT touch
      // selectedFolderId, so you land back on the same folder you were browsing.
      previewAbortControllerRef.current?.abort();
      previewAbortControllerRef.current = null;
      previewRequestRef.current += 1;
      setPreviewDocument(null);
      return;
    }
    const requestedDocument = findLibraryDocument(previewId);
    if (requestedDocument) {
      setSelectedFolderId(requestedDocument.folderId);
      hydrateDocumentPreview(requestedDocument);
      return;
    }

    let cancelled = false;
    const loadApiDocument = async () => {
      try {
        const response = await apiClient.getDocument(previewId);
        if (cancelled || !response.data) throw new Error('Document metadata was not returned');
        const requestedDocument = createUnavailableLibraryDocument(
          response.data,
          'This live document does not expose a browser-safe preview. Download the read-only source to view it locally.',
        );
        hydrateDocumentPreview(requestedDocument);
      } catch {
        if (cancelled) return;
        const placeholder: Document = {
          documentId: previewId,
          folderId: selectedFolderId || folders[0]?.folderId || '',
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
  }, [findLibraryDocument, hydrateDocumentPreview, searchParams]);

  const filteredDocuments = useMemo(() => documents.filter((document) => {
    const query = searchQuery.trim();
    const matchesSearch = !query || matchesDmsMetadata(document, query);
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
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    previewRequestRef.current += 1;
    setPreviewDocument(null);
    clearPreviewParam();
  }, [clearPreviewParam]);

  const handleFolderSelect = (folderId: string) => {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    previewRequestRef.current += 1;
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
    }); // Don't use replace:true so browser back button works correctly
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
        const csv = libraryDocument.preview.sheets
          .map((sheet) => [
            `# Sheet: ${sheet.name}`,
            [sheet.columns, ...sheet.rows]
              .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
              .join('\n'),
          ].join('\n'))
          .join('\n\n');
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

  const requestFolderAction = (action: 'rename' | 'copy' | 'cut' | 'delete' | 'download', folderId: string) => {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set([folderId]));

    if (action === 'download') {
      const folder = folders.find((f) => f.folderId === folderId);
      if (folder) {
        downloadFolderAsZip(folder, allDocuments, folder.name)
          .then(() => {
            showSuccess(`Folder "${folder.name}" downloaded successfully`);
          })
          .catch((error) => {
            showError(error instanceof Error ? error.message : 'Failed to download folder');
          });
      }
      return;
    }

    setRequestedFolderAction(action === 'cut' ? 'move' : action);
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

  const uploadCategoryOptions = [
    { value: 'POLICY', label: 'Policy' },
    { value: 'PROCESS', label: 'Process' },
    { value: 'STANDARD', label: 'Standard' },
    { value: 'TEMPLATE', label: 'Template' },
    { value: 'WORKING_DOCUMENT', label: 'Working Document' },
    { value: 'OTHER', label: 'Other' },
  ];
  const uploadDepartmentOptions = [
    'Quality Assurance',
    'Information Security',
    'Operations',
    'Human Resources',
    'IT',
    'Finance',
    'Management',
    'Other',
  ];
  const uploadIsOtherCategory = uploadCategory === 'OTHER';
  const effectiveUploadCategory = uploadIsOtherCategory ? uploadCustomCategory.trim() : uploadCategory;
  const uploadIsOtherDepartment = uploadDepartment === 'Other';
  const effectiveUploadDepartment = uploadIsOtherDepartment ? uploadCustomDepartment.trim() : uploadDepartment;
  const uploadTagList = uploadTags.split(',').map((t) => t.trim()).filter(Boolean);
  const isUploadFormValid = Boolean(
    uploadDescription.trim()
    && uploadTagList.length > 0
    && uploadCategory
    && (!uploadIsOtherCategory || uploadCustomCategory.trim())
    && uploadOwnerId
    && uploadDepartment
    && (!uploadIsOtherDepartment || uploadCustomDepartment.trim())
  );

  const handleUploadDocument = async (action: 'draft' | 'submit') => {
    if (!selectedFolder) {
      showError('Create or restore a folder before uploading documents');
      return;
    }
    if (uploadFiles.length === 0) {
      showError('Please select at least one file');
      return;
    }
    if (!isUploadFormValid) {
      showError('Please fill in description, tags, category, owner, and department');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ complete: 0, total: uploadFiles.length });
    const uploaded: MockLibraryDocument[] = [];
    const errors: string[] = [];
    const parseErrors: string[] = [];
    const submittedForApproval: Array<{ documentId: string; filename: string; filesize: number; uploadedAt: string }> = [];
    // Capture folder ID early to ensure it's consistent across all uploads in this batch
    const uploadFolderId = selectedFolder.folderId;
    const uploadFolder = selectedFolder;
    // Renaming only applies when uploading a single file — the field is hidden
    // for multi-file uploads since there's no unambiguous target for a single name.
    const trimmedRename = uploadFileName.trim();
    const filesToUpload = uploadFiles.length === 1 && trimmedRename
      ? [(() => {
          const original = uploadFiles[0];
          const finalName = `${trimmedRename}${splitFileName(original.name).ext}`;
          return finalName === original.name ? original : new File([original], finalName, { type: original.type });
        })()]
      : uploadFiles;
    try {
      for (const uploadFile of filesToUpload) {
        try {
          setActiveUploadStage('uploading');
          setActiveUploadFileName(uploadFile.name);
          const docRes = await apiClient.createDocument({
            folderId: uploadFolderId,
            title: uploadFile.name.replace(/\.[^/.]+$/, ''),
            ownerId: uploadOwnerId,
            description: uploadDescription.trim(),
            tags: uploadTagList,
            department: effectiveUploadDepartment,
            originalDocumentId: canSetDocIdOnUpload && uploadOriginalDocumentId.trim() ? uploadOriginalDocumentId.trim() : undefined,
          });
          const createdDocument = docRes.data;
          if (!createdDocument?.documentId) throw new Error('The server did not return a document ID');

          const uploadRes = await apiClient.uploadDocument(createdDocument.documentId, uploadFile);
          setActiveUploadStage('parsing');
          let parsedContent: string | undefined;
          try {
            const parsedDocument = await doclingApi.uploadDocument(uploadFile);
            parsedContent = parsedDocument.content;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Local parsing failed';
            parseErrors.push(`${uploadFile.name}: ${message}`);
          }

          // Auto-extraction (Requirement 2): scan the file's own parsed text for a
          // "Doc ID"/"Doc No" label. Only attempted when QA/Admin didn't already set
          // one directly in the upload form above.
          if (parsedContent && (!canSetDocIdOnUpload || !uploadOriginalDocumentId.trim())) {
            void apiClient.extractDocId(createdDocument.documentId, parsedContent).catch(() => {});
          }

          const sourceUrl = URL.createObjectURL(uploadFile);
          objectUrlsRef.current.add(sourceUrl);
          const timestamp = new Date().toISOString();
          const source: Document = {
            documentId: createdDocument.documentId,
            currentVersionId: uploadRes.data?.versionId,
            folderId: uploadFolderId,
            folder: uploadFolder,
            name: uploadFile.name.replace(/\.[^/.]+$/, ''),
            fileName: uploadFile.name,
            fileSize: uploadFile.size,
            contentType: uploadFile.type || 'application/octet-stream',
            status: createdDocument.status ?? 'draft',
            department: effectiveUploadDepartment,
            description: uploadDescription.trim(),
            tags: uploadTagList,
            owner: allUsers.find((u) => u.userId === uploadOwnerId) ?? currentUser ?? undefined,
            uploadedBy: uploadOwnerId,
            uploadedAt: timestamp,
            createdAt: createdDocument.createdAt || timestamp,
            updatedAt: timestamp,
            modifiedAt: timestamp,
          };
          const uploadedDocument = createUnavailableLibraryDocument(
            source,
            'A browser preview is not available for this newly uploaded file. Download the read-only source to view it locally.',
          );
          uploadedDocument.sourceUrl = sourceUrl;
          const nativePreview = await createNativePreview(
            uploadFile,
            uploadFile.name,
            uploadFile.type || 'application/octet-stream',
            sourceUrl,
            (url) => objectUrlsRef.current.add(url),
          );
          if (nativePreview?.kind === 'image') {
            uploadedDocument.preview = nativePreview;
            if (parsedContent) {
              uploadedDocument.fallbackDownload = {
                fileName: `${uploadFile.name.replace(/\.[^/.]+$/, '')}.md`,
                content: parsedContent,
              };
            }
          } else if (parsedContent) {
            uploadedDocument.preview = { kind: 'markdown', content: parsedContent };
            uploadedDocument.fallbackDownload = {
              fileName: `${uploadFile.name.replace(/\.[^/.]+$/, '')}.md`,
              content: parsedContent,
            };
          } else if (nativePreview) {
            uploadedDocument.preview = nativePreview;
          }
          uploaded.push(uploadedDocument);
          submittedForApproval.push({
            documentId: createdDocument.documentId,
            filename: uploadFile.name,
            filesize: uploadFile.size,
            uploadedAt: createdDocument.createdAt || timestamp,
          });
        } catch (error: any) {
          const errorMsg = error?.response?.data?.error || error?.message || `${uploadFile.name} could not be uploaded`;
          errors.push(errorMsg);
        } finally {
          setUploadProgress((current) => ({ ...current, complete: current.complete + 1 }));
        }
      }
      if (uploaded.length > 0) setAllDocuments((current) => [...current, ...uploaded]);

      if (errors.length === 0 && action === 'submit' && submittedForApproval.length > 0) {
        try {
          await apiClient.submitDocumentsForApproval(
            submittedForApproval.map((f) => f.documentId),
            effectiveUploadCategory,
            uploadApprovalNotes.trim() || undefined,
          );
          showSuccess(`${uploaded.length} ${uploaded.length === 1 ? 'document' : 'documents'} uploaded and submitted for approval`);
        } catch (err: any) {
          showError(err.response?.data?.error || 'Uploaded, but failed to submit for approval');
        }
      } else if (errors.length > 0) {
        showError(`${uploaded.length} uploaded; ${errors.length} failed — ${errors[0]}`);
      } else if (parseErrors.length > 0) {
        showError(`${uploaded.length} uploaded; ${parseErrors.length} could not be parsed locally`);
      } else {
        showSuccess(`${uploaded.length} ${uploaded.length === 1 ? 'document' : 'documents'} saved as draft`);
      }

      if (errors.length === 0) {
        setShowUploadModal(false);
        setUploadFiles([]);
        setUploadTags('');
        setUploadCategory('');
        setUploadCustomCategory('');
        setUploadDepartment('');
        setUploadCustomDepartment('');
        setUploadApprovalNotes('');
        setUploadOriginalDocumentId('');
        void refreshServerDocuments(folders);
      }
    } finally {
      setIsUploading(false);
      setActiveUploadFileName('');
      setActiveUploadStage('uploading');
    }
  };

  const stageFiles = (files: File[], targetFolder = selectedFolder) => {
    if (files.length === 0) return;
    if (!targetFolder) {
      showError('Create or restore a folder before uploading documents');
      return;
    }
    setSelectedFolderId(targetFolder.folderId);
    setUploadFiles(files);
    setUploadFileName(files.length === 1 ? splitFileName(files[0].name).base : '');
    setUploadProgress({ complete: 0, total: files.length });
    setUploadOwnerId(DEV_USER_ID);
    setShowUploadModal(true);
  };

  const handleLoadSampleFiles = async () => {
    setIsLoadingSamples(true);
    try {
      const response = await apiClient.createFolder({
        name: MOCK_FILES_FOLDER_NAME,
        description: MOCK_FILES_FOLDER_DESCRIPTION,
        classification: 'standard',
        ownerId: DEV_USER_ID,
        reuseExisting: true,
      });
      if (!response.data?.folderId) throw new Error('The server did not return a folder ID');

      const createdAt = response.data.createdAt || new Date().toISOString();
      const mockFilesFolder: Folder = {
        folderId: response.data.folderId,
        name: response.data.name || MOCK_FILES_FOLDER_NAME,
        description: response.data.description || MOCK_FILES_FOLDER_DESCRIPTION,
        ownerId: response.data.ownerId || DEV_USER_ID,
        createdAt,
        updatedAt: response.data.updatedAt || createdAt,
        isArchived: false,
      };
      setFolders((current) => {
        const existingIndex = current.findIndex((folder) => folder.folderId === mockFilesFolder.folderId);
        if (existingIndex === -1) return [...current, mockFilesFolder];
        return current.map((folder, index) => index === existingIndex ? { ...folder, ...mockFilesFolder } : folder);
      });

      const files = await loadSampleDocumentFiles();
      stageFiles(files, mockFilesFolder);
      showSuccess(`${files.length} sample files are ready to upload`);
    } catch (error) {
      console.error('Failed to load sample files:', error);
      showError('Sample files could not be loaded');
    } finally {
      setIsLoadingSamples(false);
    }
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadDescription('');
    setUploadFileName('');
    setUploadTags('');
    setUploadCategory('');
    setUploadCustomCategory('');
    setUploadDepartment('');
    setUploadCustomDepartment('');
    setUploadApprovalNotes('');
    setUploadOriginalDocumentId('');
  };

  return (
    <div className="flex h-[calc(100vh-64px)] min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-950 md:flex-row">
      {/* Folders Sidebar */}
      {isLoadingFolders ? (
        <div className="max-h-56 w-full flex-shrink-0 space-y-2 overflow-hidden border-b border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900 md:max-h-none md:w-56 md:border-b-0 md:border-r" role="status" aria-label="Loading folders">
          {[1, 2].map((item) => <div key={item} className="h-12 animate-skeleton rounded bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : folders.length === 0 ? (
        <div className="w-full flex-shrink-0 border-b border-[#dbe2ec] bg-white p-5 text-center dark:border-white/10 dark:bg-slate-900 md:w-56 md:border-b-0 md:border-r"><p className="text-sm">No folders available</p></div>
      ) : (
        <FolderTree
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleFolderSelect}
          onFolderAction={requestFolderAction}
        />
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header with Title and Upload Button */}
        <div className="flex flex-col items-stretch gap-3 border-b border-[#dbe2ec] bg-white px-4 py-4 dark:border-white/10 dark:bg-slate-900 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h1 className="page-heading">Document Library</h1>
            <p className="page-subtitle">Secure vault · Documents are view-only by default</p>
          </div>
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
          <div className="flex w-full flex-col gap-2 sm:ml-6 sm:w-auto sm:flex-row">
            <button
              type="button"
              aria-label={isLoadingSamples ? 'Loading sample files' : 'Load sample files'}
              aria-busy={isLoadingSamples}
              disabled={isLoadingFolders || isLoadingSamples}
              title="Create or reuse Mock Files and load TXT, Word, Excel, PowerPoint, PDF, and image samples"
              onClick={() => void handleLoadSampleFiles()}
              className="inline-flex h-9 w-full flex-shrink-0 items-center justify-center gap-2 rounded-[4px] border border-[#b7c4d6] bg-white px-3 text-sm font-medium text-[#34425b] hover:bg-[#f0f4f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:border-white/15 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 sm:w-auto"
            >
              {isLoadingSamples ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <Files className="h-4 w-4" />}
              <span aria-live="polite">{isLoadingSamples ? 'Loading samples...' : 'Sample files'}</span>
            </button>
            <button
              type="button"
              aria-label="Upload files"
              disabled={!selectedFolder}
              title={selectedFolder ? 'Upload files to the selected folder' : 'A folder is required before uploading'}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 w-full flex-shrink-0 items-center justify-center gap-2 rounded-[4px] bg-[#3f8bca] px-3 text-sm font-medium text-white hover:bg-[#2f6f9f] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] sm:w-auto sm:px-4"
            >
              <UploadCloud className="h-4 w-4" /> Upload
            </button>
          </div>
        </div>

        {/* Documents Table and Filters */}
        <div className="flex-1 overflow-y-auto">
          <Card className="m-3 min-w-0 overflow-hidden sm:m-4">
            <div className="flex flex-col gap-3 border-b border-[#e2e8f0] p-3 dark:border-white/10 sm:flex-row sm:items-center">
              <input type="text" placeholder="Search name, extension, owner, tags..." title="Searches file name, extension, folder, department, owner, tags, description, tracking code, and status" className="field-control h-9 w-full sm:max-w-[230px]" aria-label="Search documents" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <select className="field-control h-9 w-full sm:w-[150px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter documents by status">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">In Review</option>
                <option value="released">Released</option>
                <option value="rejected">Rejected</option>
                <option value="archived">Archived</option>
              </select>
              <div className="flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">
                <LibraryBulkActions
                  selectedCount={selectedItemCount}
                  selectedNames={selectedNames}
                  canRename={selectedItemCount === 1}
                  renameCurrentName={renameDocument?.fileName ?? renameFolder?.name}
                  renameIsFile={Boolean(renameDocument)}
                  folders={folders}
                  disabledDestinationIds={getInvalidDestinationIds(folders, selectedFolderIds)}
                  containsNonEmptyFolder={selectionContainsNonEmptyFolder({ folders, documents: allDocuments }, librarySelection)}
                  requestedAction={requestedFolderAction}
                  onRequestedActionHandled={() => setRequestedFolderAction(null)}
                  onRequestedActionDismissed={() => setSelectedFolderIds(new Set())}
                  onConfirm={handleBulkAction}
                />
                {selectedServerDocuments.length > 0 && (
                  <Button variant="secondary" onClick={() => setShowBulkOperationsModal(true)}>
                    Bulk Actions ({selectedServerDocuments.length})
                  </Button>
                )}
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
      </div>

      {previewDocument && (
        <DocumentPreview
          document={previewDocument}
          onClose={closePreview}
          onDownload={downloadMockDocument}
          onSubmitForApproval={(doc) => {
            closePreview();
            setPendingApprovalFiles([
              { documentId: doc.documentId, filename: doc.fileName, filesize: doc.fileSize, uploadedAt: doc.createdAt },
            ]);
            setShowApprovalPrompt(true);
          }}
        />
      )}

      {showBulkOperationsModal && (
        <BulkOperationsModal
          selectedDocuments={selectedServerDocuments}
          onClose={() => setShowBulkOperationsModal(false)}
          onSuccess={() => {
            setSelectedDocumentIds(new Set());
            void refreshServerDocuments(folders);
          }}
        />
      )}

      {showApprovalPrompt && (
        <UploadApprovalModal
          isOpen={showApprovalPrompt}
          files={pendingApprovalFiles}
          onSubmit={() => {
            setShowApprovalPrompt(false);
            setPendingApprovalFiles([]);
            void refreshServerDocuments(folders);
          }}
          onCancel={() => {
            setShowApprovalPrompt(false);
            setPendingApprovalFiles([]);
          }}
        />
      )}

      <Dialog.Root open={showUploadModal} onOpenChange={(open) => open ? setShowUploadModal(true) : closeUploadModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
          <Dialog.Content asChild>
            <Card className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-lg max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 shadow-xl">
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
              {uploadFiles.length === 1 && (
                <div className="space-y-2">
                  <label htmlFor="upload-file-name" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    File name
                  </label>
                  <div className="flex items-center overflow-hidden rounded-[4px] border border-[#dbe2ec] bg-white focus-within:border-[#3f8bca] focus-within:ring-2 focus-within:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900">
                    <input
                      id="upload-file-name"
                      type="text"
                      value={uploadFileName}
                      onChange={(e) => setUploadFileName(e.target.value)}
                      disabled={isUploading}
                      placeholder={splitFileName(uploadFiles[0].name).base}
                      className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-[#26334d] outline-none placeholder-[#8ea0ba] dark:text-white dark:placeholder-slate-500"
                    />
                    {splitFileName(uploadFiles[0].name).ext && (
                      <span className="flex-shrink-0 whitespace-nowrap pr-3 text-sm text-[#718198] dark:text-slate-400">{splitFileName(uploadFiles[0].name).ext}</span>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="upload-description" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="upload-description"
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="Describe the purpose and content of these documents..."
                  disabled={isUploading}
                  className="field-control min-h-[80px] w-full resize-none rounded-[4px] border border-[#dbe2ec] bg-white p-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="upload-tags" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                  Tags <span className="text-red-500">*</span>
                </label>
                <input
                  id="upload-tags"
                  type="text"
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="e.g. iso9001, quality, procedure"
                  disabled={isUploading}
                  className="field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                />
                <p className="text-xs text-[#718198]">Comma-separated.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="upload-category" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Document Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="upload-category"
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    disabled={isUploading}
                    className="field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select a category...</option>
                    {uploadCategoryOptions.map((cat) => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                  {uploadIsOtherCategory && (
                    <input
                      type="text"
                      value={uploadCustomCategory}
                      onChange={(e) => setUploadCustomCategory(e.target.value)}
                      placeholder="Specify the category..."
                      autoFocus
                      disabled={isUploading}
                      className="mt-2 field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="upload-department" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Department <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="upload-department"
                    value={uploadDepartment}
                    onChange={(e) => setUploadDepartment(e.target.value)}
                    disabled={isUploading}
                    className="field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="">Select a department...</option>
                    {uploadDepartmentOptions.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                  {uploadIsOtherDepartment && (
                    <input
                      type="text"
                      value={uploadCustomDepartment}
                      onChange={(e) => setUploadCustomDepartment(e.target.value)}
                      placeholder="Specify the department..."
                      autoFocus
                      disabled={isUploading}
                      className="mt-2 field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="upload-owner" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                  Owner <span className="text-red-500">*</span>
                </label>
                <select
                  id="upload-owner"
                  value={uploadOwnerId}
                  onChange={(e) => setUploadOwnerId(e.target.value)}
                  disabled={isUploading}
                  className="field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                >
                  {allUsers.length === 0 && <option value={uploadOwnerId}>Loading users...</option>}
                  {allUsers.map((u) => (
                    <option key={u.userId} value={u.userId}>{u.fullName}</option>
                  ))}
                </select>
              </div>

              {/* Document ID: completely hidden for standard users. Only QA/Admin on the
                  target folder can see or set it directly — everyone else's uploads are
                  scanned automatically for a "Doc ID"/"Doc No" label instead. */}
              {canSetDocIdOnUpload && (
                <div className="space-y-2">
                  <label htmlFor="upload-doc-id" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Document ID <span className="text-xs font-normal text-[#718198]">(System Admin only — leave blank to auto-detect)</span>
                  </label>
                  <input
                    id="upload-doc-id"
                    type="text"
                    value={uploadOriginalDocumentId}
                    onChange={(e) => setUploadOriginalDocumentId(e.target.value)}
                    placeholder="e.g. QM-2026-0007"
                    disabled={isUploading}
                    className="field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="upload-approval-notes" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                  Approval Notes (Optional)
                </label>
                <textarea
                  id="upload-approval-notes"
                  value={uploadApprovalNotes}
                  onChange={(e) => setUploadApprovalNotes(e.target.value)}
                  placeholder="Add any notes for the approver..."
                  disabled={isUploading}
                  className="field-control min-h-[60px] w-full resize-none rounded-[4px] border border-[#dbe2ec] bg-white p-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                />
              </div>

              <p className="text-xs text-[#718198]">{selectedFolder ? `Uploading to ${selectedFolder.name}. New documents remain view-only while entering review.` : 'A folder is required before uploading documents.'}</p>
              {isUploading && (
                <div role="status" aria-label={activeUploadStage === 'parsing' ? 'Converting document with Docling' : 'Upload progress'} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-xs text-[#52627a]">
                    <span className="flex min-w-0 items-center gap-2">
                      {activeUploadStage === 'parsing' && <LoaderCircle className="h-6 w-6 flex-shrink-0 animate-spin text-[#3f8bca]" />}
                      <span className="truncate">{activeUploadStage === 'parsing' ? `Converting ${activeUploadFileName} locally with Docling` : `Uploading ${activeUploadFileName}`}</span>
                    </span>
                    <span>{uploadProgress.complete} / {uploadProgress.total}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#3f8bca] transition-all" style={{ width: `${uploadProgress.total ? (uploadProgress.complete / uploadProgress.total) * 100 : 0}%` }} /></div>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={closeUploadModal} disabled={isUploading} className="flex-1">Cancel</Button>
                <Button
                  variant="secondary"
                  onClick={() => handleUploadDocument('draft')}
                  disabled={uploadFiles.length === 0 || !isUploadFormValid || isUploading}
                  title={!isUploadFormValid ? 'Please fill in description, tags, category, owner, and department' : ''}
                  className="flex-1"
                >
                  {isUploading ? (activeUploadStage === 'parsing' ? 'Converting...' : 'Saving...') : 'Save as Draft'}
                </Button>
                <Button
                  onClick={() => handleUploadDocument('submit')}
                  disabled={uploadFiles.length === 0 || !isUploadFormValid || isUploading}
                  title={!isUploadFormValid ? 'Please fill in description, tags, category, owner, and department' : ''}
                  className="flex-1"
                >
                  {isUploading ? (activeUploadStage === 'parsing' ? 'Converting...' : 'Uploading...') : 'Submit'}
                </Button>
              </div>
            </CardBody>
            </Card>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
