import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Plus, Search, CheckCircle2, Clock, AlertCircle, X, Edit2, Trash2, ChevronLeft, ChevronRight, Paperclip, Download, PencilLine, Upload, FileText, Eye, UserCog, History, Folder as FolderIcon, Bell } from 'lucide-react';
import { apiClient, DEV_USER_ID, type TaskNotificationPreview } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { usePageAccess } from '../../hooks/usePageAccess';
import type { Document, Folder, Task } from '../../types';
import { TaskAttachmentsModal } from '../custom/TaskAttachmentsModal';
import { AttachmentPreviewModal } from '../custom/AttachmentPreviewModal';
import { UploadNewVersionModal } from '../custom/UploadNewVersionModal';
import { formatDateTime, formatFileSize } from '../../utils/formatters';
import { TagSelector } from '../custom/TagSelector';
import { ModalOverlay } from '../ui/ModalOverlay';

const PAGE_SIZE = 10;

interface TaskForm {
  title: string;
  description: string;
  taskType: 'task' | 'review' | 'correction' | 'rca' | 'audit_action' | 'other' | 'pcar';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
  // Exactly one of assignedTo / assignedToGroupId should be set.
  assignedTo: string;
  assignedToGroupId: string;
  directManagerId: string;
  documentId?: string;
  folderId?: string;
  documentIds: string[];
  folderIds: string[];
  auditStage: '' | 'preparation' | 'internal_audit' | 'external_audit';
  findingSeverity: '' | 'observation' | 'minor_ncr' | 'major_ncr';
  standardClause: string;
  auditorNotes: string;
  tags: string[];
}

interface PcarDraft {
  rootCause: string;
  correction: string;
  preventiveAction: string;
  targetDate: string;
  tags: string[];
}

const PRIORITY_COLORS = {
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
} as const;

const TASK_ACTION_LABELS: Record<string, string> = {
  task: 'General task',
  review: 'Review',
  correction: 'Correction',
  rca: 'Root Cause Analysis (RCA)',
  audit_action: 'Audit action',
  other: 'Other',
  pcar: 'Audit PCAR finding',
};


export function Tasks({ mode = 'tasks' }: { mode?: 'tasks' | 'pcar' }) {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const pageAccess = usePageAccess();
  const canManageAllTasks = pageAccess?.canManageAllTasks ?? false;
  const canDeleteTasks = pageAccess?.canDeleteTasks ?? false;
  const canCreateTasks = (pageAccess?.canCreateTasks || pageAccess?.canManageAllTasks) ?? false;
  // canReassignTasks: reassign ANY task, own or not. canReassignMyTasksOnly:
  // reassign only a task this user is already the assignee/manager of — two
  // independent flags; canManageAllTasks/canReassignTasks both already imply
  // the "any task" case, so canReassignMyTasksOnly only ever adds reach for
  // someone who has neither of those.
  const canReassignTasks = (pageAccess?.canReassignTasks || pageAccess?.canManageAllTasks) ?? false;
  const canReassignMyTasksOnly = pageAccess?.canReassignMyTasks ?? false;
  const linkedDocFileInputRef = useRef<HTMLInputElement>(null);
  const taskImportInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const highlightTaskId = searchParams.get('highlight');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [fetchedHighlightTask, setFetchedHighlightTask] = useState<Task | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<Array<{ groupId: string; name: string }>>([]);
  const canRaisePcar = pageAccess?.canCreatePcars ?? false;
  const canVerifyPcar = pageAccess?.canVerifyPcars ?? false;
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const docPickerRef = useRef<HTMLDivElement>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [findingSeverityFilter, setFindingSeverityFilter] = useState('');
  const [clauseFilter, setClauseFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [auditStageFilter, setAuditStageFilter] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [isPcarForm, setIsPcarForm] = useState(false);
  const [newTask, setNewTask] = useState<TaskForm>({
    title: '',
    description: '',
    taskType: 'task',
    priority: 'medium',
    dueDate: '',
    assignedTo: DEV_USER_ID,
    assignedToGroupId: '',
    directManagerId: '',
    documentId: '',
    folderId: '',
    documentIds: [], folderIds: [],
    auditStage: '',
    findingSeverity: '', standardClause: '', auditorNotes: '',
    tags: [],
  });
  const [taskReminderPreview, setTaskReminderPreview] = useState<TaskNotificationPreview | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTaskAttachment, setNewTaskAttachment] = useState<File | null>(null);
  const [isImportingTasks, setIsImportingTasks] = useState(false);
  const [taskImportResult, setTaskImportResult] = useState<{
    created: Array<{ row: number; title: string; taskId: string }>;
    skipped: Array<{ row: number; title?: string; reason: string }>;
  } | null>(null);
  const [attachmentsFor, setAttachmentsFor] = useState<{ taskId: string; title: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TaskForm>>({});
  const [eligibleAssignees, setEligibleAssignees] = useState<{ users: any[]; groups: Array<{ groupId: string; name: string }> } | null>(null);

  const [statusChangeConfirm, setStatusChangeConfirm] = useState<{ taskId?: string; newStatus?: Task['status']; taskTitle?: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskId?: string; taskTitle?: string }>({});
  const [pcarDraft, setPcarDraft] = useState<PcarDraft>({ rootCause: '', correction: '', preventiveAction: '', targetDate: '', tags: [] });
  const [verificationNotes, setVerificationNotes] = useState('');
  const [effectivenessResult, setEffectivenessResult] = useState<'' | 'effective' | 'ineffective'>('');
  const [isVerifyingPcar, setIsVerifyingPcar] = useState(false);
  const [completionComment, setCompletionComment] = useState('');

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadTasks = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // PCAR compliance filters must search the complete accessible register,
      // not only the current ten-row page.
      const res = await apiClient.getTasks(mode === 'pcar' ? { limit: 500 } : { page: targetPage, pageSize: PAGE_SIZE });
      const allTasks = res.data || [];
      const pageItems = allTasks.filter((task: Task) => mode === 'pcar' ? task.taskType === 'pcar' : task.taskType !== 'pcar');
      setTasks(pageItems);
      const count = pageItems.length;
      setTotalCount(count);
      setTotalPages(res.totalPages ?? (Math.ceil(count / PAGE_SIZE) || 1));
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API');
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await apiClient.getUsers({ activeOnly: true });
      setUsers(res.data || []);
    } catch (err) {
      // Silently fail - users list is just for assignment dropdown
    }
  };

  const loadGroups = async () => {
    try {
      const res = await apiClient.getGroups();
      setGroups(res.data || []);
    } catch (err) {
      // Silently fail - groups list is just for assignment dropdown
    }
  };

  const loadDocuments = async () => {
    try {
      const res = await apiClient.getDocuments();
      setDocuments(res.data || []);
    } catch (err) {
      showError('Failed to load documents for task creation');
    }
  };

  const loadFolders = async () => {
    try {
      const res = await apiClient.getFolders();
      setFolders(res.data || []);
    } catch {
      // Folder path is only used to disambiguate documents in the picker —
      // fall back to flat titles rather than blocking task creation on it.
    }
  };

  // "Folder A / Folder B / file.pdf" — lets the picker match on path segments,
  // not just the file name, and disambiguates same-named files in different folders.
  const getFolderPath = (folderId?: string): string => {
    const parts: string[] = [];
    let current = folders.find((f) => f.folderId === folderId);
    let guard = 0;
    while (current && guard < 50) {
      parts.unshift(current.name);
      current = current.parentFolderId ? folders.find((f) => f.folderId === current!.parentFolderId) : undefined;
      guard += 1;
    }
    return parts.join(' / ');
  };

  const getDocumentLabel = (doc: Document) => {
    const path = getFolderPath(doc.folderId);
    const name = doc.title || doc.name;
    const documentId = doc.originalDocumentId ? ` [${doc.originalDocumentId}]` : '';
    return `${path ? `${path} / ` : ''}${name}${documentId}`;
  };

  const getDocumentSearchText = (doc: Document) =>
    `${getDocumentLabel(doc)} ${doc.documentId} ${doc.originalDocumentId ?? ''} ${doc.trackingCode ?? ''}`.toLowerCase();

  const selectedLinkedFolderIds = new Set(
    [...newTask.folderIds, newTask.folderId].filter((folderId): folderId is string => Boolean(folderId)),
  );
  const filteredDocumentOptions = documents.filter((doc) => {
    // A PCAR may be raised against released files alone, a folder alone, or
    // both. Once a folder is selected, constrain the file picker to released
    // files in that exact selected folder instead of offering unrelated DMS
    // files. Multiple selected folders are treated as one allowed scope.
    if (isPcarForm && doc.status !== 'released') return false;
    if (selectedLinkedFolderIds.size > 0 && !selectedLinkedFolderIds.has(doc.folderId)) return false;
    return getDocumentSearchText(doc).includes(docSearchQuery.toLowerCase());
  });
  const filteredFolderOptions = folders.filter((folder) =>
    (getFolderPath(folder.folderId) || folder.name).toLowerCase().includes(folderSearchQuery.toLowerCase())
  );

  useEffect(() => {
    apiClient.getGroupsForUser(DEV_USER_ID)
      .then((res) => setMyGroupIds(new Set(res.data || [])))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTasks(page);
    loadUsers();
    loadGroups();
    loadDocuments();
    loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, mode]);

  useEffect(() => {
    if (!showAddForm || (!newTask.assignedTo && !newTask.assignedToGroupId)) {
      setTaskReminderPreview(null);
      return;
    }

    let cancelled = false;
    apiClient.getTaskNotificationPreview({
      assignedToId: newTask.assignedToGroupId ? undefined : newTask.assignedTo || undefined,
      assignedToGroupId: newTask.assignedToGroupId || undefined,
      documentIds: newTask.documentIds,
      folderIds: newTask.folderIds,
      directManagerId: newTask.documentIds.length === 0 && newTask.folderIds.length === 0 && !newTask.documentId && !newTask.folderId
        ? newTask.directManagerId || undefined
        : undefined,
    }).then((res) => {
      if (!cancelled && res.success && res.data) setTaskReminderPreview(res.data as TaskNotificationPreview);
    }).catch(() => {
      if (!cancelled) setTaskReminderPreview(null);
    });
    return () => { cancelled = true; };
  }, [showAddForm, newTask.assignedTo, newTask.assignedToGroupId, newTask.documentIds, newTask.folderIds, newTask.documentId, newTask.folderId, newTask.directManagerId]);

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (task.taskNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (task.findingNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (task.standardClause?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (task.auditorNotes?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = !statusFilter || task.status === statusFilter;
    const matchesPriority = !priorityFilter || task.priority === priorityFilter;
    const matchesSeverity = !findingSeverityFilter || task.findingSeverity === findingSeverityFilter;
    const matchesClause = !clauseFilter || (task.standardClause?.toLowerCase().includes(clauseFilter.toLowerCase()) ?? false);
    const matchesOwner = !ownerFilter || task.assignedTo === ownerFilter || task.assignedToGroupId === ownerFilter || task.assignedBy === ownerFilter;
    const matchesAuditStage = !auditStageFilter || task.auditStage === auditStageFilter;
    return matchesSearch && matchesStatus && matchesPriority && matchesSeverity && matchesClause && matchesOwner && matchesAuditStage;
  });

  const taskStats = {
    total: totalCount,
    open: tasks.filter(t => t.status === 'open').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length,
    overdue: tasks.filter(t => {
      const due = new Date(t.dueDate);
      return t.status !== 'done' && due < new Date();
    }).length,
  };

  const highlightedTask = highlightTaskId
    ? tasks.find((task) => task.taskId === highlightTaskId) ?? fetchedHighlightTask ?? undefined
    : undefined;
  const selectedTask = selectedTaskId ? tasks.find((task) => task.taskId === selectedTaskId) : undefined;
  const getAssignedToId = (task: Task) => (task as any).assignedToId as string | undefined;
  const getAssignedToGroupId = (task: Task) => (task as any).assignedToGroupId as string | undefined;
  // "Mine" includes a task assigned directly to me AND one assigned to any
  // group I'm a member of — a group assignment is one shared task, so any
  // member should be able to act on it exactly like a direct assignee.
  const isTaskMine = (task: Task) => {
    const groupId = getAssignedToGroupId(task);
    if (groupId) return myGroupIds.has(groupId);
    return getAssignedToId(task) === DEV_USER_ID;
  };
  // Shows the group name for a group-assigned task, or the individual
  // assignee's name otherwise — a task is never assigned to both.
  const getAssignedToName = (task: Task) => {
    const groupId = getAssignedToGroupId(task);
    if (groupId) return groups.find((g) => g.groupId === groupId)?.name ?? task.assignedToGroupName ?? null;
    const id = getAssignedToId(task);
    if (!id) return null;
    return users.find((u) => u.userId === id)?.fullName ?? null;
  };
  // "assignedBy" is the task's managerId — whoever created/submitted it (a
  // correction task raised from C-Doc Workflow, a PCAR filed manually, etc.).
  const getSubmittedByName = (task: Task) => {
    const id = task.assignedBy;
    if (!id) return null;
    return users.find((u) => u.userId === id)?.fullName ?? null;
  };
  // My Tasks list includes both tasks assigned to me AND tasks I delegated
  // as manager/QA (so I can track them) — but the focused card lets you
  // *act* on a task (fill in RCA, submit for approval), so it should default
  // to a task actually assigned to me, not one I merely handed off to someone else.
  // A row click (selectedTask) always wins next, since that's an explicit choice.
  // The PCAR detail view only opens as an explicit modal (row click, or a
  // ?highlight= deep link) — it no longer auto-picks a task to show inline,
  // so the register table is always what's visible first on this page.
  const focusedPcar = highlightedTask || selectedTask;
  const focusedIsPcar = focusedPcar?.taskType === 'pcar';
  const isWorkflowCorrection = !!focusedPcar && !focusedIsPcar && !!focusedPcar.approvalId && !!focusedPcar.documentId;
  const focusedTaskRequiresEvidence = !!focusedPcar
    && !focusedIsPcar
    && !isWorkflowCorrection
    && ['correction', 'rca', 'audit_action'].includes(focusedPcar.taskType);
  const focusedPcarIsMine = focusedPcar ? isTaskMine(focusedPcar) : true;
  const focusedTaskCanManage = focusedPcar
    ? (focusedPcar.canManage ?? (focusedPcarIsMine || canManageAllTasks))
    : false;
  // Only 'submitted' (awaiting a QA decision) and 'completed' (already
  // approved) actually mean "this PCAR is locked" — 'in_progress' is a
  // separate, ordinary manual work-status a task can carry independent of
  // PCAR submission (see UpdateTaskAsync), so treating "anything but open"
  // as submitted would wrongly lock out a task that was simply marked
  // in-progress and never actually went through Submit at all. (A legacy
  // task from before the real QA queue existed could also get stuck in
  // 'in_progress' forever with no reviewer ever seeing it — that's a data
  // issue to repair directly, not something this check should paper over.)
  const pcarAlreadySubmitted = !!focusedIsPcar && (focusedPcar?.status === 'submitted' || focusedPcar?.status === 'done');
  const workflowCorrectionCompleted = isWorkflowCorrection && (focusedPcar.status === 'completed' || focusedPcar.status === 'done');
  const workflowStageLabel: Record<string, string> = {
    qa_review: 'QA Review (Stage 1)',
    manager_review: 'Manager Review (Stage 2)',
    final_release: 'Final Release (Stage 3)',
    released: 'Released',
  };

  useEffect(() => {
    if (!showDocDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (docPickerRef.current && !docPickerRef.current.contains(e.target as Node)) {
        setShowDocDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDocDropdown]);

  // Keep the folder picker consistent with the document picker. Without this
  // outside-click listener, its results stayed over the form until a folder
  // was selected, which could leave the user unable to reach the form actions.
  useEffect(() => {
    if (!showFolderDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setShowFolderDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFolderDropdown]);

  // A notification's linked task may be on a different page of the paginated
  // "My Tasks" list — fetch a wide, unpaginated slice just this once instead
  // of forcing the whole page to load unpaginated by default.
  useEffect(() => {
    if (!highlightTaskId) return;
    if (tasks.some((t) => t.taskId === highlightTaskId)) return;
    apiClient.getTasks({ limit: 500 })
      .then((res) => {
        const found = (res.data || []).find((t: Task) => t.taskId === highlightTaskId && (mode === 'pcar' ? t.taskType === 'pcar' : t.taskType !== 'pcar'));
        if (found) setFetchedHighlightTask(found);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTaskId, mode]);
  // documents (getDocuments()) is scoped to folders the current user can
  // browse — a task's assignee may have zero folder access to the document
  // their own assigned task is about, in which case it's simply missing from
  // that list. Fall back to the dedicated per-task endpoint, which resolves
  // access via "is this task mine" instead of folder-browsing rights.
  const [linkedDocumentFallback, setLinkedDocumentFallback] = useState<{ documentId: string; fileName: string; currentVersionId?: string } | null>(null);
  const [allLinkedItems, setAllLinkedItems] = useState<{
    documents: Array<{ documentId: string; title: string; originalDocumentId?: string | null; status?: string }>;
    folders: Array<{ folderId: string; name: string }>;
  }>({ documents: [], folders: [] });
  // Per explicit request, a task no longer grants its assignee any implicit
  // access to the document it's about — real folder access (a grant, a
  // role-wide bypass, or an Allow override) is required, same bar as browsing
  // to it directly. This tracks that real denial so the panel can say so
  // clearly instead of silently sitting on "Loading linked document…" forever
  // (the previous bug: the fetch's rejection was caught and swallowed with no
  // distinct UI state at all).
  const [linkedDocumentAccessDenied, setLinkedDocumentAccessDenied] = useState(false);
  const linkedDocument = focusedPcar?.documentId ? documents.find((d) => d.documentId === focusedPcar.documentId) ?? linkedDocumentFallback ?? undefined : undefined;

  useEffect(() => {
    setLinkedDocumentFallback(null);
    setLinkedDocumentAccessDenied(false);
    const docId = focusedPcar?.documentId;
    if (!docId || documents.some((d) => d.documentId === docId)) return;
    apiClient.getTaskDocument(focusedPcar!.taskId)
      .then((res) => {
        if (res.success && res.data) {
          setLinkedDocumentFallback({
            documentId: res.data.documentId,
            fileName: res.data.fileName,
            currentVersionId: res.data.currentVersionId ?? undefined,
          });
        } else {
          setLinkedDocumentAccessDenied(true);
        }
      })
      .catch(() => setLinkedDocumentAccessDenied(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPcar?.taskId, focusedPcar?.documentId, documents]);

  // A task/PCAR can now have more than one document and folder link. Fetch the
  // canonical detail record so this panel never hides the additional links just
  // because the list row still exposes the legacy primary documentId.
  useEffect(() => {
    if (!focusedPcar) {
      setAllLinkedItems({ documents: [], folders: [] });
      return;
    }
    let cancelled = false;
    apiClient.getTask(focusedPcar.taskId)
      .then((res) => {
        if (cancelled || !res.success || !res.data) return;
        setAllLinkedItems({
          documents: Array.isArray(res.data.linkedDocuments) ? res.data.linkedDocuments : [],
          folders: Array.isArray(res.data.linkedFolders) ? res.data.linkedFolders : [],
        });
      })
      .catch(() => { if (!cancelled) setAllLinkedItems({ documents: [], folders: [] }); });
    return () => { cancelled = true; };
  }, [focusedPcar?.taskId]);

  // Shown inline next to Linked Document instead of only being reachable
  // through the separate Attachments modal — no delete here, per explicit
  // request; View/Download only.
  const [focusedAttachments, setFocusedAttachments] = useState<Array<{ attachmentId: string; fileName: string; fileSizeBytes?: number | null; createdAt: string; uploadedByName?: string }>>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const loadFocusedAttachments = (taskId: string) => {
    apiClient.getTaskAttachments(taskId)
      .then((res) => setFocusedAttachments(res.data || []))
      .catch(() => setFocusedAttachments([]));
  };

  useEffect(() => {
    if (!focusedPcar) { setFocusedAttachments([]); return; }
    loadFocusedAttachments(focusedPcar.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPcar?.taskId]);

  const handleUploadFocusedAttachment = async (file: File) => {
    if (!focusedPcar) return;
    setIsUploadingAttachment(true);
    try {
      const res = await apiClient.uploadTaskAttachment(focusedPcar.taskId, file);
      if (!res.success) {
        showError(res.error || 'Failed to upload attachment');
        return;
      }
      showSuccess(`Uploaded "${file.name}"`);
      loadFocusedAttachments(focusedPcar.taskId);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload attachment');
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const [previewingAttachment, setPreviewingAttachment] = useState<{ attachmentId: string; fileName: string } | null>(null);

  const handleViewFocusedAttachment = (attachmentId: string, fileName: string) => {
    setPreviewingAttachment({ attachmentId, fileName });
  };

  const handleDownloadFocusedAttachment = async (attachmentId: string, fileName: string) => {
    if (!focusedPcar) return;
    try {
      await apiClient.downloadTaskAttachment(focusedPcar.taskId, attachmentId, fileName);
    } catch {
      showError('Failed to download this attachment');
    }
  };

  const handleViewLinkedDocument = async () => {
    if (!linkedDocument) return;
    // Check access before navigating — a task's assignee no longer has any
    // implicit access to the document it's about (real folder access is
    // required, same bar as browsing to it directly), and the preview page
    // itself only showed a generic "unavailable" message for a denial, not
    // the real reason.
    try {
      await apiClient.getDocument(linkedDocument.documentId);
      navigate(`/documents?preview=${encodeURIComponent(linkedDocument.documentId)}`);
    } catch (err: any) {
      if (err.response?.status === 403) {
        showError('You do not have access to this file — please contact your administrator.');
      } else {
        showError('Failed to open the linked document');
      }
    }
  };

  const handleDownloadLinkedDocument = async () => {
    if (!linkedDocument?.currentVersionId) return;
    try {
      await apiClient.downloadDocument(linkedDocument.documentId, linkedDocument.currentVersionId);
    } catch {
      showError('Failed to download the linked document');
    }
  };

  const handleDownloadLinkedDocumentForEditing = async () => {
    if (!linkedDocument?.currentVersionId) return;
    if (pcarAlreadySubmitted || workflowCorrectionCompleted) {
      showError('This workflow task has already been submitted — view/download only');
      return;
    }
    try {
      await apiClient.checkoutDocument(linkedDocument.documentId, linkedDocument.currentVersionId);
      await apiClient.downloadDocument(linkedDocument.documentId, linkedDocument.currentVersionId);
      showSuccess(`"${linkedDocument.fileName}" is locked for you for editing.`);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to check out the linked document');
    }
  };

  // A PCAR can't be submitted for approval until the actual corrected file
  // has been re-uploaded — tracks which task that's already happened for
  // (keyed by taskId since only one PCAR is focused/worked on at a time).

  // File the user picked for the linked document's updated version — set once
  // they've cleared the gate below, opens the same metadata-collecting Upload
  // New Version modal the Document Library uses (version label, description,
  // tags, category, department) instead of a silent raw-bytes upload.
  const [pendingLinkedDocFile, setPendingLinkedDocFile] = useState<File | null>(null);

  const handleRequestUploadUpdatedLinkedDocument = () => {
    if (!linkedDocument || !focusedPcar) return;
    if (pcarAlreadySubmitted || workflowCorrectionCompleted) {
      showError('This workflow task has already been submitted — view/download only');
      return;
    }
    // Uploading the corrected file on an approval-linked task immediately
    // sends it back to the reviewer's queue (below) — require the RCA/
    // correction/preventive/target-date documentation to be filled in
    // first, same bar as the self-filed "Submit for approval" path, so a
    // correction can't reach the reviewer with none of that filled in.
    if (isApprovalLinked) {
      if (pcarDraft.rootCause.trim().length < 20) {
        showError('Fill in the Root Cause Analysis (at least 20 characters) before uploading the corrected file');
        return;
      }
      if (!pcarDraft.correction.trim() || !pcarDraft.preventiveAction.trim() || !pcarDraft.targetDate) {
        showError('Complete the immediate correction, preventive action, and target closure date before uploading the corrected file');
        return;
      }
    }
    linkedDocFileInputRef.current?.click();
  };

  // Runs after UploadNewVersionModal has already uploaded the file and saved
  // its metadata — mirrors what the old direct-upload handler did once the
  // upload itself succeeded.
  const handleLinkedDocumentVersionUploaded = async () => {
    if (!linkedDocument || !focusedPcar) return;
    loadDocuments();

    // If this task came from a QA/Manager correction request, persist the
    // documentation fields validated above, then send the approval batch
    // back to that reviewer's queue. Tasks created the regular way (not
    // tied to an approval) simply skip this.
    if (isApprovalLinked || isWorkflowCorrection) {
      try {
        if (isApprovalLinked) {
          await apiClient.updateTask(focusedPcar.taskId, {
            rcaText: pcarDraft.rootCause.trim(),
            correctionText: pcarDraft.correction.trim(),
            preventiveActions: pcarDraft.preventiveAction.trim(),
            dueDate: pcarDraft.targetDate,
            tags: pcarDraft.tags,
          });
        }
      } catch {
        // non-fatal — Save Documentation can retry this afterwards
      }

      try {
        const resubmitRes = await apiClient.resubmitTaskForReview(focusedPcar.taskId);
        if (resubmitRes.success) {
          showSuccess(`Uploaded the updated file — sent back to ${resubmitRes.data?.currentStage === 'manager_review' ? 'the Manager' : 'QA'} for review.`);
          loadTasks();
          return;
        }
        showError(resubmitRes.error || 'Uploaded the file, but could not resubmit it for review');
        return;
      } catch (err: any) {
        showError(err.response?.data?.error || 'Uploaded the file, but could not resubmit it for review');
        return;
      }
    }

    showSuccess(`Uploaded the updated file for "${linkedDocument.fileName}".`);
  };

  useEffect(() => {
    if (!focusedPcar) return;
    setPcarDraft({
      rootCause: focusedPcar.rcaText || '',
      correction: focusedPcar.correctionText || '',
      preventiveAction: focusedPcar.preventiveActions || '',
      targetDate: focusedPcar.dueDate.slice(0, 10),
      tags: focusedPcar.tags || [],
    });
    setVerificationNotes('');
    setEffectivenessResult((focusedPcar.effectivenessResult as '' | 'effective' | 'ineffective' | undefined) ?? '');
    setCompletionComment('');
  }, [focusedPcar?.taskId]);

  // A task spawned by a real QA/Manager rejection (approvalId set) is
  // already governed by the Document Workflow itself — qa-final-release
  // auto-completes it the moment the underlying document is actually
  // released (see ApprovalsController), independent of anything on this
  // page. Running it through a SECOND, separate "Submit for approval" / QA
  // Review Queue cycle here would just be a redundant, confusing gate with
  // no real reviewer on the other end for this specific case — that manual
  // flow only makes sense for a genuinely self-filed PCAR with no approval
  // behind it. RCA/Correction/Preventive fields stay editable as optional
  // documentation either way, saved via the plain update endpoint instead.
  const isApprovalLinked = focusedIsPcar && !!focusedPcar?.approvalId;

  // Per explicit request, any self-filed PCAR with a linked document at all
  // (not only one spawned by a real Document Workflow rejection) must have
  // the corrected file re-uploaded before Submit is allowed — reverted from
  // an earlier session's narrower approvalId-only check, which let a
  // self-filed PCAR referencing a document close out without the file ever
  // actually being fixed. This is a same-session UX gate only (resets on
  // reload); TaskService.SubmitPcarAsync enforces the real, persistent
  // version of this rule server-side by comparing the document's current
  // version's upload time against the task's own creation time.
  const hasPcarEvidence = focusedAttachments.length > 0;

  const updateFocusedPcar = (status: Task['status'], qaReviewNotes?: string) => {
    const update = (task: Task): Task => task.taskId === focusedPcar?.taskId
      ? { ...task, status, qaReviewNotes: qaReviewNotes ?? task.qaReviewNotes }
      : task;
    setTasks((current) => current.map(update));
    setFetchedHighlightTask((current) => current ? update(current) : null);
  };

  const handlePcarSubmit = async () => {
    if (!focusedPcar) return;
    if (!focusedIsPcar) return;
    if (focusedPcar.status !== 'open') {
      showError('This PCAR has already been submitted for approval');
      return;
    }
    if (pcarDraft.rootCause.trim().length < 20) {
      showError('Root cause analysis must contain at least 20 characters');
      return;
    }
    if (!pcarDraft.correction.trim() || !pcarDraft.preventiveAction.trim() || !pcarDraft.targetDate) {
      showError('Complete the corrective action, preventive action, and target date');
      return;
    }
    if (!hasPcarEvidence) {
      showError('Attach at least one evidence item before submitting this PCAR for verification');
      return;
    }

    try {
      const res = await apiClient.submitPcar(focusedPcar.taskId, {
        rca: pcarDraft.rootCause.trim(),
        correction: pcarDraft.correction.trim(),
        preventiveActions: pcarDraft.preventiveAction.trim(),
        targetDate: pcarDraft.targetDate,
        tags: pcarDraft.tags,
      });
      if (!res.success) {
        showError(res.error || 'Failed to submit PCAR');
        return;
      }
      updateFocusedPcar('submitted');
      showSuccess('PCAR submitted for Quality/Auditor verification');
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to submit PCAR');
    }
  };

  const handleCompleteFocusedTask = async () => {
    if (!focusedPcar || focusedIsPcar) return;
    if (focusedTaskRequiresEvidence && focusedAttachments.length === 0) {
      showError('Attach at least one evidence item before completing this task.');
      return;
    }
    try {
      const res = await apiClient.completeTask(focusedPcar.taskId, completionComment.trim() || undefined);
      if (!res.success) {
        showError(res.error || 'Failed to complete task');
        return;
      }
      showSuccess('Task completed');
      updateFocusedPcar('completed');
      setCompletionComment('');
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to complete task');
    }
  };

  const handleVerifyPcar = async (approve: boolean) => {
    if (!focusedPcar) return;
    if (!approve && !verificationNotes.trim()) {
      showError('Add return notes so the assignee knows what to revise');
      return;
    }
    if (!effectivenessResult) {
      showError('Select whether the corrective action is effective or ineffective');
      return;
    }

    setIsVerifyingPcar(true);
    try {
      const res = await apiClient.verifyPcar(focusedPcar.taskId, { approve, notes: verificationNotes.trim() || undefined, effectiveness: effectivenessResult });
      if (!res.success) {
        showError(res.error || 'Failed to verify PCAR');
        return;
      }
      updateFocusedPcar(approve ? 'done' : 'open', verificationNotes.trim() || undefined);
      setVerificationNotes('');
      setEffectivenessResult('');
      showSuccess(approve ? 'PCAR approved and closed' : 'PCAR returned to the assignee for revision');
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to verify PCAR');
    } finally {
      setIsVerifyingPcar(false);
    }
  };

  // For a correction task tied to a real Document Workflow approval, RCA/
  // Correction/Preventive text is documentation only — no separate reviewer
  // decision happens here, so this just saves the fields without touching
  // status. The task itself closes automatically when the document is
  // finally released.
  const handleSaveDocumentation = async () => {
    if (!focusedPcar) return;
    try {
      const res = await apiClient.updateTask(focusedPcar.taskId, {
        rcaText: pcarDraft.rootCause.trim() || undefined,
        correctionText: pcarDraft.correction.trim() || undefined,
        preventiveActions: pcarDraft.preventiveAction.trim() || undefined,
        dueDate: pcarDraft.targetDate || undefined,
        tags: pcarDraft.tags,
      });
      if (!res.success) {
        showError(res.error || 'Failed to save');
        return;
      }
      showSuccess('Documentation saved');
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save');
    }
  };

  const downloadTaskImportTemplate = async () => {
    try {
      const blob = await apiClient.getTaskImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = 'dms-task-import-template.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to download the task CSV template');
    }
  };

  const handleTaskImportFile = async (file: File) => {
    setIsImportingTasks(true);
    try {
      const response = await apiClient.importTasks(file);
      const result = response.data ?? { created: [], skipped: [] };
      setTaskImportResult(result);
      await loadTasks(1);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to import tasks');
    } finally {
      setIsImportingTasks(false);
    }
  };

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) {
      showError('Task title is required');
      return;
    }
    if (!newTask.dueDate) {
      showError('Due date is required');
      return;
    }
    if (isPcarForm && newTask.documentIds.length === 0 && newTask.folderIds.length === 0) {
      showError('Link the PCAR to at least one released file or folder');
      return;
    }
    const isUnlinkedNormalTask = !isPcarForm
      && newTask.documentIds.length === 0 && newTask.folderIds.length === 0
      && !newTask.documentId && !newTask.folderId;
    if (isPcarForm && !newTask.findingSeverity) {
      showError('Select the audit finding severity');
      return;
    }
    if (!newTask.assignedTo && !newTask.assignedToGroupId) {
      showError('Assignee is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title: newTask.title,
        description: newTask.description,
        taskType: newTask.taskType,
        riskSeverity: newTask.priority,
        documentId: (newTask.documentIds[0] || newTask.documentId) || undefined,
        folderId: (newTask.folderIds[0] || newTask.folderId) || undefined,
        documentIds: newTask.documentIds,
        folderIds: newTask.folderIds,
        directManagerId: isUnlinkedNormalTask
          ? newTask.directManagerId || undefined
          : undefined,
        assignedToId: newTask.assignedToGroupId ? undefined : newTask.assignedTo,
        assignedToGroupId: newTask.assignedToGroupId || undefined,
        dueDate: newTask.dueDate,
        tags: newTask.tags,
        auditStage: isPcarForm ? undefined : newTask.auditStage || undefined,
        findingSeverity: isPcarForm ? newTask.findingSeverity || undefined : undefined,
        standardClause: isPcarForm ? newTask.standardClause || undefined : undefined,
        auditorNotes: isPcarForm ? newTask.auditorNotes || undefined : undefined,
      };
      const res = isPcarForm ? await apiClient.createPcar(payload) : await apiClient.createTask(payload);

      const newTaskId = res.data?.taskId;
      if (newTaskId && newTaskAttachment) {
        try {
          await apiClient.uploadTaskAttachment(newTaskId, newTaskAttachment);
        } catch {
          showError('Task created, but the attachment failed to upload');
        }
      }

      showSuccess(isPcarForm ? 'Audit PCAR raised successfully' : 'Task created successfully');
      setShowAddForm(false);
      setIsPcarForm(false);
      setNewTask({
        title: '',
        description: '',
        taskType: 'task',
        priority: 'medium',
        dueDate: '',
        assignedTo: DEV_USER_ID,
        assignedToGroupId: '',
        directManagerId: '',
        documentId: '',
        folderId: '',
        documentIds: [], folderIds: [],
        auditStage: '',
        findingSeverity: '', standardClause: '', auditorNotes: '',
        tags: [],
      });
      setNewTaskAttachment(null);
      setDocSearchQuery('');
      setPage(1);
      loadTasks(1);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    const task = tasks.find(t => t.taskId === taskId);
    if (!task) return;

    try {
      if (newStatus === 'done') {
        await apiClient.completeTask(taskId);
      } else {
        await apiClient.updateTask(taskId, { status: newStatus });
      }
      showSuccess('Task status updated');
      setStatusChangeConfirm({});
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update task');
    }
  };

  const handleEditTask = async (task: Task) => {
    setEditingId(task.taskId);
    setEligibleAssignees(task.canManage && !canManageAllTasks ? { users: [], groups: [] } : null);
    setEditData({
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      priority: task.priority,
      dueDate: task.dueDate,
      assignedTo: getAssignedToId(task) ?? '',
      assignedToGroupId: getAssignedToGroupId(task) ?? '',
      tags: task.tags || [],
    });
    if (task.canManage && !canManageAllTasks) {
      try {
        const response = await apiClient.getTaskEligibleAssignees(task.taskId);
        setEligibleAssignees(response.data ?? { users: [], groups: [] });
      } catch (err: any) {
        showError(err.response?.data?.error || 'Unable to load eligible assignees');
        setEligibleAssignees({ users: [], groups: [] });
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      const payload: Record<string, unknown> = {};
      // A reassign-only role (CanReassignTasks without the blanket
      // CanManageAllTasks) is only allowed to touch the assignment fields on
      // someone else's task — the backend rejects the request outright if any
      // other field comes through, so only include them when the caller can
      // actually edit them.
      const editingTask = tasks.find((t) => t.taskId === editingId);
      const canManageThisTask = canManageAllTasks || !!editingTask?.canManage;
      if (canManageThisTask) {
        payload.title = editData.title;
        payload.description = editData.description;
        payload.dueDate = editData.dueDate;
        payload.riskSeverity = editData.priority;
        payload.taskType = editData.taskType;
        payload.tags = editData.tags;
      }
      // Reassignment is its own permission, gated separately server-side too —
      // only send it when the field was actually editable, so a save with no
      // reassignment intent never triggers the reassign-specific 403.
      const canReassignThisTask = canManageThisTask || canReassignTasks || (canReassignMyTasksOnly && !!editingTask && isTaskMine(editingTask));
      if (canReassignThisTask) {
        if (editData.assignedToGroupId) payload.assignedToGroupId = editData.assignedToGroupId;
        else if (editData.assignedTo) payload.assignedToId = editData.assignedTo;
      }
      await apiClient.updateTask(editingId, payload);
      showSuccess('Task updated successfully');
      setEditingId(null);
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const res = await apiClient.deleteTask(taskId);
      if (!res.success) {
        showError(res.error || 'Failed to delete task');
        return;
      }
      showSuccess('Task deleted');
      setDeleteConfirm({});
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete task');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusBadgeColor = (status: Task['status']): any => {
    switch (status) {
      case 'open':
        return 'info';
      case 'in_progress':
        return 'warning';
      case 'submitted':
        return 'warning';
      case 'done':
        return 'success';
      default:
        return 'default';
    }
  };

  const isOverdue = (dueDate: string, status: Task['status']) => {
    return status !== 'done' && new Date(dueDate) < new Date();
  };

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">{mode === 'pcar' ? 'PCAR (Auditor Findings)' : 'Tasks (Internal Use)'}</h1>
          <p className="page-subtitle">Corrective &amp; preventive action register · {taskStats.total} records</p>
        </div>
        {canCreateTasks && (
          <div className="flex flex-wrap gap-2">
            {mode === 'pcar' && canRaisePcar && <Button variant="primary" size="md" onClick={() => { setIsPcarForm(true); setNewTask((task) => ({ ...task, taskType: 'pcar' })); setShowAddForm(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" /> Raise PCAR
            </Button>}
            {mode === 'tasks' && <>
              <input
                ref={taskImportInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Import tasks from CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleTaskImportFile(file);
                  event.target.value = '';
                }}
              />
              <Button variant="secondary" size="md" onClick={downloadTaskImportTemplate} title="Download the CSV template for normal internal tasks">
                <Download className="w-4 h-4 mr-2 inline" /> CSV Template
              </Button>
              <Button variant="secondary" size="md" disabled={isImportingTasks} onClick={() => taskImportInputRef.current?.click()} title="Import normal internal tasks from a CSV template">
                <Upload className="w-4 h-4 mr-2 inline" /> {isImportingTasks ? 'Importing…' : 'Import CSV'}
              </Button>
              <Button variant="primary" size="md" onClick={() => { setIsPcarForm(false); setNewTask((task) => ({ ...task, taskType: 'task' })); setShowAddForm(true); }}>
                <Plus className="w-4 h-4 mr-2 inline" /> New Task
              </Button>
            </>}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Tasks</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.total}</p>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-blue-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Open</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.open}</p>
            </div>
            <div className="bg-blue-600 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-yellow-500">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">In Progress</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.inProgress}</p>
            </div>
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-green-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.done}</p>
            </div>
            <div className="bg-green-600 p-3 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-red-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Overdue</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.overdue}</p>
            </div>
            <div className="bg-red-600 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>
      </div>

      {focusedPcar && (
        <ModalOverlay onClose={() => { setSelectedTaskId(null); if (highlightTaskId) navigate('/tasks', { replace: true }); }} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
          <div className="w-full max-w-5xl rounded-lg bg-[#f4f6fa] p-4 dark:bg-slate-950 sm:p-5">
            <div className="mb-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => { setSelectedTaskId(null); if (highlightTaskId) navigate('/tasks', { replace: true }); }}
                className="rounded-full p-1.5 text-[#52627a] hover:bg-black/5 dark:text-slate-300 dark:hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)]">
          <div className="space-y-4">
            <Card>
              <CardBody className="p-5">
                <p className="mb-2 text-sm font-semibold text-[#174f91] dark:text-blue-200">{focusedIsPcar ? `PCAR No. ${focusedPcar.findingNumber ?? 'Not assigned'}` : `Task No. ${focusedPcar.taskNumber ?? 'Not assigned'}`}</p>
                <h1 className="text-lg font-semibold text-[#26334d] dark:text-white">{focusedPcar.title}</h1>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="section-heading">Issue Description</h2>
                  {getAssignedToName(focusedPcar) && (
                    <span className={`rounded-[4px] px-2 py-1 text-xs font-medium ${focusedPcarIsMine ? 'bg-[#eef4fb] text-[#3f8bca] dark:bg-blue-500/15 dark:text-blue-300' : 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300'}`}>
                      Assigned to: {getAssignedToName(focusedPcar)}{focusedPcarIsMine ? ' (you)' : ''}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-[#52627a] dark:text-slate-300">{focusedPcar.description || focusedPcar.title}</p>
                {isWorkflowCorrection && focusedPcar.qaReviewNotes && (
                  <div className="mt-4 rounded-[4px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">Additional notes</h2>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-amber-950 dark:text-amber-100">{focusedPcar.qaReviewNotes}</p>
                  </div>
                )}
                {isWorkflowCorrection && (
                  <div className="mt-4 grid gap-2 rounded-[4px] border border-[#dbe2ec] bg-[#f8fafc] p-3 text-xs text-[#52627a] dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 sm:grid-cols-3">
                    <span><strong className="text-[#26334d] dark:text-white">Requested by:</strong> {getSubmittedByName(focusedPcar) ?? 'Workflow reviewer'}</span>
                    <span><strong className="text-[#26334d] dark:text-white">Workflow phase:</strong> {workflowStageLabel[focusedPcar.workflowStage ?? ''] ?? 'Document Workflow'}</span>
                    <span><strong className="text-[#26334d] dark:text-white">Document ID:</strong> {allLinkedItems.documents.find((document) => document.documentId === focusedPcar.documentId)?.originalDocumentId ?? 'Not set'}</span>
                  </div>
                )}
                {focusedIsPcar && <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">Tags</p>
                  <TagSelector value={pcarDraft.tags} onChange={(tags) => setPcarDraft({ ...pcarDraft, tags })} disabled={!focusedTaskCanManage || pcarAlreadySubmitted} />
                </div>}
                {focusedIsPcar && focusedPcar.status === 'open' && focusedPcar.qaReviewNotes && (
                  <p className="mt-3 rounded-[4px] bg-[#fde1e2] px-3 py-2 text-xs text-[#c73c44] dark:bg-red-500/10 dark:text-red-300">
                    <strong>Sent back for revision:</strong> {focusedPcar.qaReviewNotes}
                  </p>
                )}
                {!focusedPcarIsMine && (
                  <p className="mt-3 rounded-[4px] bg-[#fff8e6] px-3 py-2 text-xs text-[#8a6116] dark:bg-amber-500/10 dark:text-amber-300">
                    This {focusedIsPcar ? 'PCAR' : 'task'} is assigned to {getAssignedToName(focusedPcar) ?? 'another user'} — only an authorized assignee, linked-folder owner, or linked-folder manager can complete it.
                  </p>
                )}
              </CardBody>
            </Card>
            {!isWorkflowCorrection && (allLinkedItems.documents.length > 0 || allLinkedItems.folders.length > 0) && (
              <Card>
                <CardBody className="p-5">
                  <h2 className="section-heading">Linked Files &amp; Folders</h2>
                  <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">This {mode === 'pcar' ? 'finding' : 'task'} is shown in Related Tasks or Related PCARs for every item below.</p>
                  <div className="mt-3 space-y-2">
                    {allLinkedItems.documents.map((document) => (
                      <button type="button" key={document.documentId} onClick={() => navigate(`/documents?preview=${encodeURIComponent(document.documentId)}`)} className="flex w-full items-center gap-2 rounded-[4px] border border-[#e2e8f0] px-3 py-2 text-left transition-colors hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:border-slate-800 dark:hover:bg-slate-800">
                        <FileText className="h-4 w-4 shrink-0 text-[#3f8bca]" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#26334d] dark:text-white">{document.title}</span>
                        {document.originalDocumentId && <span className="shrink-0 font-mono text-xs text-[#718198] dark:text-slate-400">{document.originalDocumentId}</span>}
                        {document.status && <span className="shrink-0 text-xs capitalize text-[#718198] dark:text-slate-400">{document.status}</span>}
                      </button>
                    ))}
                    {allLinkedItems.folders.map((folder) => (
                      <button type="button" key={folder.folderId} onClick={() => navigate(`/documents?folder=${encodeURIComponent(folder.folderId)}`)} className="flex w-full items-center gap-2 rounded-[4px] border border-[#e2e8f0] px-3 py-2 text-left transition-colors hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:border-slate-800 dark:hover:bg-slate-800">
                        <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#26334d] dark:text-white">{folder.name}</span>
                        <span className="text-xs text-[#718198] dark:text-slate-400">Folder</span>
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}
            {(focusedIsPcar || isWorkflowCorrection) && focusedPcar.documentId && (
              <Card>
                <CardBody className="p-5">
                  <h2 className="section-heading">Linked Document</h2>
                  {linkedDocument ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 flex-shrink-0 text-[#3f8bca]" />
                        <span className="truncate text-sm font-medium text-[#26334d] dark:text-white">{linkedDocument.fileName}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          ref={linkedDocFileInputRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => { const file = e.target.files?.[0]; if (file) setPendingLinkedDocFile(file); e.target.value = ''; }}
                        />
                        <Button variant="secondary" size="sm" onClick={handleViewLinkedDocument} leftIcon={<Eye className="h-3.5 w-3.5" />}>View</Button>
                        <Button variant="secondary" size="sm" onClick={handleDownloadLinkedDocument} leftIcon={<Download className="h-3.5 w-3.5" />}>Download</Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDownloadLinkedDocumentForEditing}
                          leftIcon={<PencilLine className="h-3.5 w-3.5" />}
                          disabled={pcarAlreadySubmitted || workflowCorrectionCompleted}
                          title={pcarAlreadySubmitted || workflowCorrectionCompleted ? 'This workflow task has already been submitted — view/download only' : undefined}
                        >
                          Download for Editing
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleRequestUploadUpdatedLinkedDocument}
                          leftIcon={<Upload className="h-3.5 w-3.5" />}
                          disabled={pcarAlreadySubmitted || workflowCorrectionCompleted}
                          title={pcarAlreadySubmitted || workflowCorrectionCompleted ? 'This workflow task has already been submitted — view/download only' : undefined}
                        >
                          Upload Updated File
                        </Button>
                      </div>
                    </div>
                  ) : linkedDocumentAccessDenied ? (
                    <p className="mt-3 text-sm text-red-600 dark:text-red-400">You do not have access to this file — please contact your administrator.</p>
                  ) : (
                    <p className="mt-3 text-sm text-[#94a3b8] dark:text-slate-400">Loading linked document…</p>
                  )}
                  {focusedIsPcar && (
                    <div className="mt-4 border-t border-[#e2e8f0] pt-4 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8] dark:text-slate-500">Evidence &amp; Attachments</h3>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadFocusedAttachment(file); e.target.value = ''; }}
                      />
                      <Button variant="secondary" size="sm" onClick={() => attachmentInputRef.current?.click()} disabled={!focusedTaskCanManage || isUploadingAttachment} leftIcon={<Paperclip className="h-3.5 w-3.5" />}>
                        {isUploadingAttachment ? 'Uploading…' : 'Add Evidence'}
                      </Button>
                    </div>
                    {focusedAttachments.length === 0 ? (
                      <p className="mt-2 text-sm text-[#94a3b8] dark:text-slate-400">No evidence attached yet. At least one item is required before verification.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {focusedAttachments.map((a) => (
                          <div key={a.attachmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#e2e8f0] px-3 py-2 dark:border-slate-800">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[#26334d] dark:text-white">{a.fileName}</p>
                              <p className="truncate text-xs text-[#94a3b8] dark:text-slate-400">{formatFileSize(a.fileSizeBytes ?? 0)} · {formatDateTime(a.createdAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</p>
                            </div>
                            <div className="flex flex-shrink-0 gap-2">
                              <Button variant="secondary" size="sm" onClick={() => handleViewFocusedAttachment(a.attachmentId, a.fileName)} leftIcon={<Eye className="h-3.5 w-3.5" />}>View</Button>
                              <Button variant="secondary" size="sm" onClick={() => handleDownloadFocusedAttachment(a.attachmentId, a.fileName)} leftIcon={<Download className="h-3.5 w-3.5" />}>Download</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            {!focusedIsPcar && (
              <Card>
                <CardBody className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="section-heading">Attachments</h2>
                      <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">{focusedTaskRequiresEvidence ? 'At least one attachment is required before completing this task.' : 'Optional supporting files for this task.'}</p>
                    </div>
                    <input ref={attachmentInputRef} type="file" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadFocusedAttachment(file); e.target.value = ''; }} />
                    <Button variant="secondary" size="sm" onClick={() => attachmentInputRef.current?.click()} disabled={!focusedTaskCanManage || isUploadingAttachment} leftIcon={<Paperclip className="h-3.5 w-3.5" />}>{isUploadingAttachment ? 'Uploading…' : 'Add attachment'}</Button>
                  </div>
                  {focusedAttachments.length === 0 ? <p className="mt-3 text-sm text-[#94a3b8] dark:text-slate-400">No attachments added.</p> : (
                    <div className="mt-3 space-y-2">
                      {focusedAttachments.map((attachment) => (
                        <div key={attachment.attachmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#e2e8f0] px-3 py-2 dark:border-slate-800">
                          <div className="min-w-0"><p className="truncate text-sm font-medium text-[#26334d] dark:text-white">{attachment.fileName}</p><p className="truncate text-xs text-[#94a3b8] dark:text-slate-400">{formatFileSize(attachment.fileSizeBytes ?? 0)} · {formatDateTime(attachment.createdAt)}{attachment.uploadedByName ? ` · ${attachment.uploadedByName}` : ''}</p></div>
                          <div className="flex shrink-0 gap-2"><Button variant="secondary" size="sm" onClick={() => handleViewFocusedAttachment(attachment.attachmentId, attachment.fileName)} leftIcon={<Eye className="h-3.5 w-3.5" />}>View</Button><Button variant="secondary" size="sm" onClick={() => handleDownloadFocusedAttachment(attachment.attachmentId, attachment.fileName)} leftIcon={<Download className="h-3.5 w-3.5" />}>Download</Button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            {focusedIsPcar && <Card>
              <CardBody className="p-5">
                <h2 className="section-heading">Root Cause Analysis <span className="text-[#e24c53]">*</span></h2>
                <p className="mt-2 text-xs text-[#718198] dark:text-slate-400">Mandatory. Minimum 20 characters. Use the 5-Whys method.</p>
                <textarea disabled={!focusedTaskCanManage || pcarAlreadySubmitted} className="field-control mt-3 min-h-[116px] w-full py-3 disabled:cursor-not-allowed disabled:opacity-60" placeholder="Why did the deviation occur? Trace back through causes..." value={pcarDraft.rootCause} onChange={(event) => setPcarDraft({ ...pcarDraft, rootCause: event.target.value })} />
                <div className="mt-2 text-xs text-[#94a3b8] dark:text-slate-400">{pcarDraft.rootCause.trim().length} / 20 min</div>
              </CardBody>
            </Card>}
            {focusedIsPcar && <Card>
              <CardBody className="space-y-4 p-5">
                <h2 className="section-heading">Corrective &amp; Preventive Action</h2>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Immediate correction <span className="text-[#e24c53]">*</span><input disabled={!focusedTaskCanManage || pcarAlreadySubmitted} className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" placeholder="Quarantine affected item, reassign tasks..." value={pcarDraft.correction} onChange={(event) => setPcarDraft({ ...pcarDraft, correction: event.target.value })} /></label>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Preventive action <span className="text-[#e24c53]">*</span><input disabled={!focusedTaskCanManage || pcarAlreadySubmitted} className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" placeholder="Update procedure, add secondary verification..." value={pcarDraft.preventiveAction} onChange={(event) => setPcarDraft({ ...pcarDraft, preventiveAction: event.target.value })} /></label>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Target closure date <span className="text-[#e24c53]">*</span><input disabled={!focusedTaskCanManage || pcarAlreadySubmitted} type="date" className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" value={pcarDraft.targetDate} onChange={(event) => setPcarDraft({ ...pcarDraft, targetDate: event.target.value })} /></label>
              </CardBody>
            </Card>}
          </div>

          <div className="space-y-4">
            <div className="flex justify-end"><span className={`rounded-[5px] px-3 py-2 text-sm font-semibold ${focusedPcar.priority === 'critical' ? 'bg-[#fde1e2] text-[#c73c44] dark:bg-red-500/15 dark:text-red-300' : 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300'}`}>{focusedIsPcar ? 'Severity' : 'Priority'}: {focusedPcar.priority}</span></div>
            {focusedIsPcar && (isApprovalLinked ? (
              <>
                <Card>
                  <CardBody className="p-5">
                    <h2 className="section-heading">Document Workflow</h2>
                    <div className="mt-4 flex items-center gap-2 text-sm text-[#52627a] dark:text-slate-300">
                      <span className={`h-2.5 w-2.5 rounded-full ${focusedPcar.status === 'done' ? 'bg-[#3aa66a]' : 'bg-[#efb514]'}`} />
                      {focusedPcar.status === 'done' ? 'Closed — document was released' : 'Tracked via the linked document’s own QA/Manager review'}
                    </div>
                    <p className="mt-3 text-xs text-[#94a3b8] dark:text-slate-400">
                      This corrective action was raised from a real rejection in Document Workflow — it isn't a separate approval. It closes automatically once that document reaches Final Release.
                    </p>
                  </CardBody>
                </Card>
                <Button className="w-full" variant="secondary" onClick={handleSaveDocumentation} disabled={!focusedTaskCanManage || pcarAlreadySubmitted}>
                  Save Documentation
                </Button>
                {pcarAlreadySubmitted && (
                  <p className="text-center text-xs text-[#3f8bca] dark:text-sky-300">This task is closed — documentation is read-only.</p>
                )}
              </>
            ) : (
              <>
                <Card>
                  <CardBody className="p-5">
                    <h2 className="section-heading">PCAR Status</h2>
                    <div className="mt-4 flex items-center gap-2 text-sm text-[#52627a] dark:text-slate-300">
                      <span className={`h-2.5 w-2.5 rounded-full ${
                        focusedPcar.status === 'done' ? 'bg-[#3aa66a]'
                          : focusedPcar.status === 'submitted' ? 'bg-[#efb514]'
                          : 'bg-[#cbd5e3]'
                      }`} />
                      {focusedPcar.status === 'done'
                        ? 'Approved and closed'
                        : focusedPcar.status === 'submitted'
                          ? 'Submitted — awaiting Quality/Auditor verification'
                          : focusedPcar.qaReviewNotes
                            ? 'Sent back for revision'
                            : 'Not yet submitted'}
                    </div>
                    {(focusedPcar.status === 'submitted' || focusedPcar.status === 'done') && focusedPcar.updatedAt && (
                      <p className="mt-2 text-xs text-[#94a3b8] dark:text-slate-400">
                        Submitted on {new Date(focusedPcar.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    {focusedPcar.effectivenessResult && (
                      <p className={`mt-3 text-xs font-medium ${focusedPcar.effectivenessResult === 'effective' ? 'text-[#278b57] dark:text-emerald-300' : 'text-[#b96a08] dark:text-amber-300'}`}>
                        Effectiveness assessment: {focusedPcar.effectivenessResult === 'effective' ? 'Effective' : 'Ineffective'}
                      </p>
                    )}
                  </CardBody>
                </Card>
                <Button
                  className="w-full"
                  onClick={handlePcarSubmit}
                  disabled={focusedPcar.taskType !== 'pcar'
                    ? (!focusedTaskCanManage || pcarAlreadySubmitted)
                    : (!focusedTaskCanManage || !hasPcarEvidence || pcarAlreadySubmitted)}
                  title={
                    !focusedTaskCanManage
                      ? 'Only the assignee, linked-folder owner, or linked-folder manager can complete this item'
                      : pcarAlreadySubmitted
                        ? (focusedPcar.status === 'done' ? 'Already submitted and closed' : 'Already submitted for approval')
                        : !hasPcarEvidence
                          ? 'Attach at least one evidence item before submitting'
                          : undefined
                  }
                >
                  {focusedPcar.taskType !== 'pcar'
                    ? (pcarAlreadySubmitted ? 'Completed' : 'Complete task')
                    : (focusedPcar.status === 'done' ? 'Closed' : pcarAlreadySubmitted ? 'Submitted for verification' : 'Submit evidence for verification')}
                </Button>
                {pcarAlreadySubmitted ? (
                  <p className="text-center text-xs text-[#3f8bca] dark:text-sky-300">
                    {focusedPcar.status === 'done'
                      ? 'This PCAR has been approved and closed.'
                      : 'This PCAR has been submitted and is awaiting Quality/Auditor verification.'}
                  </p>
                ) : !hasPcarEvidence && focusedTaskCanManage && (
                  <p className="text-center text-xs text-[#b96a08] dark:text-amber-300">Add at least one attachment in Evidence before submitting.</p>
                )}
                {focusedPcar.status === 'submitted' && canVerifyPcar && (
                  <Card>
                    <CardBody className="space-y-3 p-5">
                      <div>
                        <h2 className="section-heading">Quality / Auditor Verification</h2>
                        <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">Review the evidence and corrective actions, then close the finding or return it with revision notes.</p>
                      </div>
                      <label className="block text-sm text-[#52627a] dark:text-slate-300">
                        Review notes <span className="text-xs text-[#718198] dark:text-slate-400">(required when returning)</span>
                        <textarea className="field-control mt-2 min-h-[92px] w-full py-2" value={verificationNotes} onChange={(event) => setVerificationNotes(event.target.value)} placeholder="Verification outcome, effectiveness review, or required changes..." disabled={isVerifyingPcar} />
                      </label>
                      <label className="block text-sm text-[#52627a] dark:text-slate-300">
                        Corrective-action effectiveness <span className="text-[#e24c53]">*</span>
                        <select className="field-control mt-2 h-10 w-full" value={effectivenessResult} onChange={(event) => setEffectivenessResult(event.target.value as '' | 'effective' | 'ineffective')} disabled={isVerifyingPcar}>
                          <option value="">Select result...</option>
                          <option value="effective">Effective</option>
                          <option value="ineffective">Ineffective</option>
                        </select>
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button className="flex-1" onClick={() => handleVerifyPcar(true)} disabled={isVerifyingPcar || effectivenessResult !== 'effective'} title={effectivenessResult !== 'effective' ? 'Select Effective to approve and close' : undefined} leftIcon={<CheckCircle2 className="h-4 w-4" />}>Approve and close</Button>
                        <Button className="flex-1" variant="secondary" onClick={() => handleVerifyPcar(false)} disabled={isVerifyingPcar || effectivenessResult !== 'ineffective'} title={effectivenessResult !== 'ineffective' ? 'Select Ineffective to return the PCAR' : undefined} leftIcon={<AlertCircle className="h-4 w-4" />}>Return with notes</Button>
                      </div>
                    </CardBody>
                  </Card>
                )}
              </>
            ))}
            {!focusedIsPcar && (
              <>
                <Card>
                  <CardBody className="p-5">
                    <h2 className="section-heading">{isWorkflowCorrection ? 'Document Workflow' : 'Task Status'}</h2>
                    <div className="mt-4 flex items-center gap-2 text-sm text-[#52627a] dark:text-slate-300">
                      <span className={`h-2.5 w-2.5 rounded-full ${focusedPcar.status === 'completed' || focusedPcar.status === 'done' ? 'bg-[#3aa66a]' : 'bg-[#cbd5e3]'}`} />
                      {workflowCorrectionCompleted
                        ? 'Updated file submitted for review'
                        : isWorkflowCorrection
                          ? `Correction requested - ${workflowStageLabel[focusedPcar.workflowStage ?? ''] ?? 'Document Workflow'}`
                          : focusedPcar.status === 'completed' || focusedPcar.status === 'done' ? 'Completed' : 'Open'}
                    </div>
                    {focusedPcar.completedAt && <p className="mt-2 text-xs text-[#94a3b8] dark:text-slate-400">Completed on {formatDateTime(focusedPcar.completedAt)}</p>}
                  </CardBody>
                </Card>
                {isWorkflowCorrection && !workflowCorrectionCompleted && <p className="text-center text-xs text-[#3f8bca] dark:text-sky-300">Upload the updated linked file to return it to Quality for review.</p>}
                {!isWorkflowCorrection && focusedPcar.status !== 'completed' && focusedPcar.status !== 'done' && <Card><CardBody className="p-5"><label className="block text-sm text-[#52627a] dark:text-slate-300">Completion comment <span className="text-xs text-[#718198] dark:text-slate-400">(optional)</span><textarea className="field-control mt-2 min-h-[92px] w-full py-2" value={completionComment} onChange={(event) => setCompletionComment(event.target.value)} placeholder="Summarize what was completed or any follow-up…" disabled={!focusedTaskCanManage} /></label><Button className="mt-4 w-full" onClick={handleCompleteFocusedTask} disabled={!focusedTaskCanManage || (focusedTaskRequiresEvidence && !hasPcarEvidence)} title={!focusedTaskCanManage ? 'Only the assignee, linked-folder owner, or linked-folder manager can complete this task' : focusedTaskRequiresEvidence && !hasPcarEvidence ? 'Add at least one attachment before completing this task' : undefined}>Complete task</Button>{focusedTaskRequiresEvidence && !hasPcarEvidence && focusedTaskCanManage && <p className="mt-3 text-center text-xs text-[#b96a08] dark:text-amber-300">Add at least one attachment before completing this task.</p>}</CardBody></Card>}
              </>
            )}
          </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      <div className="flex items-center justify-between pt-1"><h2 className="section-heading">{mode === 'pcar' ? 'PCAR Register' : 'Task Register'}</h2></div>

      {/* Filters */}
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search tasks..."
            className="field-control h-10 w-full pl-10 pr-4"
            aria-label="Search PCAR records"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="field-control h-10 w-full px-4 md:w-auto"
          aria-label="Filter PCAR records by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="submitted">Submitted for approval</option>
          <option value="done">Completed</option>
        </select>

        <select
          className="field-control h-10 w-full px-4 md:w-auto"
          aria-label="Filter PCAR records by priority"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        {mode === 'pcar' && <>
          <select className="field-control h-10 w-full px-4 md:w-auto" aria-label="Filter PCAR records by finding severity" value={findingSeverityFilter} onChange={(event) => setFindingSeverityFilter(event.target.value)}>
            <option value="">All severities</option>
            <option value="observation">Observation</option>
            <option value="minor_ncr">Minor NCR</option>
            <option value="major_ncr">Major NCR</option>
          </select>
          <input className="field-control h-10 w-full px-4 md:w-52" aria-label="Filter PCAR records by clause" placeholder="Clause / standard" value={clauseFilter} onChange={(event) => setClauseFilter(event.target.value)} />
          <select className="field-control h-10 w-full px-4 md:w-auto" aria-label="Filter PCAR records by owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
            <option value="">All owners</option>
            {users.map((user) => <option key={user.userId} value={user.userId}>{user.fullName}</option>)}
            {groups.map((group) => <option key={`group-${group.groupId}`} value={group.groupId}>{group.name} (group)</option>)}
          </select>
        </>}
        {mode === 'tasks' && <select className="field-control h-10 w-full px-4 md:w-auto" aria-label="Filter tasks by audit stage" value={auditStageFilter} onChange={(event) => setAuditStageFilter(event.target.value)}>
          <option value="">All audit stages</option>
          <option value="preparation">Preparation</option>
          <option value="internal_audit">Internal Audit</option>
          <option value="external_audit">External Audit</option>
        </select>}
      </div>

      {/* Tasks Table */}
      {loadError ? (
        <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
          <CardBody>
            <p className="text-red-700 dark:text-red-300">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => loadTasks()} className="mt-4">
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : isLoading ? (
        <SkeletonTable />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 dark:bg-navy-900 border-b border-gray-200 dark:border-navy-700">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">{mode === 'pcar' ? 'Finding / PCAR No.' : 'Task / Task No.'}</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Submitted By</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Assigned To</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Priority</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Due Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Action</th>
                  {(canManageAllTasks || canDeleteTasks || canReassignTasks || filteredTasks.some((task) => task.canManage)) && (
                    <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={(canManageAllTasks || canDeleteTasks || canReassignTasks || filteredTasks.some((task) => task.canManage)) ? 8 : 7} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No tasks found
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task, idx) => (
                    <tr
                      key={task.taskId}
                      onClick={() => setSelectedTaskId(task.taskId)}
                      className={`cursor-pointer border-b border-gray-200 dark:border-navy-700 ${
                        idx % 2 === 1 ? 'bg-gray-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-950'
                      } hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-colors ${focusedPcar?.taskId === task.taskId ? 'ring-1 ring-inset ring-[#3f8bca]' : ''}`}
                    >
                      <td className="px-6 py-4">
                        {editingId === task.taskId && (canManageAllTasks || task.canManage) ? (
                          <input
                            type="text"
                            value={editData.title || ''}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          />
                        ) : (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-[#174f91] dark:text-blue-200">{mode === 'pcar' ? `PCAR No. ${task.findingNumber ?? 'Not assigned'}` : `Task No. ${task.taskNumber ?? 'Not assigned'}`}</p>
                            <p className="font-medium text-navy-900 dark:text-white">{task.title}</p>
                            {task.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400">{task.description}</p>
                            )}
                            {(task.tags?.length ?? 0) > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">{(task.tags || []).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[#52627a] dark:bg-slate-800 dark:text-slate-300">{tag}</span>)}</div>
                            )}
                            {task.canManage && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setAttachmentsFor({ taskId: task.taskId, title: task.title }); }}
                                className="mt-1 flex items-center gap-1 text-xs font-medium text-[#3f8bca] hover:text-[#2f6f9f]"
                              >
                                <Paperclip className="h-3 w-3" /> Attachments
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {getSubmittedByName(task) ?? '—'}{task.assignedBy === DEV_USER_ID ? ' (you)' : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId && (task.canManage || canReassignTasks || (canReassignMyTasksOnly && isTaskMine(task))) ? (
                          <select
                            value={editData.assignedToGroupId ? `group:${editData.assignedToGroupId}` : `user:${editData.assignedTo}`}
                            onChange={(e) => {
                              const [kind, value] = e.target.value.split(':');
                              setEditData({ ...editData, assignedTo: kind === 'user' ? value : '', assignedToGroupId: kind === 'group' ? value : '' });
                            }}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          >
                            <optgroup label="Users">
                              {(eligibleAssignees?.users ?? users).map((user) => (
                                <option key={user.userId} value={`user:${user.userId}`}>{user.fullName}</option>
                              ))}
                            </optgroup>
                            {groups.length > 0 && (
                              <optgroup label="Groups">
                              {(eligibleAssignees?.groups ?? groups).map((group) => (
                                  <option key={group.groupId} value={`group:${group.groupId}`}>{group.name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        ) : (
                          <span className={`text-sm ${isTaskMine(task) ? 'font-medium text-[#3f8bca]' : 'text-gray-600 dark:text-gray-400'}`}>
                            {getAssignedToName(task) ?? '—'}{isTaskMine(task) ? ' (you)' : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={getStatusBadgeColor(task.status)} variant="outline">
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId && (canManageAllTasks || task.canManage) ? (
                          <select
                            value={editData.priority || 'medium'}
                            onChange={(e) => setEditData({ ...editData, priority: e.target.value as any })}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                          </select>
                        ) : (
                          <Badge status={PRIORITY_COLORS[task.priority]} variant="outline">
                            {task.priority}
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId && (canManageAllTasks || task.canManage) ? (
                          <input
                            type="date"
                            value={editData.dueDate || task.dueDate?.split('T')[0]}
                            onChange={(e) => setEditData({ ...editData, dueDate: e.target.value })}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          />
                        ) : (
                          <div>
                            <p className={`text-sm ${isOverdue(task.dueDate, task.status) ? 'text-red-600 font-semibold' : 'text-gray-600 dark:text-gray-400'}`}>
                              {formatDate(task.dueDate)}
                            </p>
                            {isOverdue(task.dueDate, task.status) && (
                              <p className="text-xs text-red-600 font-semibold">Overdue</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId && (canManageAllTasks || task.canManage) ? (
                          <select
                            value={editData.taskType || task.taskType}
                            onChange={(e) => setEditData({ ...editData, taskType: e.target.value as any })}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          >
                            <option value="task">General task</option>
                            <option value="review">Review</option>
                            <option value="correction">Correction</option>
                            <option value="rca">RCA</option>
                            <option value="audit_action">Audit Action</option>
                            <option value="other">Other</option>
                          </select>
                        ) : (
                          <span className="text-sm text-gray-600 dark:text-gray-400">{TASK_ACTION_LABELS[task.taskType] ?? task.taskType.replace('_', ' ')}</span>
                        )}
                      </td>
                      {(canManageAllTasks || canDeleteTasks || canReassignTasks || canReassignMyTasksOnly || task.canManage) && (
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          {editingId === task.taskId ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleSaveEdit}
                                className="!px-3"
                              >
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                className="!px-3"
                              >
                                Cancel
                              </Button>
                            </>
                          ) : canManageAllTasks || task.canManage ? (
                            <>
                              {task.taskType !== 'pcar' && task.status !== 'done' && task.status !== 'completed' && (
                                <button
                                  onClick={() => setStatusChangeConfirm({ taskId: task.taskId, newStatus: 'done', taskTitle: task.title })}
                                  className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors text-gray-600 dark:text-gray-300"
                                  title="Mark as complete"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleEditTask(task)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors text-gray-600 dark:text-gray-300"
                                title="Edit"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {canDeleteTasks && task.status === 'open' ? (
                                <button
                                  onClick={() => setDeleteConfirm({ taskId: task.taskId, taskTitle: task.title })}
                                  className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors text-red-600"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              ) : canDeleteTasks ? (
                                <span
                                  className="p-2 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                                  title="Only open tasks can be deleted — this one has already been submitted, is in progress, or is completed"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </span>
                              ) : null}
                            </>
                          ) : canReassignTasks || (canReassignMyTasksOnly && isTaskMine(task)) ? (
                            <button
                              onClick={() => handleEditTask(task)}
                              className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors text-gray-600 dark:text-gray-300"
                              title="Reassign"
                            >
                              <UserCog className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col items-stretch gap-3 border-t border-gray-200 bg-gray-50 px-4 py-4 dark:border-navy-700 dark:bg-navy-900 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages} ({totalCount} total tasks)
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4 mr-1 inline" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1 inline" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="mt-8 flex justify-end border-t border-[#e2e8f0] pt-5 dark:border-slate-800">
        {pageAccess?.canViewHistoricalPcars && (
          <Button variant="secondary" onClick={() => navigate('/tasks/history')} leftIcon={<History className="h-4 w-4" />}>Open Historical PCAR Archive</Button>
        )}
      </div>

      {/* Add Task Modal */}
      {showAddForm && (
        <ModalOverlay onClose={() => setShowAddForm(false)} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="max-h-[90vh] w-full max-w-md overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-xl font-serif font-bold text-navy-900 dark:text-white">{isPcarForm ? 'Raise Audit PCAR' : 'Create New Task'}</h2>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Task Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Fix QMS documentation"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Description</label>
                <textarea
                  placeholder="Task details..."
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Tags</label>
                <TagSelector value={newTask.tags} onChange={(tags) => setNewTask({ ...newTask, tags })} />
              </div>

              {isPcarForm && <>
                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Finding Severity *</label>
                  <select value={newTask.findingSeverity} onChange={(event) => setNewTask({ ...newTask, findingSeverity: event.target.value as TaskForm['findingSeverity'] })} className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white">
                    <option value="">Select severity…</option><option value="observation">Observation</option><option value="minor_ncr">Minor NCR</option><option value="major_ncr">Major NCR</option>
                  </select>
                </div>
                <div><label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Clause / Standard Reference</label><input value={newTask.standardClause} onChange={(event) => setNewTask({ ...newTask, standardClause: event.target.value })} placeholder="e.g., ISO 9001:2015 — 7.5.3" className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white" /></div>
                <div><label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Auditor Notes</label><textarea value={newTask.auditorNotes} onChange={(event) => setNewTask({ ...newTask, auditorNotes: event.target.value })} rows={3} placeholder="Objective evidence and audit observations…" className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white" /></div>
              </>}

              {isPcarForm && <p className="rounded-[4px] bg-[#eef4fb] px-3 py-2 text-xs text-[#2f6f9f] dark:bg-blue-500/10 dark:text-blue-200">Link this finding to one or more released files, folders, or both. At least one item is required.</p>}
              {!isPcarForm && <p className="rounded-[4px] bg-[#eef4fb] px-3 py-2 text-xs text-[#2f6f9f] dark:bg-blue-500/10 dark:text-blue-200">Link this task to one or more files, folders, or both. Leave both blank for a general task.</p>}

              <div ref={folderPickerRef} className="relative">
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Folder{isPcarForm ? ' (optional if files are linked)' : ' (optional)'}</label>
                  <input
                    type="text"
                    placeholder="Search folder name or full path..."
                    value={folderSearchQuery}
                    onFocus={() => setShowFolderDropdown(true)}
                    // An outside mouse-down can dismiss the results without
                    // moving focus away from this input. Reopen on click too,
                    // so the user can continue searching immediately.
                    onClick={() => setShowFolderDropdown(true)}
                    onChange={(event) => { setFolderSearchQuery(event.target.value); setShowFolderDropdown(true); if (newTask.folderId) setNewTask({ ...newTask, folderId: '' }); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setShowFolderDropdown(false);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {showFolderDropdown && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-navy-700 dark:bg-navy-900">
                      {filteredFolderOptions.length === 0 ? <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matching folders</p> : filteredFolderOptions.map((folder) => {
                        const path = getFolderPath(folder.folderId) || folder.name;
                        return <button type="button" key={folder.folderId} onClick={() => { const folderIds = newTask.folderIds.includes(folder.folderId) ? newTask.folderIds : [...newTask.folderIds, folder.folderId]; setNewTask({ ...newTask, folderId: folderIds[0], folderIds, documentId: '', directManagerId: '' }); setFolderSearchQuery(''); setShowFolderDropdown(false); }} className="block w-full truncate px-3 py-2 text-left text-sm text-navy-900 hover:bg-gray-100 dark:text-white dark:hover:bg-navy-800" title={path}>{path}</button>;
                      })}
                    </div>
                  )}
                  <select value={newTask.folderId || ''} onChange={(event) => setNewTask({ ...newTask, folderId: event.target.value, documentId: '', directManagerId: event.target.value ? '' : newTask.directManagerId })} className="hidden">
                    <option value="">Select a folder…</option>
                    {folders.map((folder) => <option key={folder.folderId} value={folder.folderId}>{getFolderPath(folder.folderId) || folder.name}</option>)}
                  </select>
              </div>

              {newTask.folderIds.length > 0 && <div className="flex flex-wrap gap-2">{newTask.folderIds.map((id) => { const folder = folders.find((item) => item.folderId === id); return <button type="button" key={id} onClick={() => setNewTask({ ...newTask, folderIds: newTask.folderIds.filter((item) => item !== id), folderId: newTask.folderIds.find((item) => item !== id) || '' })} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-500/15 dark:text-blue-200">{folder ? getFolderPath(folder.folderId) : id} ×</button>; })}</div>}

              <div ref={docPickerRef} className="relative">
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Document{isPcarForm ? ' (released files only; optional if folders are linked)' : ' (optional)'}</label>
                <input
                  type="text"
                  placeholder="Search file name, folder path, or Document ID..."
                  value={docSearchQuery}
                  onFocus={() => setShowDocDropdown(true)}
                  onClick={() => setShowDocDropdown(true)}
                  onChange={(e) => {
                    setDocSearchQuery(e.target.value);
                    setShowDocDropdown(true);
                    if (newTask.documentId) setNewTask({ ...newTask, documentId: '' });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setShowDocDropdown(false);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {showDocDropdown && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-navy-700 dark:bg-navy-900">
                    {filteredDocumentOptions.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        {isPcarForm
                          ? selectedLinkedFolderIds.size > 0
                            ? 'No released files in the selected folder(s)'
                            : 'No released files match this search'
                          : selectedLinkedFolderIds.size > 0
                            ? 'No files in the selected folder(s) match this search'
                            : 'No matching documents'}
                      </p>
                    ) : (
                      filteredDocumentOptions.map((doc) => (
                        <button
                          type="button"
                          key={doc.documentId}
                          onClick={() => {
                            const documentIds = newTask.documentIds.includes(doc.documentId) ? newTask.documentIds : [...newTask.documentIds, doc.documentId];
                            setNewTask({ ...newTask, documentId: documentIds[0], documentIds, directManagerId: '' });
                            setDocSearchQuery('');
                            setShowDocDropdown(false);
                          }}
                          className="block w-full truncate px-3 py-2 text-left text-sm text-navy-900 hover:bg-gray-100 dark:text-white dark:hover:bg-navy-800"
                        >
                          {getDocumentLabel(doc)}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {newTask.documentIds.length > 0 && <div className="flex flex-wrap gap-2">{newTask.documentIds.map((id) => { const doc = documents.find((item) => item.documentId === id); return <button type="button" key={id} onClick={() => setNewTask({ ...newTask, documentIds: newTask.documentIds.filter((item) => item !== id), documentId: newTask.documentIds.find((item) => item !== id) || '' })} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-500/15 dark:text-blue-200">{doc ? getDocumentLabel(doc) : id} ×</button>; })}</div>}

              {!isPcarForm && newTask.documentIds.length === 0 && newTask.folderIds.length === 0 && !newTask.documentId && !newTask.folderId && <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Direct Manager <span className="font-normal text-gray-500 dark:text-gray-400">(optional)</span></label>
                <select value={newTask.directManagerId} onChange={(event) => setNewTask({ ...newTask, directManagerId: event.target.value })} className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white">
                  <option value="">No direct manager</option>
                  {users.filter((user) => String(user.role).toLowerCase() === 'manager').map((user) => <option key={user.userId} value={user.userId}>{user.fullName}</option>)}
                </select>
                <p className="mt-1 text-xs text-[#64748b] dark:text-slate-400">For an unlinked task, the selected manager receives the configured 1-day, due-date, and overdue reminders. If none is selected, only the assignee is notified; Quality and Full Access are not added.</p>
              </div>}

              {!isPcarForm && <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Audit Stage</label>
                <select value={newTask.auditStage} onChange={(event) => setNewTask({ ...newTask, auditStage: event.target.value as TaskForm['auditStage'] })} className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white">
                  <option value="">Not part of an audit</option>
                  <option value="preparation">Preparation</option>
                  <option value="internal_audit">Internal Audit</option>
                  <option value="external_audit">External Audit</option>
                </select>
              </div>}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Action</label>
                  <select
                    value={newTask.taskType}
                    disabled={isPcarForm}
                    onChange={(e) => setNewTask({ ...newTask, taskType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    {isPcarForm && <option value="pcar">Audit PCAR finding</option>}
                    <option value="task">General task</option>
                    <option value="review">Review</option>
                    <option value="correction">Correction</option>
                    <option value="rca">RCA</option>
                    <option value="audit_action">Audit Action</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Due Date *</label>
                <input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="rounded-[6px] border border-[#d8e5f0] bg-[#f8fbfe] p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex items-start gap-2.5">
                  <Bell className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#3f8bca]" />
                  <div>
                    <p className="text-sm font-semibold text-[#26334d] dark:text-white">Automatic reminders</p>
                    <p className="mt-0.5 text-xs leading-5 text-[#64748b] dark:text-slate-400">You do not need to create a reminder. This {isPcarForm ? 'PCAR' : 'task'} will automatically use the current Admin Panel schedule.</p>
                    <p className="mt-1 text-xs leading-5 text-[#64748b] dark:text-slate-400">If you need a periodic reminder for a separate purpose, go to the <button type="button" onClick={() => navigate('/reminders')} className="font-semibold text-[#2f6f9f] underline underline-offset-2 hover:text-[#1f5680] dark:text-blue-300">Reminders page</button>.</p>
                  </div>
                </div>
                {!taskReminderPreview ? <p className="mt-3 text-xs text-[#64748b] dark:text-slate-400">Loading the active reminder recipients…</p>
                  : !taskReminderPreview.enabled ? <p className="mt-3 text-xs font-medium text-[#b96a08] dark:text-amber-300">Automatic Task and PCAR reminders are currently disabled by Admin Panel.</p>
                    : <div className="mt-3 space-y-1.5 border-t border-[#d8e5f0] pt-3 text-xs text-[#52627a] dark:border-slate-700 dark:text-slate-300">
                      {taskReminderPreview.stages.filter((stage) => stage.enabled).map((stage) => (
                        <p key={stage.key}>
                          <span className="font-semibold text-[#26334d] dark:text-white">{stage.label}:</span>{' '}
                          {stage.recipients.length > 0 ? stage.recipients.join(', ') : 'No recipients configured'}
                        </p>
                      ))}
                    </div>}
              </div>

              {canCreateTasks ? (
                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Assigned To</label>
                  <select
                    value={newTask.assignedToGroupId ? `group:${newTask.assignedToGroupId}` : `user:${newTask.assignedTo}`}
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(':');
                      setNewTask({ ...newTask, assignedTo: kind === 'user' ? id : '', assignedToGroupId: kind === 'group' ? id : '' });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    <optgroup label="Users">
                      {users.map(user => (
                        <option key={user.userId} value={`user:${user.userId}`}>{user.fullName}</option>
                      ))}
                    </optgroup>
                    {groups.length > 0 && (
                      <optgroup label="Groups">
                        {groups.map(group => (
                          <option key={group.groupId} value={`group:${group.groupId}`}>{group.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-slate-400">This PCAR will be filed under your own name.</p>
              )}

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Attachment</label>
                <input
                  type="file"
                  onChange={(e) => setNewTaskAttachment(e.target.files?.[0] ?? null)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white text-sm"
                />
                {newTaskAttachment && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-navy-400">{newTaskAttachment.name}</p>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="secondary"
                  onClick={() => { setShowAddForm(false); setIsPcarForm(false); setNewTaskAttachment(null); setDocSearchQuery(''); setShowDocDropdown(false); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateTask}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : isPcarForm ? 'Raise PCAR' : 'Create Task'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </ModalOverlay>
      )}

      {taskImportResult && (
        <ModalOverlay onClose={() => setTaskImportResult(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-navy-700">
              <div>
                <h2 className="text-xl font-serif font-bold text-navy-900 dark:text-white">Task Import Results</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Review skipped rows before importing a corrected file again.</p>
              </div>
              <button type="button" onClick={() => setTaskImportResult(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close task import results"><X className="h-5 w-5" /></button>
            </div>
            <CardBody className="space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200"><strong>{taskImportResult.created.length}</strong> created</div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"><strong>{taskImportResult.skipped.length}</strong> skipped</div>
              </div>
              {taskImportResult.skipped.length > 0 && <div>
                <h3 className="text-sm font-semibold text-navy-900 dark:text-white">Skipped rows</h3>
                <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-slate-300">
                  {taskImportResult.skipped.map((item) => <li key={`${item.row}-${item.reason}`} className="rounded border border-gray-200 px-3 py-2 dark:border-navy-700"><strong>Row {item.row}</strong>{item.title ? ` — ${item.title}` : ''}: {item.reason}</li>)}
                </ul>
              </div>}
              {taskImportResult.skipped.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-300">Every row was imported successfully.</p>}
            </CardBody>
            <div className="flex justify-end border-t border-gray-200 p-4 dark:border-navy-700"><Button variant="primary" onClick={() => setTaskImportResult(null)}>Close</Button></div>
          </Card>
        </ModalOverlay>
      )}

      {/* Status Change Confirmation Modal */}
      {statusChangeConfirm.taskId && (
        <ModalOverlay onClose={() => setStatusChangeConfirm({})} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Mark as Complete</h2>
              <button
                onClick={() => setStatusChangeConfirm({})}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Mark <span className="font-semibold">"{statusChangeConfirm.taskTitle}"</span> as completed?
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setStatusChangeConfirm({})}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => statusChangeConfirm.taskId && handleStatusChange(statusChangeConfirm.taskId, 'done')}
                >
                  Mark Complete
                </Button>
              </div>
            </CardBody>
          </Card>
        </ModalOverlay>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.taskId && (
        <ModalOverlay onClose={() => setDeleteConfirm({})} className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Delete Task</h2>
              <button
                onClick={() => setDeleteConfirm({})}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to delete <span className="font-semibold">"{deleteConfirm.taskTitle}"</span>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteConfirm({})}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => deleteConfirm.taskId && handleDeleteTask(deleteConfirm.taskId)}
                >
                  Delete Task
                </Button>
              </div>
            </CardBody>
          </Card>
        </ModalOverlay>
      )}

      {attachmentsFor && (
        <TaskAttachmentsModal
          taskId={attachmentsFor.taskId}
          taskTitle={attachmentsFor.title}
          onClose={() => setAttachmentsFor(null)}
        />
      )}

      {previewingAttachment && focusedPcar && (
        <AttachmentPreviewModal
          taskId={focusedPcar.taskId}
          attachmentId={previewingAttachment.attachmentId}
          fileName={previewingAttachment.fileName}
          onClose={() => setPreviewingAttachment(null)}
        />
      )}

      {pendingLinkedDocFile && linkedDocument && (
        <UploadNewVersionModal
          documentId={linkedDocument.documentId}
          file={pendingLinkedDocFile}
          onClose={() => setPendingLinkedDocFile(null)}
          onUploaded={handleLinkedDocumentVersionUploaded}
          workflowMode="correction"
        />
      )}
    </div>
  );
}
