import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ChevronRight, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { FolderTree } from '../custom/FolderTree';
import { defaultVisibleDocumentColumns, DocumentList, type LibraryFolderRow, type OptionalDocumentColumn } from '../custom/DocumentList';
import { matchesDmsMetadata } from '../../utils/dmsMetadataSearch';
import { ColumnVisibilityMenu, LibraryBulkActions, TagFilterMenu, type LibraryBulkAction } from '../custom/LibraryMenus';
import { SkeletonTable } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { apiClient, DEV_USER_ID, type RolePermissionFlags } from '../../utils/api';
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
import { downloadFolderAsZip } from '../../utils/folderDownload';
import { buildFolderAncestryPath } from '../../utils/folderPath';
import { ModalOverlay, preventModalOutsideDismiss } from '../ui/ModalOverlay';

const DocumentPreview = lazy(() => import('../custom/DocumentPreview').then((module) => ({ default: module.DocumentPreview })));
const AccessOverrideModal = lazy(() => import('../custom/AccessOverrideModal').then((module) => ({ default: module.AccessOverrideModal })));
const BulkOperationsModal = lazy(() => import('../custom/BulkOperationsModal').then((module) => ({ default: module.BulkOperationsModal })));
const UploadApprovalModal = lazy(() => import('../custom/UploadApprovalModal').then((module) => ({ default: module.UploadApprovalModal })));
const EditDocumentModal = lazy(() => import('../custom/EditDocumentModal').then((module) => ({ default: module.EditDocumentModal })));
const EditFolderModal = lazy(() => import('../custom/EditFolderModal').then((module) => ({ default: module.EditFolderModal })));

function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The document text could not be read'));
    reader.readAsText(blob);
  });
}

// allDocuments carries the *resolved* stage-specific status (see
// resolveLibraryStatus) by the time it reaches this component, not the raw
// "pending_approval" the API returns — so "still pending review" means any of
// these four in-pipeline stages, not a literal status === 'pending_approval'
// check (which would never match anything post-resolution).
const PENDING_STAGE_STATUSES = new Set(['qa_review', 'manager_review', 'correction_in_progress', 'qa_final_review']);
const TEXT_PREVIEW_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'xml', 'log']);
const IMAGE_PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const WORD_PDF_PREVIEW_EXTENSIONS = new Set(['doc', 'docx', 'docm']);
const PRESENTATION_PDF_PREVIEW_EXTENSIONS = new Set([
  'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'pps', 'ppsx', 'ppsm', 'ppam',
]);
const SPREADSHEET_PDF_PREVIEW_EXTENSIONS = new Set(['xls', 'xlsm', 'xlsb', 'xlt', 'xltm']);
const SPREADSHEET_GRID_PREVIEW_EXTENSIONS = new Set(['xlsx', 'xltx', 'ods']);
const WORD_PDF_PREVIEW_CONTENT_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const PRESENTATION_PDF_PREVIEW_CONTENT_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-powerpoint.addin.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
]);
const SPREADSHEET_PDF_PREVIEW_CONTENT_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
]);

function getFileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

// The folder panel used to be a fixed 14rem, which left long folder names
// permanently truncated with no way to widen them. The width is now user-draggable
// (and remembered), clamped so the panel can never be dragged away entirely or
// pushed wide enough to squeeze the document table out of view.
const FOLDER_PANE_MIN_WIDTH = 168;
const FOLDER_PANE_MAX_WIDTH = 560;
const FOLDER_PANE_DEFAULT_WIDTH = 224;
const FOLDER_PANE_WIDTH_STORAGE_KEY = 'dms.documentLibrary.folderPaneWidth';

function clampFolderPaneWidth(value: number): number {
  if (!Number.isFinite(value)) return FOLDER_PANE_DEFAULT_WIDTH;
  return Math.min(FOLDER_PANE_MAX_WIDTH, Math.max(FOLDER_PANE_MIN_WIDTH, Math.round(value)));
}

function readStoredFolderPaneWidth(): number {
  try {
    const stored = window.localStorage.getItem(FOLDER_PANE_WIDTH_STORAGE_KEY);
    return stored ? clampFolderPaneWidth(Number(stored)) : FOLDER_PANE_DEFAULT_WIDTH;
  } catch {
    // Private-mode / storage-disabled browsers just get the default width.
    return FOLDER_PANE_DEFAULT_WIDTH;
  }
}

// React Router unmounts Documents.tsx entirely when navigating away to another
// page (Reminders, Dashboard, ...) — clicking back into Document Library (via
// the sidebar link or the browser's own Back button) remounts it from scratch,
// which used to always recompute "the first folder you can write to" as the
// starting point, silently discarding whatever folder you'd actually
// navigated deep into. Persisting the last-browsed folder id lets a fresh
// mount resume exactly where you left off instead.
const LAST_FOLDER_STORAGE_KEY = 'dms.documentLibrary.lastFolderId';

function readStoredLastFolderId(): string | null {
  try {
    return window.localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLastFolderId(folderId: string) {
  try {
    window.localStorage.setItem(LAST_FOLDER_STORAGE_KEY, folderId);
  } catch {
    // Private-mode / storage-disabled browsers just won't resume position —
    // not worth failing anything over.
  }
}

// Same idea as the folder position above, one level deeper: if a document was
// open when the user got navigated away (accidentally clicking a different
// sidebar link, or anything else that unmounts this page), coming back should
// reopen that same document, not just land back on the right folder. Cleared
// whenever the preview is closed for a real reason (the X button, or picking
// a different folder/document) so it never reopens something the user
// actually finished with.
const LAST_PREVIEW_STORAGE_KEY = 'dms.documentLibrary.lastPreviewId';

function readStoredLastPreviewId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PREVIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLastPreviewId(documentId: string | null) {
  try {
    if (documentId) window.localStorage.setItem(LAST_PREVIEW_STORAGE_KEY, documentId);
    else window.localStorage.removeItem(LAST_PREVIEW_STORAGE_KEY);
  } catch {
    // Same private-mode fallback as above — resuming the preview is a nicety.
  }
}

function usesGeneratedPdfPreview(fileName: string, contentType = ''): boolean {
  const extension = getFileExtension(fileName);
  const normalizedContentType = contentType.toLowerCase().split(';', 1)[0].trim();
  return WORD_PDF_PREVIEW_EXTENSIONS.has(extension)
    || PRESENTATION_PDF_PREVIEW_EXTENSIONS.has(extension)
    || SPREADSHEET_PDF_PREVIEW_EXTENSIONS.has(extension)
    || WORD_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType)
    || PRESENTATION_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType)
    || SPREADSHEET_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType);
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
  // CSV is tabular data, not free text — route it through the same sheet parser
  // as .xlsx so it gets the spreadsheet table/sheet-tab UI instead of a raw
  // comma-separated dump in a monospace <pre>.
  if (extension === 'csv' || contentType === 'text/csv') {
    const { parseExcelDocument } = await import('../../utils/officeParser');
    return parseExcelDocument(source, sourceUrl);
  }
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
  const normalizedContentType = contentType.toLowerCase().split(';', 1)[0].trim();
  const isWord = WORD_PDF_PREVIEW_EXTENSIONS.has(extension)
    || WORD_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType);
  const isPowerPoint = PRESENTATION_PDF_PREVIEW_EXTENSIONS.has(extension)
    || PRESENTATION_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType);
  const isLegacySpreadsheet = SPREADSHEET_PDF_PREVIEW_EXTENSIONS.has(extension)
    || SPREADSHEET_PDF_PREVIEW_CONTENT_TYPES.has(normalizedContentType);
  if (isWord || isPowerPoint || isLegacySpreadsheet) {
    // Real Office rendering: convert to PDF locally (LibreOffice, via the
    // OCR sidecar) and reuse the same pdf.js viewer already used for real PDFs —
    // true layout/fonts/images/tables instead of a plain-text reconstruction.
    // Health-check the sidecar up front instead of always attempting the network
    // call: a down/unreachable sidecar used to mean a multi-second hang before
    // silently degrading to text extraction with no explanation to the user.
    const sidecarAvailable = await doclingApi.isAvailable();
    let renderNotice: string | undefined;
    if (sidecarAvailable) {
      try {
        const pdfBlob = await doclingApi.convertToPdf(source, fileName);
        const pdfUrl = URL.createObjectURL(pdfBlob);
        registerObjectUrl?.(pdfUrl);
        return { kind: 'pdf', url: pdfUrl };
      } catch (error) {
        console.error(`Failed to render ${fileName} as PDF, falling back to text extraction:`, error);
        renderNotice = 'Live rendering failed — showing extracted text only.';
      }
    } else {
      console.warn(`Local document renderer is unreachable; falling back to text extraction for ${fileName}`);
      renderNotice = 'Live rendering is unavailable right now — showing extracted text only.';
    }
    const { parseWordDocument, parseExcelDocument, parsePowerPointDocument } = await import('../../utils/officeParser');
    const fallback = isWord
      ? await parseWordDocument(source, sourceUrl)
      : isPowerPoint
        ? await parsePowerPointDocument(source, sourceUrl)
        : await parseExcelDocument(source, sourceUrl);
    if (fallback && (fallback.kind === 'word' || fallback.kind === 'presentation')) {
      return { ...fallback, renderNotice };
    }
    return fallback;
  }
  if (SPREADSHEET_GRID_PREVIEW_EXTENSIONS.has(extension)
    || normalizedContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || normalizedContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'
    || normalizedContentType === 'application/vnd.oasis.opendocument.spreadsheet') {
    const { parseExcelDocument } = await import('../../utils/officeParser');
    return parseExcelDocument(source, sourceUrl);
  }
  return null;
}

export function Documents() {
  const { showSuccess, showError } = useToast();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const directPreviewId = searchParams.get('preview');
  // Warms the pdf.js chunk (~373 KB, the single largest lazy-loaded bundle in
  // the app) as early as possible on a deep-link preview. DocumentPreview only
  // renders <PdfJsViewer> — and therefore only triggers its own dynamic
  // import — once the document's metadata has resolved and several other
  // effects (folders, permissions, dropdown lists) have already committed;
  // measured live via Lighthouse, that gap alone pushed the chunk's request
  // out by ~850ms of otherwise-idle network time, directly inflating LCP.
  // Every previewable kind other than plain text/images routes through this
  // same viewer (native PDFs and every Office format, converted server-side),
  // so prefetching it unconditionally here is a safe bet — worst case for a
  // text/image preview, one extra ~373 KB request the user never needed.
  useEffect(() => {
    if (!directPreviewId) return;
    void import('../custom/PdfJsViewer');
  }, [directPreviewId]);
  // If a document was open when the user got navigated away to another page
  // entirely (this component fully unmounts, losing all its state), resume it
  // on remount by seeding the same `?preview=` param a real deep link would
  // use — the existing effect further down that watches this param already
  // knows how to hydrate a preview from it, so this only has to run once,
  // before that effect's very first check, and only when the URL didn't
  // already ask for something specific on its own.
  useEffect(() => {
    if (searchParams.get('preview')) return;
    const storedPreviewId = readStoredLastPreviewId();
    if (!storedPreviewId) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('preview', storedPreviewId);
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allDocuments, setAllDocuments] = useState(() => mockLibraryDocuments.map((document) => ({ ...document, tags: [...document.tags] })));
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [activeUploadStage, setActiveUploadStage] = useState<'uploading' | 'parsing'>('uploading');
  const [activeUploadFileName, setActiveUploadFileName] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [uploadCustomTags, setUploadCustomTags] = useState('');
  const [uploadVersionLabel, setUploadVersionLabel] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadCustomCategory, setUploadCustomCategory] = useState('');
  const [uploadOwnerId, setUploadOwnerId] = useState(DEV_USER_ID);
  const [uploadDepartment, setUploadDepartment] = useState('');
  const [uploadCustomDepartment, setUploadCustomDepartment] = useState('');
  const [uploadApprovalNotes, setUploadApprovalNotes] = useState('');
  const [uploadValidationAttempted, setUploadValidationAttempted] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [myPermissions, setMyPermissions] = useState<RolePermissionFlags | null>(null);
  const [editDocumentId, setEditDocumentId] = useState<string | null>(null);
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  // Admin-managed via the Company Data page — fetched once, refreshed if the
  // upload modal is reopened so a just-added item shows up without a reload.
  const [dropdownOptions, setDropdownOptions] = useState<{ department: string[]; category: string[]; tag: string[] }>({ department: [], category: [], tag: [] });
  // Permissions for folders OTHER than the one currently being browsed (e.g.
  // a subfolder shown in the sidebar tree) — fetched lazily the first time
  // that folder's own action menu is opened, since the tree can show many
  // folders whose overrides differ from the currently-viewed one.
  const [otherFolderPermissions, setOtherFolderPermissions] = useState<Record<string, RolePermissionFlags | null>>({});
  const loadingFolderPermissionIds = useRef<Set<string>>(new Set());
  const [accessOverrideTarget, setAccessOverrideTarget] = useState<{
    scope: { folderId?: string; documentId?: string };
    resourceName: string;
    resourceKind: 'file' | 'folder';
    ownerName?: string;
    managerIds?: string[];
  } | null>(null);
  const [newFolderRequest, setNewFolderRequest] = useState<{ parentFolderId: string | null; name: string } | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ complete: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [folderPaneWidth, setFolderPaneWidth] = useState(readStoredFolderPaneWidth);
  const [isResizingFolderPane, setIsResizingFolderPane] = useState(false);
  const folderPaneResizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const [previewDocument, setPreviewDocument] = useState<MockLibraryDocument | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [requestedFolderAction, setRequestedFolderAction] = useState<LibraryBulkAction | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<OptionalDocumentColumn>>(() => new Set(defaultVisibleDocumentColumns));
  const [showBulkOperationsModal, setShowBulkOperationsModal] = useState(false);
  const [pendingApprovalFiles, setPendingApprovalFiles] = useState<
    Array<{ documentId: string; filename: string; filesize: number; uploadedAt: string }>
  >([]);
  const [pendingApprovalCategory, setPendingApprovalCategory] = useState('');
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const previewRequestRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const startedWithDirectPreviewRef = useRef(Boolean(directPreviewId));
  const serverDocumentsLoadStartedRef = useRef(false);
  // Bounds how many documents' preview blob URLs (source file + any locally
  // converted PDF) stay alive at once. Without this, browsing many documents in
  // one session accumulated unbounded live blob URLs since they were previously
  // only revoked on full page unmount.
  const PREVIEW_CACHE_LIMIT = 6;
  const documentObjectUrlsRef = useRef<Map<string, string[]>>(new Map());
  const previewCacheOrderRef = useRef<string[]>([]);

  const touchPreviewCache = useCallback((documentId: string) => {
    const order = previewCacheOrderRef.current;
    const existingIndex = order.indexOf(documentId);
    if (existingIndex !== -1) order.splice(existingIndex, 1);
    order.push(documentId);

    while (order.length > PREVIEW_CACHE_LIMIT) {
      const evictedId = order.shift();
      if (!evictedId) break;
      const urls = documentObjectUrlsRef.current.get(evictedId);
      if (urls) {
        urls.forEach((url) => {
          URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(url);
        });
        documentObjectUrlsRef.current.delete(evictedId);
      }
      setAllDocuments((current) => current.map((doc) => (
        doc.documentId === evictedId && doc.preview.kind !== 'unavailable'
          ? {
            ...doc,
            sourceUrl: undefined,
            preview: { kind: 'unavailable', message: 'This preview was released to free up memory. Reopen the document to reload it.' },
          }
          : doc
      )));
    }
  }, []);

  // "My Submitted Documents" (Dashboard's "View all") shows every document the
  // current user submitted, regardless of which folder it lives in — the
  // normal per-folder scoping below doesn't apply while this is active, but
  // everything else (preview, details, search, columns) is the same
  // DocumentList/DocumentPreview used everywhere else in the library.
  const showOnlyMySubmissions = searchParams.get('mine') === '1';
  const documents = useMemo(() => {
    if (showOnlyMySubmissions) {
      return allDocuments.filter((document) => document.uploadedBy === currentUser?.userId && PENDING_STAGE_STATUSES.has(document.status));
    }
    // A search should find a matching document anywhere the user has access to,
    // not just the folder currently being browsed — the same "search this page
    // only" gap just fixed on the Users admin table. filteredDocuments (below)
    // still applies the actual text match; this just widens the candidate set
    // whenever there's something to search for.
    if (searchQuery.trim()) return allDocuments;
    return allDocuments.filter((document) => document.folderId === selectedFolderId);
  }, [allDocuments, selectedFolderId, showOnlyMySubmissions, currentUser?.userId, searchQuery]);
  const selectedFolder = folders.find((folder) => folder.folderId === selectedFolderId) ?? folders[0];
  // Full ancestor chain (root-first) of the folder being browsed, so the header
  // can show a clickable location path instead of just the current folder's own
  // name.
  const folderPath = useMemo(
    () => (selectedFolder ? buildFolderAncestryPath(selectedFolder, folders) : []),
    [selectedFolder, folders],
  );
  // Folders "in view" independent of the Tag/Department/Owner filters
  // themselves — used both to build the filter dropdowns' own option lists
  // (so picking a tag doesn't shrink the set of tags offered) and as the
  // base candidate set childFolderRows then narrows further.
  const foldersInView = useMemo(() => {
    if (showOnlyMySubmissions) return [];
    const query = searchQuery.trim().toLowerCase();
    const candidates = query ? folders : folders.filter((folder) => folder.parentFolderId === selectedFolderId);
    return candidates.filter((folder) => !query || folder.name.toLowerCase().includes(query));
  }, [folders, selectedFolderId, showOnlyMySubmissions, searchQuery]);

  // Subfolders of the folder being browsed, shown as rows above the files so a
  // folder containing only subfolders is no longer a dead end reading "No
  // documents in this folder". Hidden in the cross-folder "my submissions" view,
  // which deliberately isn't scoped to one folder. While searching, this widens
  // the same way `documents` above does — every folder in the library whose name
  // matches, not just the current folder's own children — each carrying a
  // `pathLabel` so a match found three levels away from wherever you happen to
  // be browsing still tells you exactly where it lives.
  const childFolderRows = useMemo<LibraryFolderRow[]>(() => {
    // Status is document-workflow state, which a folder has none of — a
    // status filter always hides every folder row. Tags/Department/Owner
    // are now real folder metadata too (see EditFolderModal), so those
    // filter folders by their own values instead of hiding them outright.
    if (statusFilter) return [];
    const query = searchQuery.trim().toLowerCase();
    return foldersInView
      .filter((folder) => tagFilters.length === 0
        || (folder.tags ?? []).some((tag) => tagFilters.some((selected) => tag.trim().toLowerCase() === selected.toLowerCase())))
      .filter((folder) => !departmentFilter || folder.department === departmentFilter)
      .filter((folder) => !ownerFilter || folder.ownerId === ownerFilter)
      .map((folder) => {
        const ancestry = query ? buildFolderAncestryPath(folder, folders).slice(0, -1) : [];
        return {
          folderId: folder.folderId,
          name: folder.name,
          isRoot: !folder.parentFolderId,
          pathLabel: ancestry.length > 0 ? ancestry.map((f) => f.name).join(' / ') : (query ? 'Root' : undefined),
          subfolderCount: folders.filter((candidate) => candidate.parentFolderId === folder.folderId).length,
          documentCount: allDocuments.filter((document) => document.folderId === folder.folderId).length,
          department: folder.department,
          ownerName: allUsers.find((u) => u.userId === folder.ownerId)?.fullName,
          tags: folder.tags,
        };
      });
  }, [foldersInView, folders, allDocuments, searchQuery, statusFilter, tagFilters, departmentFilter, ownerFilter, allUsers]);
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
  // Gates the Rename/Delete menu items on what the current user's role can
  // actually do in the folder being browsed, instead of only finding out
  // from a 403 after clicking. Approximates permission on selected folders
  // using the currently-viewed folder's effective role (folders selected
  // here are always shown within that folder's listing).
  const canRenameSelection = Boolean(renameDocument ? myPermissions?.updateFile : renameFolder ? myPermissions?.updateFolder : false);
  const canDeleteSelection = selectedItemCount > 0
    && (selectedDocumentIds.size === 0 || Boolean(myPermissions?.deleteFile))
    && [...selectedFolderIds].every((folderId) => {
      const folder = folders.find((f) => f.folderId === folderId);
      return Boolean(folder?.parentFolderId == null ? myPermissions?.deleteParentFolder : myPermissions?.deleteSubfolder);
    });
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

  useEffect(() => {
    apiClient.getDropdownLists()
      .then((res) => setDropdownOptions({
        department: (res.data?.department || []).map((i: { label: string }) => i.label),
        category: (res.data?.category || []).map((i: { label: string }) => i.label),
        tag: (res.data?.tag || []).map((i: { label: string }) => i.label),
      }))
      .catch(() => setDropdownOptions({ department: [], category: [], tag: [] }));
  }, []);

  // Remembers wherever the user actually navigates to (via the folder tree,
  // breadcrumb, search result, Backspace, ...) so a remount after leaving the
  // page can resume here — see readStoredLastFolderId above for why this is
  // necessary at all.
  useEffect(() => {
    if (selectedFolderId) writeStoredLastFolderId(selectedFolderId);
  }, [selectedFolderId]);

  // Drives which action buttons (Upload, Rename, Delete) are shown as
  // disabled instead of only failing with a 403 after the user clicks them.
  useEffect(() => {
    if (!selectedFolderId) {
      setMyPermissions(null);
      return;
    }
    apiClient.getMyEffectivePermissions(selectedFolderId)
      .then((res) => setMyPermissions(res.data ?? null))
      .catch(() => setMyPermissions(null));
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
            // A direct preview deep-link never shows this folder at all (it's
            // hidden behind the full-screen preview overlay until closed), so
            // picking a "best writable folder" for it — and the extra
            // getUserPermissions round trip that requires — is pure throwaway
            // work competing with the preview's own network/render path for
            // no visible benefit. Skip it here; the plain "first folder"
            // fallback effect below picks something reasonable once the user
            // actually starts browsing.
            if (loadedFolders.length > 0 && !startedWithDirectPreviewRef.current) {
              // Resume wherever the user actually was, if that folder still
              // exists — navigating to another page and back (or hitting the
              // browser's own Back button) remounts this component from
              // scratch, and always recomputing "the first writable folder"
              // here silently threw away the user's real position, even
              // though nothing about the state actually needed to reset.
              const storedFolderId = readStoredLastFolderId();
              const storedFolderStillExists = Boolean(
                storedFolderId && loadedFolders.some((folder) => folder.folderId === storedFolderId),
              );
              if (storedFolderStillExists && storedFolderId) {
                if (!cancelled) setSelectedFolderId(storedFolderId);
              } else {
                // First-ever visit (or the remembered folder was deleted) —
                // picking loadedFolders[0] unconditionally would often default to
                // a folder the current user only has read (or no) access to,
                // which makes uploads fail with a silent 403 the moment you hit
                // Upload without first clicking a different folder. Prefer the
                // first folder the user can actually write to.
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
        }
      } catch (error) {
        console.error('Failed to load folders:', error);
        if (!cancelled) showError('Failed to load folders');
      } finally {
        if (!cancelled) setIsLoadingFolders(false);
      }

      // Preserve the original, deterministic initial-load sequence for the
      // normal library. A direct preview deliberately skips this expensive
      // 1000+ document fetch until the preview has been closed.
      if (!cancelled && !startedWithDirectPreviewRef.current) {
        serverDocumentsLoadStartedRef.current = true;
        await refreshServerDocuments(loadedFolders);
      }

    };
    void loadLibrary();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  // A deep link opens one document immediately. Loading, parsing and rendering
  // the complete 1000+ document library behind its full-screen preview added
  // several seconds of main-thread work without changing anything visible.
  // Defer that list until the preview closes; normal library navigation still
  // starts it as soon as the folder hierarchy is ready.
  useEffect(() => {
    if (
      directPreviewId
      || !startedWithDirectPreviewRef.current
      || folders.length === 0
      || serverDocumentsLoadStartedRef.current
    ) return;

    serverDocumentsLoadStartedRef.current = true;
    void refreshServerDocuments(folders);
  }, [directPreviewId, folders, refreshServerDocuments]);

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
      if (usesGeneratedPdfPreview(libraryDocument.fileName, libraryDocument.contentType)) {
        showLoadingPreview(`Preparing ${libraryDocument.fileName} for secure viewing...`);
        try {
          const previewBlob = await apiClient.getDocumentPreview(
            libraryDocument.documentId,
            libraryDocument.currentVersionId,
            signal,
          );
          if (signal.aborted || previewRequestRef.current !== requestId) return;

          sourceUrl = URL.createObjectURL(previewBlob);
          objectUrlsRef.current.add(sourceUrl);
          const restoredDocument: MockLibraryDocument = {
            ...libraryDocument,
            sourceUrl,
            preview: { kind: 'pdf', url: sourceUrl },
          };
          setAllDocuments((current) => current.map((document) =>
            document.documentId === restoredDocument.documentId ? restoredDocument : document,
          ));
          setPreviewDocument(restoredDocument);
          documentObjectUrlsRef.current.set(restoredDocument.documentId, [sourceUrl]);
          touchPreviewCache(restoredDocument.documentId);
          return;
        } catch (previewError: any) {
          if (signal.aborted || previewRequestRef.current !== requestId) return;
          if (previewError?.response?.status === 403) throw previewError;
          console.warn('Server PDF preview failed; falling back to the original client path:', previewError);
          showLoadingPreview(`Loading ${libraryDocument.fileName} from secure storage...`);
        }
      }

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
      const previewUrls = [sourceUrl];

      let preview = await createNativePreview(blob, resolvedFileName, contentType, sourceUrl, (url) => {
        objectUrlsRef.current.add(url);
        previewUrls.push(url);
      });
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
      documentObjectUrlsRef.current.set(restoredDocument.documentId, previewUrls);
      touchPreviewCache(restoredDocument.documentId);

      // The native <img> preview above renders instantly, but carries no text to
      // search — a reload never re-runs the upload-time Docling/OCR step. Fetch it
      // in the background (stateless, doesn't re-index) so search still works
      // after a refresh, without delaying the image itself.
      if (preview.kind === 'image') {
        doclingApi.convertDocument(new File([blob], resolvedFileName, { type: contentType }), signal)
          .then((parsedDocument) => {
            if (signal.aborted || previewRequestRef.current !== requestId) return;
            const withOcrText: MockLibraryDocument = {
              ...restoredDocument,
              preview: { ...(restoredDocument.preview as { kind: 'image'; url: string; alt: string }), ocrText: parsedDocument.content },
            };
            setAllDocuments((current) => current.map((document) =>
              document.documentId === withOcrText.documentId ? withOcrText : document,
            ));
            setPreviewDocument((current) =>
              current && current.documentId === withOcrText.documentId ? withOcrText : current,
            );
          })
          .catch(() => {
            // No OCR text available for this image — search simply stays unavailable.
          });
      }
    } catch (error: any) {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
        objectUrlsRef.current.delete(sourceUrl);
      }
      if (previewRequestRef.current !== requestId) return;

      console.error('Failed to restore document preview:', error);
      // Real gap found live: fetching the document's *metadata* (loadApiDocument
      // above) can succeed even when the actual file content is denied — the
      // task-linked-document bypass and an explicit Deny override are resolved
      // independently per action. This catch (the one that actually fetches the
      // file bytes) never checked the status code at all, so a genuine 403 here
      // fell into the generic "download the read-only source" message and just
      // sat on the loading spinner's last-shown text forever instead of ever
      // surfacing a real error.
      if (error?.response?.status === 403) {
        setPreviewDocument({
          ...libraryDocument,
          preview: {
            kind: 'unavailable',
            message: 'You do not have access to this file — please contact your administrator.',
          },
        });
        showError('You do not have access to this file — please contact your administrator.');
        return;
      }

      const message = error instanceof Error ? error.message : 'The stored source could not be loaded';
      setPreviewDocument({
        ...libraryDocument,
        preview: {
          kind: 'unavailable',
          message: `${message}. Download the read-only source to view it locally.`,
        },
      });
      showError('Document preview could not be loaded');
    }
  }, [showError, touchPreviewCache]);

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

  // Real bug found live: navigating straight to a preview URL (e.g. clicking
  // "View" on a task's Linked Document) mounts this whole page fresh — the
  // "load real documents from the server" effect above starts from fixture
  // data and only fills in the real list once its fetch resolves, racing
  // against this effect's very first run. The first run usually finds
  // nothing yet in `allDocuments` and falls back to `loadApiDocument` below —
  // which is fine on its own — but `findLibraryDocument`'s reference changes
  // the moment the real document list *does* arrive a moment later, and since
  // it (and `hydrateDocumentPreview`, which is built on top of it) used to be
  // a reactive dependency of this very effect, that alone re-triggered it —
  // aborting whatever fetch was already in flight and restarting the file
  // download from scratch. Stored in refs and read at effect-run time instead,
  // so this effect only actually re-runs when the URL's own `preview` param
  // changes, not whenever the document list happens to update in the
  // background — which is exactly what made a fresh-navigation preview look
  // like it was stuck loading forever with no error ever surfacing.
  const findLibraryDocumentRef = useRef(findLibraryDocument);
  findLibraryDocumentRef.current = findLibraryDocument;
  const hydrateDocumentPreviewRef = useRef(hydrateDocumentPreview);
  hydrateDocumentPreviewRef.current = hydrateDocumentPreview;

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
    writeStoredLastPreviewId(previewId);
    const requestedDocument = findLibraryDocumentRef.current(previewId);
    if (requestedDocument) {
      setSelectedFolderId(requestedDocument.folderId);
      hydrateDocumentPreviewRef.current(requestedDocument);
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
        hydrateDocumentPreviewRef.current(requestedDocument);
      } catch (err: any) {
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
          err?.response?.status === 403
            ? 'You do not have access to this file — please contact your administrator.'
            : 'The preview could not be loaded. The document may be unavailable or the server may be offline.',
        ));
      }
    };
    void loadApiDocument();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only tags actually present on a document OR a subfolder in the folder
  // currently being browsed — not every tag in the whole system. Clicking
  // into "IT" should only ever offer tags that exist inside IT, not tags
  // that only exist on an unrelated "HR" document/folder elsewhere in the
  // library. Deliberately keyed off `documents` (already folder-scoped, or
  // the cross-folder "my submissions" view) and `foldersInView` (the same
  // scoping for folders' own tags — see EditFolderModal), so it naturally
  // follows whatever the user is actually looking at right now.
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const document of documents) {
      for (const tag of document.tags) {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
      }
    }
    for (const folder of foldersInView) {
      for (const tag of folder.tags ?? []) {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
      }
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [documents, foldersInView]);

  // Same scoping principle as availableTags, for Department and Owner.
  const availableDepartments = useMemo(() => {
    const departments = new Set<string>();
    for (const document of documents) if (document.department) departments.add(document.department);
    for (const folder of foldersInView) if (folder.department) departments.add(folder.department);
    return [...departments].sort((left, right) => left.localeCompare(right));
  }, [documents, foldersInView]);

  const availableOwners = useMemo(() => {
    const owners = new Map<string, string>();
    for (const document of documents) if (document.owner?.userId) owners.set(document.owner.userId, document.owner.fullName);
    for (const folder of foldersInView) {
      if (!folder.ownerId) continue;
      const name = allUsers.find((u) => u.userId === folder.ownerId)?.fullName;
      if (name) owners.set(folder.ownerId, name);
    }
    return [...owners.entries()].map(([userId, fullName]) => ({ userId, fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [documents, foldersInView, allUsers]);

  // Switching folders (or the values they contain) can leave a previously-picked
  // filter no longer valid for the new context — drop anything that's no longer
  // offered rather than silently keep filtering by something the user can't see.
  useEffect(() => {
    setTagFilters((current) => current.filter((tag) => availableTags.includes(tag)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTags]);

  useEffect(() => {
    setDepartmentFilter((current) => (current && !availableDepartments.includes(current) ? '' : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDepartments]);

  useEffect(() => {
    setOwnerFilter((current) => (current && !availableOwners.some((o) => o.userId === current) ? '' : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableOwners]);

  const filteredDocuments = useMemo(() => documents.filter((document) => {
    const query = searchQuery.trim();
    const matchesSearch = !query || matchesDmsMetadata(document, query);
    const matchesStatus = !statusFilter || document.status === statusFilter;
    // Case-insensitive so a tag typed as "Quality" still matches "quality" —
    // tags are free text on upload, so real data mixes casing. A document
    // matches if it carries ANY of the selected tags (OR, not AND) — the
    // common "show me anything tagged ISO 9001 or ISO 27001" expectation.
    const matchesTag = tagFilters.length === 0
      || document.tags.some((tag) => tagFilters.some((selected) => tag.trim().toLowerCase() === selected.toLowerCase()));
    const matchesDepartment = !departmentFilter || document.department === departmentFilter;
    const matchesOwner = !ownerFilter || document.owner?.userId === ownerFilter;
    return matchesSearch && matchesStatus && matchesTag && matchesDepartment && matchesOwner;
  }), [documents, searchQuery, statusFilter, tagFilters, departmentFilter, ownerFilter]);

  // While searching across the whole library (see `documents` above), a result
  // living outside the folder currently being browsed needs to say where it
  // actually is — the table's own "Folder" column otherwise just shows a bare
  // folder name with no indication it isn't the one you're standing in.
  const searchResultDocuments = useMemo(() => {
    if (!searchQuery.trim()) return filteredDocuments;
    return filteredDocuments.map((document) => {
      const folder = folders.find((f) => f.folderId === document.folderId);
      if (!folder) return document;
      const path = buildFolderAncestryPath(folder, folders).map((f) => f.name).join(' / ');
      return path === document.folderName ? document : { ...document, folderName: path };
    });
  }, [filteredDocuments, searchQuery, folders]);

  // Pointer capture (rather than window listeners) keeps the drag tracking on the
  // handle itself, so moving fast over the table or off the window edge mid-drag
  // doesn't drop the resize.
  const persistFolderPaneWidth = useCallback((width: number) => {
    try {
      window.localStorage.setItem(FOLDER_PANE_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Width still applies for this session; it just won't be remembered.
    }
  }, []);

  const startFolderPaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    folderPaneResizeOriginRef.current = { pointerX: event.clientX, width: folderPaneWidth };
    setIsResizingFolderPane(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveFolderPaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = folderPaneResizeOriginRef.current;
    if (!origin) return;
    setFolderPaneWidth(clampFolderPaneWidth(origin.width + (event.clientX - origin.pointerX)));
  };

  const endFolderPaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!folderPaneResizeOriginRef.current) return;
    folderPaneResizeOriginRef.current = null;
    setIsResizingFolderPane(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistFolderPaneWidth(folderPaneWidth);
  };

  // Keyboard equivalent, so the divider isn't mouse-only.
  const handleFolderPaneResizeKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = folderPaneWidth - step;
    else if (event.key === 'ArrowRight') next = folderPaneWidth + step;
    else if (event.key === 'Home') next = FOLDER_PANE_MIN_WIDTH;
    else if (event.key === 'End') next = FOLDER_PANE_MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampFolderPaneWidth(next);
    setFolderPaneWidth(clamped);
    persistFolderPaneWidth(clamped);
  };

  const resetFolderPaneWidth = () => {
    setFolderPaneWidth(FOLDER_PANE_DEFAULT_WIDTH);
    persistFolderPaneWidth(FOLDER_PANE_DEFAULT_WIDTH);
  };

  const clearPreviewParam = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('preview');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearMySubmissionsFilter = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('mine');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closePreview = useCallback(() => {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    previewRequestRef.current += 1;
    setPreviewDocument(null);
    clearPreviewParam();
    writeStoredLastPreviewId(null);
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
    writeStoredLastPreviewId(null);
    if (showOnlyMySubmissions) clearMySubmissionsFilter();
  };

  // Backspace goes to the parent folder — the same action as clicking the
  // breadcrumb's own Back arrow — matching how a normal file-explorer window
  // behaves. Skipped whenever focus is on a real editable field (typing "abc"
  // and pressing Backspace to fix a typo in the search box, a rename field,
  // etc. must still just delete text, not navigate away), and while a modal or
  // the full-screen preview is open, so it can never fire underneath something
  // the user is actively working in.
  useEffect(() => {
    const handleBackspace = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      const isEditable = target && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      );
      if (isEditable) return;
      if (showOnlyMySubmissions || folderPath.length < 2) return;
      if (showUploadModal || previewDocument || showBulkOperationsModal || showApprovalPrompt || newFolderRequest) return;
      event.preventDefault();
      handleFolderSelect(folderPath[folderPath.length - 2].folderId);
    };
    window.addEventListener('keydown', handleBackspace);
    return () => window.removeEventListener('keydown', handleBackspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath, showOnlyMySubmissions, showUploadModal, previewDocument, showBulkOperationsModal, showApprovalPrompt, newFolderRequest]);

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
    writeStoredLastPreviewId(libraryDocument.documentId);
  };

  // Resolves and triggers the actual file download without any toast — shared
  // by the read-only download and the Download-for-Editing checkout flow,
  // which each need a different success message.
  const triggerFileDownload = async (libraryDocument: MockLibraryDocument) => {
    // Real bug found live: previewing a Word/Excel/PowerPoint document caches the
    // *server-generated PDF* (from GET .../preview, which renders the file through
    // LibreOffice for viewing) onto the document as both `sourceUrl` and
    // `preview.url`. Every local shortcut below then handed those PDF bytes to the
    // browser under the document's own original name — so downloading a previewed
    // `.doc` produced a file containing a PDF but named `.doc`, which no
    // application can open until it's manually renamed. Verified against the live
    // stack: the stored original really is a genuine OLE2 Word file (magic bytes
    // d0cf11e0a1b11ae1) and GET .../download already streams it correctly with the
    // right MIME type and Content-Disposition name — only the client was
    // substituting the wrong bytes. The same class of substitution applied to the
    // markdown (`fallbackDownload`) and spreadsheet-CSV shortcuts below, which
    // would silently hand back extracted text instead of the real document.
    // So: for any real server-backed document, always stream the immutable
    // original from the API. The local blob shortcuts remain for the bundled
    // sample/fixture documents, which have no server record to download from.
    if (isServerDocumentId(libraryDocument.documentId) && libraryDocument.currentVersionId) {
      await apiClient.downloadDocument(libraryDocument.documentId, libraryDocument.currentVersionId);
      return;
    }

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
      return;
    }
    if (!href) throw new Error('No download source is available');
    const link = window.document.createElement('a');
    link.href = href;
    link.download = fileName;
    link.click();
    if (shouldRevoke) window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  const downloadMockDocument = async (libraryDocument: MockLibraryDocument) => {
    try {
      await triggerFileDownload(libraryDocument);
      showSuccess('Read-only download started');
    } catch (error) {
      console.error(error);
      showError('This sample is not available for download');
    }
  };

  // Checks the document out (60-minute lock, same as the checkout system used
  // elsewhere) before downloading, so a "Download for Editing" click actually
  // locks the document against concurrent edits rather than just being a
  // relabeled regular download.
  const downloadForEditingDocument = async (libraryDocument: MockLibraryDocument) => {
    if (!libraryDocument.currentVersionId) {
      showError('This document has no version available to check out');
      return;
    }
    try {
      const res = await apiClient.checkoutDocument(libraryDocument.documentId, libraryDocument.currentVersionId);
      if (!res.success) {
        showError(res.error || 'Failed to check out this document for editing');
        return;
      }
      await triggerFileDownload(libraryDocument);
      showSuccess(`"${libraryDocument.fileName}" has been locked by you for editing for 1 hour. Upload the updated file to unlock it sooner.`);
      void refreshServerDocuments(folders);
    } catch (error: any) {
      console.error(error);
      showError(error.response?.data?.error || 'Failed to check out this document for editing');
    }
  };

  const handleForceUnlock = async (libraryDocument: MockLibraryDocument) => {
    if (!libraryDocument.currentVersionId) return;
    try {
      const res = await apiClient.forceUnlockCheckout(libraryDocument.documentId, libraryDocument.currentVersionId);
      if (!res.success) {
        showError(res.error || 'Failed to force-unlock this document');
        return;
      }
      showSuccess(`"${libraryDocument.fileName}" has been unlocked.`);
      void refreshServerDocuments(folders);
    } catch (error: any) {
      console.error(error);
      showError(error.response?.data?.error || 'Failed to force-unlock this document');
    }
  };


  const handleDownloadDocument = (docId: string) => {
    const libraryDocument = findLibraryDocument(docId);
    if (libraryDocument) void downloadMockDocument(libraryDocument);
  };

  const handleDownloadForEditing = (docId: string) => {
    const libraryDocument = findLibraryDocument(docId);
    if (libraryDocument) void downloadForEditingDocument(libraryDocument);
  };

  const handleFilePermissions = (docId: string) => {
    if (!isServerDocumentId(docId)) {
      showError('File Permissions are only available for real uploaded documents.');
      return;
    }
    const libraryDocument = findLibraryDocument(docId);
    setAccessOverrideTarget({
      scope: { documentId: docId },
      resourceName: libraryDocument?.fileName ?? docId,
      resourceKind: 'file',
    });
  };

  const handleFolderPermissions = async (folderId: string) => {
    const folder = folders.find((f) => f.folderId === folderId);
    let managerIds = folder?.managerIds || [];
    try {
      const folderRes = await apiClient.getFolder(folderId);
      managerIds = folderRes.data?.managerIds || [];
    } catch {
      // The permissions modal can still open if folder details cannot be
      // refreshed; the manager note will use any assignments already loaded.
    }
    setAccessOverrideTarget({
      scope: { folderId },
      resourceName: folder?.name ?? folderId,
      resourceKind: 'folder',
      ownerName: allUsers.find((u) => u.userId === folder?.ownerId)?.fullName,
      managerIds,
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderRequest || !newFolderRequest.name.trim()) {
      showError('Folder name is required');
      return;
    }
    setIsCreatingFolder(true);
    try {
      const res = await apiClient.createFolder({
        name: newFolderRequest.name.trim(),
        parentFolderId: newFolderRequest.parentFolderId ?? undefined,
        ownerId: DEV_USER_ID,
      });
      if (!res.data?.folderId) throw new Error(res.error || 'Failed to create folder');

      const foldersRes = await apiClient.getFolders();
      setFolders(foldersRes.data || []);
      setSelectedFolderId(res.data.folderId);
      showSuccess(`Folder "${newFolderRequest.name.trim()}" created`);
      setNewFolderRequest(null);
    } catch (error: any) {
      showError(error.response?.data?.error || error.message || 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const clearSelection = () => {
    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set());
  };

  // The folder tree shows every folder, not just the one currently browsed,
  // and each one's action menu (Rename/Copy/Cut/Delete/Download as ZIP/...)
  // needs that specific folder's own effective permissions — not the
  // currently-viewed folder's — since overrides can differ folder to folder.
  const getFolderPermissions = useCallback((folderId: string): RolePermissionFlags | null | undefined => {
    if (folderId === selectedFolderId) return myPermissions;
    return otherFolderPermissions[folderId];
  }, [selectedFolderId, myPermissions, otherFolderPermissions]);

  const ensureFolderPermissionsLoaded = useCallback((folderId: string) => {
    if (folderId === selectedFolderId) return;
    if (folderId in otherFolderPermissions) return;
    if (loadingFolderPermissionIds.current.has(folderId)) return;
    loadingFolderPermissionIds.current.add(folderId);
    apiClient.getMyEffectivePermissions(folderId)
      .then((res) => setOtherFolderPermissions((prev) => ({ ...prev, [folderId]: res.data ?? null })))
      .catch(() => setOtherFolderPermissions((prev) => ({ ...prev, [folderId]: null })))
      .finally(() => loadingFolderPermissionIds.current.delete(folderId));
  }, [selectedFolderId, otherFolderPermissions]);

  const requestFolderAction = (action: 'rename' | 'edit' | 'copy' | 'cut' | 'delete' | 'download' | 'permissions', folderId: string) => {
    if (action === 'permissions') {
      handleFolderPermissions(folderId);
      return;
    }

    if (action === 'edit') {
      setEditFolderId(folderId);
      return;
    }

    setSelectedDocumentIds(new Set());
    setSelectedFolderIds(new Set([folderId]));

    if (action === 'download') {
      const folder = folders.find((f) => f.folderId === folderId);
      if (folder) {
        downloadFolderAsZip(folder, allDocuments, folder.name)
          .then(({ zipped, skipped }) => {
            showSuccess(
              skipped > 0
                ? `Folder "${folder.name}" downloaded — ${zipped} file(s) included, ${skipped} skipped (not permitted).`
                : `Folder "${folder.name}" downloaded successfully`,
            );
          })
          .catch((error) => {
            showError(error instanceof Error ? error.message : 'Failed to download folder');
          });
      }
      return;
    }

    setRequestedFolderAction(action === 'cut' ? 'move' : action);
  };

  // Mirrors requestFolderAction so a single document can be copied, moved,
  // renamed, or deleted directly from its own row menu instead of requiring
  // the checkbox-based bulk-selection flow first — the underlying dialog and
  // permission checks (LibraryBulkActions) are shared either way.
  const requestDocumentAction = (action: 'copy' | 'cut' | 'rename' | 'delete', documentId: string) => {
    setSelectedFolderIds(new Set());
    setSelectedDocumentIds(new Set([documentId]));
    setRequestedFolderAction(action === 'cut' ? 'move' : action);
  };

  const handleBulkAction = async (action: LibraryBulkAction, value?: string) => {
    try {
      // Move previously only ever mutated local React state — it looked like
      // it worked, but nothing was ever persisted, so a reload (or any other
      // user's own session) showed every item back in its original folder.
      // Real (server-backed) documents/folders now get a real API call first;
      // fixture/demo items have no backend record to update, so they still
      // only go through the local transform below.
      if (action === 'move' && value) {
        const realDocumentIds = [...librarySelection.documentIds].filter(isServerDocumentId);
        const realFolderIds = [...librarySelection.folderIds].filter(isServerDocumentId);
        for (const docId of realDocumentIds) {
          const res = await apiClient.moveDocument(docId, value).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to move a document',
          }));
          if (!res.success) return res.error || 'Failed to move a document';
        }
        for (const folderId of realFolderIds) {
          const res = await apiClient.moveFolder(folderId, value).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to move a folder',
          }));
          if (!res.success) return res.error || 'Failed to move a folder';
        }
      }

      if (action === 'copy' && value) {
        const realDocumentIds = [...librarySelection.documentIds].filter(isServerDocumentId);
        for (const docId of realDocumentIds) {
          const res = await apiClient.copyDocument(docId, value).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to copy a document',
          }));
          if (!res.success) return res.error || 'Failed to copy a document';
        }
      }

      // Rename previously had the exact same "looks like it worked, nothing was ever
      // persisted" problem as Move and Delete — a renamed item reverted to the
      // original name on reload. Real documents/folders now get a real API call first.
      if (action === 'rename' && value) {
        const realDocumentIds = [...librarySelection.documentIds].filter(isServerDocumentId);
        const realFolderIds = [...librarySelection.folderIds].filter(isServerDocumentId);
        for (const docId of realDocumentIds) {
          const res = await apiClient.renameDocument(docId, value).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to rename a document',
          }));
          if (!res.success) return res.error || 'Failed to rename a document';
        }
        for (const folderId of realFolderIds) {
          const res = await apiClient.renameFolder(folderId, value).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to rename a folder',
          }));
          if (!res.success) return res.error || 'Failed to rename a folder';
        }
      }

      // Delete had the exact same "looks like it worked, nothing was ever
      // persisted" problem as Move — a deleted item reappeared on reload.
      // Real documents are deleted first; a real folder is only deletable
      // once it's empty, so its own real documents/subfolders are cleared
      // out first (deepest first, to avoid orphaning a subfolder whose
      // parent got removed out from under it).
      if (action === 'delete') {
        const realSelectedDocumentIds = [...librarySelection.documentIds].filter(isServerDocumentId);
        for (const docId of realSelectedDocumentIds) {
          const res = await apiClient.deleteDocument(docId).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to delete a document',
          }));
          if (!res.success) return res.error || 'Failed to delete a document';
        }

        const realSelectedFolderIds = [...librarySelection.folderIds].filter(isServerDocumentId);
        for (const folderId of realSelectedFolderIds) {
          const res = await apiClient.deleteFolder(folderId).catch((err: any) => ({
            success: false,
            error: err.response?.data?.error || 'Failed to delete a folder',
          }));
          if (!res.success) return res.error || 'Failed to delete a folder';
        }
      }

      const currentState = { folders, documents: allDocuments };
      const localOnlySelection = action === 'copy'
        ? { ...librarySelection, documentIds: new Set([...librarySelection.documentIds].filter((id) => !isServerDocumentId(id))) }
        : librarySelection;
      const nextState = action === 'copy'
        ? copyLibraryItems(currentState, localOnlySelection, value ?? '')
        : action === 'move'
          ? moveLibraryItems(currentState, librarySelection, value ?? '')
          : action === 'delete'
            ? deleteLibraryItems(currentState, librarySelection)
            : renameLibraryItem(currentState, librarySelection, value ?? '');
      setFolders(nextState.folders);
      setAllDocuments(nextState.documents);
      if (action === 'copy' && [...librarySelection.documentIds].some(isServerDocumentId)) {
        await refreshServerDocuments(folders);
      }
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

  // Company Data admin-managed options — fetched once below and always end
  // with a client-only "Other" sentinel that reveals a free-text input,
  // rather than storing "Other" itself as a real list item.
  const uploadCategoryOptions = [...dropdownOptions.category.map((label) => ({ value: label, label })), { value: 'OTHER', label: 'Other' }];
  const uploadDepartmentOptions = [...dropdownOptions.department, 'Other'];
  const uploadTagOptions = [...dropdownOptions.tag.map((label) => ({ value: label, label })), { value: 'OTHER', label: 'Other' }];
  const uploadIsOtherCategory = uploadCategory === 'OTHER';
  const effectiveUploadCategory = uploadIsOtherCategory ? uploadCustomCategory.trim() : uploadCategory;
  const uploadIsOtherDepartment = uploadDepartment === 'Other';
  const effectiveUploadDepartment = uploadIsOtherDepartment ? uploadCustomDepartment.trim() : uploadDepartment;
  const uploadIsOtherTag = uploadTags.includes('OTHER');
  const uploadTagList = [
    ...uploadTags.filter((tag) => tag !== 'OTHER'),
    ...(uploadIsOtherTag ? uploadCustomTags.split(',').map((t) => t.trim()).filter(Boolean) : []),
  ];
  const toggleUploadTag = (value: string) => {
    setUploadTags((current) => (current.includes(value) ? current.filter((t) => t !== value) : [...current, value]));
  };
  const uploadMissingFields = {
    description: !uploadDescription.trim(),
    version: !uploadVersionLabel.trim(),
    category: !uploadCategory || (uploadIsOtherCategory && !uploadCustomCategory.trim()),
    owner: !uploadOwnerId,
    department: !uploadDepartment || (uploadIsOtherDepartment && !uploadCustomDepartment.trim()),
  };
  const uploadMissingFieldLabels: Record<keyof typeof uploadMissingFields, string> = {
    description: 'Description',
    version: 'Version',
    category: 'Document Category',
    owner: 'Owner',
    department: 'Department',
  };
  const isUploadFormValid = !Object.values(uploadMissingFields).some(Boolean);
  const fieldError = (field: keyof typeof uploadMissingFields) =>
    uploadValidationAttempted && uploadMissingFields[field] ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20' : '';

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
      setUploadValidationAttempted(true);
      const missingLabels = (Object.keys(uploadMissingFields) as Array<keyof typeof uploadMissingFields>)
        .filter((field) => uploadMissingFields[field])
        .map((field) => uploadMissingFieldLabels[field]);
      showError(`Please fill in the required field${missingLabels.length > 1 ? 's' : ''}: ${missingLabels.join(', ')}`);
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
        let createdDocumentId: string | undefined;
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
            category: effectiveUploadCategory,
          });
          const createdDocument = docRes.data;
          if (!createdDocument?.documentId) throw new Error('The server did not return a document ID');
          createdDocumentId = createdDocument.documentId;

          const uploadRes = await apiClient.uploadDocument(createdDocument.documentId, uploadFile, uploadVersionLabel);
          setActiveUploadStage('parsing');
          let parsedContent: string | undefined;
          try {
            const parsedDocument = await doclingApi.uploadDocument(uploadFile, createdDocument.documentId);
            parsedContent = parsedDocument.content;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Local parsing failed';
            parseErrors.push(`${uploadFile.name}: ${message}`);
          }

          // No one sets a Document ID at upload time — the system scans the file's own
          // parsed text for a "Doc ID"/"Doc No" label. Awaited (not fire-and-forget) so
          // the ID is already on the document by the time QA opens First Review.
          if (parsedContent) {
            await apiClient.extractDocId(createdDocument.documentId, parsedContent).catch(() => {});
          }

          const sourceUrl = URL.createObjectURL(uploadFile);
          objectUrlsRef.current.add(sourceUrl);
          const uploadPreviewUrls = [sourceUrl];
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
            versionLabel: uploadVersionLabel.trim() || null,
            status: createdDocument.status ?? 'draft',
            department: effectiveUploadDepartment,
            category: effectiveUploadCategory,
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
            (url) => {
              objectUrlsRef.current.add(url);
              uploadPreviewUrls.push(url);
            },
          );
          if (nativePreview) {
            // A dedicated parser (image/pdf/spreadsheet/word/presentation/text) always
            // beats Docling's generic markdown dump — e.g. the xlsx parser preserves
            // every sheet as its own switchable tab, while Docling flattens a workbook
            // to a single crude markdown table and silently drops every sheet but one.
            // Images are the one case where both are kept: the native <img> preview
            // for viewing, plus Docling's OCR text so the preview can be searched.
            uploadedDocument.preview = nativePreview.kind === 'image' && parsedContent
              ? { ...nativePreview, ocrText: parsedContent }
              : nativePreview;
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
          }
          documentObjectUrlsRef.current.set(uploadedDocument.documentId, uploadPreviewUrls);
          touchPreviewCache(uploadedDocument.documentId);
          uploaded.push(uploadedDocument);
          submittedForApproval.push({
            documentId: createdDocument.documentId,
            filename: uploadFile.name,
            filesize: uploadFile.size,
            uploadedAt: createdDocument.createdAt || timestamp,
          });
        } catch (error: any) {
          // The document row was already created (createDocument succeeded) but a
          // later step in this same file's pipeline failed — without this, the
          // half-created draft is silently left behind, and clicking Submit again
          // (which looks like the only option after an error) creates yet another
          // duplicate of it every time.
          if (createdDocumentId) {
            await apiClient.deleteDocument(createdDocumentId).catch(() => {});
          }
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
        setUploadTags([]);
        setUploadCustomTags('');
        setUploadVersionLabel('');
        setUploadCategory('');
        setUploadCustomCategory('');
        setUploadDepartment('');
        setUploadCustomDepartment('');
        setUploadApprovalNotes('');
        setUploadValidationAttempted(false);
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
    setUploadDescription('');
    setUploadTags([]);
    setUploadCustomTags('');
    setUploadVersionLabel('');
    setUploadCategory('');
    setUploadCustomCategory('');
    setUploadDepartment('');
    setUploadCustomDepartment('');
    setUploadApprovalNotes('');
    setUploadValidationAttempted(false);
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadDescription('');
    setUploadFileName('');
    setUploadTags([]);
    setUploadCustomTags('');
    setUploadVersionLabel('');
    setUploadCategory('');
    setUploadCustomCategory('');
    setUploadDepartment('');
    setUploadCustomDepartment('');
    setUploadApprovalNotes('');
    setUploadValidationAttempted(false);
  };

  return (
    <div className="flex h-[calc(100vh-64px)] min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-950 md:flex-row">
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden md:flex-row ${isResizingFolderPane ? 'select-none' : ''}`}
        aria-hidden={directPreviewId ? 'true' : undefined}
        style={{ contentVisibility: directPreviewId ? 'hidden' : 'visible' }}
      >
      {/* Folders Sidebar */}
      {isLoadingFolders ? (
        <div
          className="max-h-56 w-full flex-shrink-0 space-y-2 overflow-hidden border-b border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900 md:max-h-none md:w-[var(--dms-folder-pane-width,14rem)] md:border-b-0 md:border-r"
          style={{ '--dms-folder-pane-width': `${folderPaneWidth}px` } as CSSProperties}
          role="status"
          aria-label="Loading folders"
        >
          {[1, 2].map((item) => <div key={item} className="h-12 animate-skeleton rounded bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : (
        <FolderTree
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleFolderSelect}
          onFolderAction={requestFolderAction}
          onCreateFolder={(parentFolderId) => setNewFolderRequest({ parentFolderId, name: '' })}
          getFolderPermissions={getFolderPermissions}
          onRequestFolderPermissions={ensureFolderPermissionsLoaded}
          widthPx={folderPaneWidth}
        />
      )}

      {/* Draggable divider replacing the old static border between the two panes. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the folder panel"
        aria-valuenow={folderPaneWidth}
        aria-valuemin={FOLDER_PANE_MIN_WIDTH}
        aria-valuemax={FOLDER_PANE_MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startFolderPaneResize}
        onPointerMove={moveFolderPaneResize}
        onPointerUp={endFolderPaneResize}
        onPointerCancel={endFolderPaneResize}
        onDoubleClick={resetFolderPaneWidth}
        onKeyDown={handleFolderPaneResizeKeys}
        className={`hidden w-1.5 flex-shrink-0 cursor-col-resize touch-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3f8bca] md:block ${
          isResizingFolderPane ? 'bg-[#3f8bca]' : 'bg-transparent hover:bg-[#3f8bca]/40'
        }`}
      />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header with Title and Upload Button */}
        <div className="flex flex-col items-stretch gap-3 border-b border-[#dbe2ec] bg-white px-4 py-4 dark:border-white/10 dark:bg-slate-900 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h1 className="page-heading">Document Library</h1>
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
              aria-label="Upload files"
              disabled={!selectedFolder || !myPermissions?.upload}
              title={
                !selectedFolder
                  ? 'A folder is required before uploading'
                  : !myPermissions?.upload
                    ? 'Your role does not have Upload permission in this folder'
                    : 'Upload files to the selected folder'
              }
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 w-full flex-shrink-0 items-center justify-center gap-2 rounded-[4px] bg-[#2f6f9f] px-3 text-sm font-medium text-white hover:bg-[#255b84] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] sm:w-auto sm:px-4"
            >
              <UploadCloud className="h-4 w-4" /> Upload
            </button>
          </div>
        </div>

        {!showOnlyMySubmissions && folderPath.length > 0 && (
          <div className="flex items-center gap-2 border-b border-[#dbe2ec] bg-[#f7f9fc] px-4 py-2 dark:border-white/10 dark:bg-white/5 sm:px-6">
            <button
              type="button"
              onClick={() => folderPath.length > 1 && handleFolderSelect(folderPath[folderPath.length - 2].folderId)}
              disabled={folderPath.length < 2}
              title={folderPath.length > 1 ? `Back to ${folderPath[folderPath.length - 2].name}` : 'Already at the top level'}
              aria-label="Back to parent folder"
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[4px] text-[#5a6a82] hover:bg-[#e2e8f0] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <nav aria-label="Folder location" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
              {folderPath.map((folder, index) => {
                const isLast = index === folderPath.length - 1;
                return (
                  <span key={folder.folderId} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[#a4b1c4] dark:text-slate-500" />}
                    {isLast ? (
                      <span className="truncate font-medium text-[#26334d] dark:text-white">{folder.name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleFolderSelect(folder.folderId)}
                        className="truncate text-[#3f8bca] hover:underline"
                      >
                        {folder.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        )}

        {showOnlyMySubmissions && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dbe2ec] bg-[#eef4fb] px-4 py-2.5 dark:border-white/10 dark:bg-[#3f8bca]/10 sm:px-6">
            <p className="text-sm text-[#2f6f9f] dark:text-[#8fc4ea]">
              Showing only documents <strong>you submitted</strong> that are still pending review, across every folder.
            </p>
            <button type="button" onClick={clearMySubmissionsFilter} className="text-sm font-medium text-[#3f8bca] hover:underline">
              Clear filter — show folders
            </button>
          </div>
        )}

        {/* Documents Table and Filters */}
        <div className="flex-1 overflow-y-auto">
          <Card className="m-3 min-w-0 overflow-hidden sm:m-4">
            <div className="flex flex-col gap-3 border-b border-[#e2e8f0] p-3 dark:border-white/10 sm:flex-row sm:items-center">
              <input type="text" placeholder="Search name, extension, owner, tags..." title="Searches file name, extension, folder, department, owner, tags, description, tracking code, and status" className="field-control h-9 w-full sm:max-w-[230px]" aria-label="Search documents" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <select className="field-control h-9 w-full sm:w-[150px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter documents by status">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="qa_review">QA Review</option>
                <option value="manager_review">Manager Review</option>
                <option value="correction_in_progress">Correction Needed</option>
                <option value="qa_final_review">Final Review</option>
                <option value="released">Released</option>
              </select>
              <TagFilterMenu availableTags={availableTags} selectedTags={tagFilters} onChange={setTagFilters} />
              <select className="field-control h-9 w-full sm:w-[150px]" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
                <option value="">All departments</option>
                {availableDepartments.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
              <select className="field-control h-9 w-full sm:w-[150px]" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Filter by owner">
                <option value="">All owners</option>
                {availableOwners.map((owner) => <option key={owner.userId} value={owner.userId}>{owner.fullName}</option>)}
              </select>
              <div className="flex w-full items-center justify-end gap-2 sm:ml-auto sm:w-auto">
                <LibraryBulkActions
                  selectedCount={selectedItemCount}
                  selectedNames={selectedNames}
                  canRename={selectedItemCount === 1 && canRenameSelection}
                  canDelete={canDeleteSelection}
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
                {selectedServerDocuments.length > 0 && myPermissions?.canManageBulkActions && (
                  <Button variant="secondary" onClick={() => setShowBulkOperationsModal(true)}>
                    Bulk Actions ({selectedServerDocuments.length})
                  </Button>
                )}
                <ColumnVisibilityMenu visibleColumns={visibleColumns} onChange={setVisibleColumns} />
              </div>
            </div>

            {isLoadingDocs ? (
              <div className="p-4" role="status" aria-label="Loading documents"><SkeletonTable /></div>
            ) : filteredDocuments.length === 0 && childFolderRows.length === 0 ? (
              <div className="p-12 text-center"><p className="text-sm text-[#718198]">{documents.length === 0 ? 'No documents in this folder' : 'No documents matching your filters'}</p></div>
            ) : (
              <DocumentList
                documents={searchResultDocuments}
                folders={childFolderRows}
                selectedFolderIds={selectedFolderIds}
                onSelectedFolderIdsChange={setSelectedFolderIds}
                onFolderOpen={handleFolderSelect}
                onFolderAction={requestFolderAction}
                onCreateSubfolder={(parentFolderId) => setNewFolderRequest({ parentFolderId, name: '' })}
                getFolderPermissions={getFolderPermissions}
                onRequestFolderPermissions={ensureFolderPermissionsLoaded}
                selectedDocumentIds={selectedDocumentIds}
                visibleColumns={visibleColumns}
                onSelectedDocumentIdsChange={setSelectedDocumentIds}
                onDocumentClick={openDocumentPreview}
                onDownload={handleDownloadDocument}
                onDownloadForEditing={handleDownloadForEditing}
                onFilePermissions={handleFilePermissions}
                onEdit={setEditDocumentId}
                onDocumentAction={requestDocumentAction}
                canDownloadForEditing={Boolean(myPermissions?.downloadForEditing)}
                permissions={myPermissions}
              />
            )}
          </Card>
        </div>
      </div>
      </div>
      {directPreviewId && !previewDocument && (
        <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading document preview">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#2f6f9f]" />
        </div>
      )}

      <Suspense fallback={(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/90 dark:bg-slate-950/90" role="status" aria-label="Loading document dialog">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#2f6f9f]" />
        </div>
      )}>
      {previewDocument && (
        <DocumentPreview
          document={previewDocument}
          folders={folders}
          onClose={closePreview}
          onNavigateToFolder={(folderId) => {
            closePreview();
            handleFolderSelect(folderId);
          }}
          onDownload={downloadMockDocument}
          onDownloadForEditing={downloadForEditingDocument}
          onForceUnlock={handleForceUnlock}
          permissions={myPermissions}
          onDocumentUpdated={() => void refreshServerDocuments(folders)}
          onSubmitForApproval={(doc) => {
            closePreview();
            setPendingApprovalFiles([
              { documentId: doc.documentId, filename: doc.fileName, filesize: doc.fileSize, uploadedAt: doc.createdAt },
            ]);
            // Category was already chosen when this document was saved as a draft —
            // don't make the user pick it again.
            setPendingApprovalCategory(doc.category || '');
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
          presetCategory={pendingApprovalCategory}
          onSubmit={() => {
            setShowApprovalPrompt(false);
            setPendingApprovalFiles([]);
            setPendingApprovalCategory('');
            void refreshServerDocuments(folders);
          }}
          onCancel={() => {
            setShowApprovalPrompt(false);
            setPendingApprovalFiles([]);
            setPendingApprovalCategory('');
          }}
        />
      )}

      {accessOverrideTarget && (
        <AccessOverrideModal
          scope={accessOverrideTarget.scope}
          resourceName={accessOverrideTarget.resourceName}
          resourceKind={accessOverrideTarget.resourceKind}
          ownerName={accessOverrideTarget.ownerName}
          managerIds={accessOverrideTarget.managerIds}
          onClose={() => {
            const folderId = accessOverrideTarget.scope.folderId;
            setAccessOverrideTarget(null);
            if (!folderId) return;
            // Permissions for this folder were cached before the override was
            // saved — refetch instead of leaving buttons stuck on stale data
            // until a full page reload.
            if (folderId === selectedFolderId) {
              apiClient.getMyEffectivePermissions(folderId)
                .then((res) => setMyPermissions(res.data ?? null))
                .catch(() => {});
            } else {
              setOtherFolderPermissions((prev) => {
                const next = { ...prev };
                delete next[folderId];
                return next;
              });
            }
          }}
        />
      )}

      {editDocumentId && (
        <EditDocumentModal
          documentId={editDocumentId}
          fileName={allDocuments.find((d) => d.documentId === editDocumentId)?.fileName ?? ''}
          onClose={() => setEditDocumentId(null)}
          onSaved={() => void refreshServerDocuments(folders)}
        />
      )}

      {editFolderId && (() => {
        const target = folders.find((f) => f.folderId === editFolderId);
        return (
          <EditFolderModal
            folderId={editFolderId}
            folderName={target?.name ?? ''}
            initialDescription={target?.description}
            initialDepartment={target?.department}
            initialTags={target?.tags}
            initialOwnerId={target?.ownerId}
            onClose={() => setEditFolderId(null)}
            onSaved={() => {
              apiClient.getFolders().then((res) => setFolders(res.data || []));
            }}
          />
        );
      })()}
      </Suspense>

      {newFolderRequest && (
        <ModalOverlay onClose={() => setNewFolderRequest(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-sm mx-4">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-4 dark:border-white/10">
              <h3 className="section-heading">{newFolderRequest.parentFolderId ? 'New Subfolder' : 'New Folder'}</h3>
              <button type="button" onClick={() => setNewFolderRequest(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-400" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">Folder Name</label>
                <input
                  type="text"
                  autoFocus
                  value={newFolderRequest.name}
                  onChange={(e) => setNewFolderRequest({ ...newFolderRequest, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); }}
                  className="field-control h-9 w-full"
                  placeholder="e.g. Quality Records"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderRequest(null)}
                  className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 dark:bg-navy-700 dark:text-white dark:hover:bg-navy-600"
                >
                  Cancel
                </button>
                <Button variant="primary" onClick={handleCreateFolder} isLoading={isCreatingFolder}>Create</Button>
              </div>
            </CardBody>
          </Card>
        </ModalOverlay>
      )}

      <Dialog.Root open={showUploadModal} onOpenChange={(open) => open ? setShowUploadModal(true) : closeUploadModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
          <Dialog.Content asChild onPointerDownOutside={preventModalOutsideDismiss} onInteractOutside={preventModalOutsideDismiss}>
            <Card className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 shadow-xl flex flex-col max-h-[95vh]">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] p-3 dark:border-white/10">
              <Dialog.Title className="section-heading">Upload Documents</Dialog.Title>
              <Dialog.Close asChild><button type="button" disabled={isUploading} className="text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400" aria-label="Close upload dialog"><X className="h-5 w-5" /></button></Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Review selected files and upload them to the current folder.</Dialog.Description>
            <CardBody className="space-y-3 overflow-y-auto flex-1">
              <div className="rounded-[5px] border-2 border-dashed border-[#cbd5e3] p-5 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#26334d] dark:text-white">{uploadFiles.length} {uploadFiles.length === 1 ? 'file' : 'files'} ready</p>
                    <p className="mt-1 text-xs text-[#718198]">PDF, Word, Excel, PowerPoint, text, or images</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>Choose files</Button>
                </div>
                <ul className="mt-2 max-h-16 space-y-0.5 overflow-y-auto text-xs text-[#52627a]">
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
                  className={`field-control min-h-[60px] w-full resize-none rounded-[4px] border border-[#dbe2ec] bg-white p-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500 ${fieldError('description')}`}
                />
                {uploadValidationAttempted && uploadMissingFields.description && (
                  <p className="text-xs text-red-500">Description is required.</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Tags <span className="text-xs font-normal text-[#8ea0ba]">(Optional)</span>
                  </label>
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-[4px] border border-[#dbe2ec] bg-white p-2 dark:border-white/10 dark:bg-slate-900">
                    {uploadTagOptions.length === 0 && (
                      <span className="px-1 py-0.5 text-xs text-[#8ea0ba]">No tags configured yet</span>
                    )}
                    {uploadTagOptions.map((tag) => {
                      const isSelected = uploadTags.includes(tag.value);
                      return (
                        <button
                          key={tag.value}
                          type="button"
                          disabled={isUploading}
                          onClick={() => toggleUploadTag(tag.value)}
                          aria-pressed={isSelected}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isSelected
                              ? 'border-[#3f8bca] bg-[#3f8bca]/10 text-[#2b6ca3] dark:border-[#3f8bca] dark:bg-[#3f8bca]/20 dark:text-[#8fc4ea]'
                              : 'border-[#dbe2ec] bg-white text-[#52627a] hover:border-[#3f8bca]/50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                  </div>
                  {uploadIsOtherTag && (
                    <input
                      type="text"
                      value={uploadCustomTags}
                      onChange={(e) => setUploadCustomTags(e.target.value)}
                      placeholder="Specify tags, comma-separated..."
                      autoFocus
                      disabled={isUploading}
                      className="mt-1 field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
                    />
                  )}
                  <p className="text-xs text-[#718198]">Select any number of tags, or none.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="upload-version" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Version <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="upload-version"
                    type="text"
                    value={uploadVersionLabel}
                    onChange={(e) => setUploadVersionLabel(e.target.value)}
                    placeholder="e.g. v1.0, Rev A"
                    disabled={isUploading}
                    className={`field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500 ${fieldError('version')}`}
                  />
                  {uploadValidationAttempted && uploadMissingFields.version ? (
                    <p className="text-xs text-red-500">Version is required.</p>
                  ) : (
                    <p className="text-xs text-[#718198]">Shown when viewing the file.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="upload-category" className="block text-sm font-medium text-[#34425b] dark:text-slate-200">
                    Document Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="upload-category"
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    disabled={isUploading}
                    className={`field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white ${fieldError('category')}`}
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
                      className={`mt-2 field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500 ${fieldError('category')}`}
                    />
                  )}
                  {uploadValidationAttempted && uploadMissingFields.category && (
                    <p className="text-xs text-red-500">{uploadIsOtherCategory ? 'Please specify the category.' : 'Document Category is required.'}</p>
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
                    className={`field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white ${fieldError('department')}`}
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
                      className={`mt-2 field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500 ${fieldError('department')}`}
                    />
                  )}
                  {uploadValidationAttempted && uploadMissingFields.department && (
                    <p className="text-xs text-red-500">{uploadIsOtherDepartment ? 'Please specify the department.' : 'Department is required.'}</p>
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
                  className={`field-control h-10 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white ${fieldError('owner')}`}
                >
                  {allUsers.length === 0 && <option value={uploadOwnerId}>Loading users...</option>}
                  {allUsers.map((u) => (
                    <option key={u.userId} value={u.userId}>{u.fullName}</option>
                  ))}
                </select>
                {uploadValidationAttempted && uploadMissingFields.owner && (
                  <p className="text-xs text-red-500">Owner is required.</p>
                )}
              </div>

              {/* No Document ID field here at all, for anyone including Admin — the system
                  auto-detects it from the file's own content on upload (see extractDocId
                  below), and QA/Admin resolve or review it afterward at First Review. */}

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
                  className="field-control min-h-[40px] w-full resize-none rounded-[4px] border border-[#dbe2ec] bg-white p-2 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
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
                  disabled={uploadFiles.length === 0 || isUploading}
                  className="flex-1"
                >
                  {isUploading ? (activeUploadStage === 'parsing' ? 'Converting...' : 'Saving...') : 'Save as Draft'}
                </Button>
                <Button
                  onClick={() => handleUploadDocument('submit')}
                  disabled={uploadFiles.length === 0 || isUploading}
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
