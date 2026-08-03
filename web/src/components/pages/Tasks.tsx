import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Plus, Search, CheckCircle2, Clock, AlertCircle, X, Edit2, Trash2, ChevronLeft, ChevronRight, Paperclip, Download, PencilLine, Upload, FileText, Eye } from 'lucide-react';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { usePageAccess } from '../../hooks/usePageAccess';
import type { Document, Folder, Task } from '../../types';
import { TaskAttachmentsModal } from '../custom/TaskAttachmentsModal';

const PAGE_SIZE = 10;

interface TaskForm {
  title: string;
  description: string;
  taskType: 'correction' | 'rca' | 'audit_action';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
  // Exactly one of assignedTo / assignedToGroupId should be set.
  assignedTo: string;
  assignedToGroupId: string;
  documentId?: string;
}

interface PcarDraft {
  rootCause: string;
  correction: string;
  preventiveAction: string;
  targetDate: string;
}

const PRIORITY_COLORS = {
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
} as const;


export function Tasks() {
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const pageAccess = usePageAccess();
  const canManageAllTasks = pageAccess?.canManageAllTasks ?? false;
  const canCreateTasks = (pageAccess?.canCreateTasks || pageAccess?.canManageAllTasks) ?? false;
  const linkedDocFileInputRef = useRef<HTMLInputElement>(null);
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
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const docPickerRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTask, setNewTask] = useState<TaskForm>({
    title: '',
    description: '',
    taskType: 'correction',
    priority: 'medium',
    dueDate: '',
    assignedTo: DEV_USER_ID,
    assignedToGroupId: '',
    documentId: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTaskAttachment, setNewTaskAttachment] = useState<File | null>(null);
  const [attachmentsFor, setAttachmentsFor] = useState<{ taskId: string; title: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TaskForm>>({});

  const [statusChangeConfirm, setStatusChangeConfirm] = useState<{ taskId?: string; newStatus?: Task['status']; taskTitle?: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskId?: string; taskTitle?: string }>({});
  const [pcarDraft, setPcarDraft] = useState<PcarDraft>({ rootCause: '', correction: '', preventiveAction: '', targetDate: '' });

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadTasks = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getTasks({ page: targetPage, pageSize: PAGE_SIZE });
      const allTasks = res.data || [];
      setTasks(allTasks);
      const count = res.totalCount ?? res.count ?? allTasks.length ?? 0;
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
    return path ? `${path} / ${name}` : name;
  };

  const filteredDocumentOptions = documents.filter((doc) =>
    getDocumentLabel(doc).toLowerCase().includes(docSearchQuery.toLowerCase())
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
  }, [page]);

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = !statusFilter || task.status === statusFilter;
    const matchesPriority = !priorityFilter || task.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
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

  const highlightedTask = (highlightTaskId ? tasks.find((task) => task.taskId === highlightTaskId) : undefined) ?? fetchedHighlightTask ?? undefined;
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
  const myAssignedTasks = filteredTasks.filter((task) => isTaskMine(task));
  const focusedPcar = highlightedTask
    || selectedTask
    || myAssignedTasks.find((task) => task.priority === 'critical')
    || myAssignedTasks[0]
    || filteredTasks.find((task) => task.priority === 'critical')
    || filteredTasks[0];
  const focusedPcarIsMine = focusedPcar ? isTaskMine(focusedPcar) : true;

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

  // A notification's linked task may be on a different page of the paginated
  // "My Tasks" list — fetch a wide, unpaginated slice just this once instead
  // of forcing the whole page to load unpaginated by default.
  useEffect(() => {
    if (!highlightTaskId) return;
    if (tasks.some((t) => t.taskId === highlightTaskId)) return;
    apiClient.getTasks({ limit: 500 })
      .then((res) => {
        const found = (res.data || []).find((t: Task) => t.taskId === highlightTaskId);
        if (found) setFetchedHighlightTask(found);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTaskId]);
  const linkedDocument = focusedPcar?.documentId ? documents.find((d) => d.documentId === focusedPcar.documentId) : undefined;

  const handleViewLinkedDocument = () => {
    if (!linkedDocument) return;
    navigate(`/documents?preview=${encodeURIComponent(linkedDocument.documentId)}`);
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
  const [correctionUploadedTaskId, setCorrectionUploadedTaskId] = useState<string | null>(null);

  const handleUploadUpdatedLinkedDocument = async (file: File) => {
    if (!linkedDocument || !focusedPcar) return;
    try {
      const res = await apiClient.uploadDocument(linkedDocument.documentId, file);
      if (!res.success) {
        showError(res.error || 'Failed to upload the updated file');
        return;
      }

      setCorrectionUploadedTaskId(focusedPcar.taskId);

      // If this task came from a QA/Manager correction request, send the
      // approval batch back to that reviewer's queue. Tasks created the
      // regular way (not tied to an approval) simply skip this — the
      // backend rejects it with a 400 we treat as a no-op, not an error.
      try {
        const resubmitRes = await apiClient.resubmitTaskForReview(focusedPcar.taskId);
        if (resubmitRes.success) {
          showSuccess(`Uploaded the updated file — sent back to ${resubmitRes.data?.currentStage === 'manager_review' ? 'the Manager' : 'QA'} for review.`);
          loadDocuments();
          loadTasks();
          return;
        }
      } catch {
        // not linked to an approval workflow — fall through to the plain upload message
      }

      showSuccess(`Uploaded the updated file for "${linkedDocument.fileName}".`);
      loadDocuments();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload the updated file');
    }
  };

  useEffect(() => {
    if (!focusedPcar) return;
    setPcarDraft({
      rootCause: focusedPcar.taskType === 'rca' ? (focusedPcar.description || '') : '',
      correction: '',
      preventiveAction: '',
      targetDate: focusedPcar.dueDate.slice(0, 10),
    });
    setCorrectionUploadedTaskId(null);
  }, [focusedPcar?.taskId]);

  // If there's a linked document to fix, the corrected file must actually be
  // re-uploaded before the PCAR can be submitted — filling in RCA text alone
  // isn't enough to close out a correction.
  const needsCorrectionUpload = !!focusedPcar?.documentId && correctionUploadedTaskId !== focusedPcar?.taskId;

  const handlePcarSubmit = async () => {
    if (!focusedPcar) return;
    if (pcarDraft.rootCause.trim().length < 20) {
      showError('Root cause analysis must contain at least 20 characters');
      return;
    }
    if (!pcarDraft.correction.trim() || !pcarDraft.preventiveAction.trim() || !pcarDraft.targetDate) {
      showError('Complete the corrective action, preventive action, and target date');
      return;
    }

    try {
      await apiClient.updateTask(focusedPcar.taskId, {
        description: [
          `Issue: ${focusedPcar.description || focusedPcar.title}`,
          `Root cause: ${pcarDraft.rootCause.trim()}`,
          `Immediate correction: ${pcarDraft.correction.trim()}`,
          `Preventive action: ${pcarDraft.preventiveAction.trim()}`,
        ].join('\n'),
        dueDate: pcarDraft.targetDate,
        status: 'in_progress',
      });
      showSuccess('PCAR submitted for approval');
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to submit PCAR');
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
    if (!newTask.documentId) {
      showError('Document is required');
      return;
    }
    if (!newTask.assignedTo && !newTask.assignedToGroupId) {
      showError('Assignee is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiClient.createTask({
        title: newTask.title,
        description: newTask.description,
        taskType: newTask.taskType,
        riskSeverity: newTask.priority,
        documentId: newTask.documentId,
        assignedToId: newTask.assignedToGroupId ? undefined : newTask.assignedTo,
        assignedToGroupId: newTask.assignedToGroupId || undefined,
        dueDate: newTask.dueDate,
      });

      const newTaskId = res.data?.taskId;
      if (newTaskId && newTaskAttachment) {
        try {
          await apiClient.uploadTaskAttachment(newTaskId, newTaskAttachment);
        } catch {
          showError('Task created, but the attachment failed to upload');
        }
      }

      showSuccess('Task created successfully');
      setShowAddForm(false);
      setNewTask({
        title: '',
        description: '',
        taskType: 'correction',
        priority: 'medium',
        dueDate: '',
        assignedTo: DEV_USER_ID,
        assignedToGroupId: '',
        documentId: '',
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

  const handleEditTask = (task: Task) => {
    setEditingId(task.taskId);
    setEditData({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await apiClient.updateTask(editingId, editData);
      showSuccess('Task updated successfully');
      setEditingId(null);
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await apiClient.completeTask(taskId);
      showSuccess('Task marked as complete');
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
          <h1 className="page-heading">PCAR / Corrective Action</h1>
          <p className="page-subtitle">Corrective &amp; preventive action register · {taskStats.total} records</p>
        </div>
        {canCreateTasks && (
          <Button variant="primary" size="md" onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-2 inline" />
            New PCAR
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="hidden grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
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
        <div className={`grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)] ${highlightedTask && focusedPcar.taskId === highlightedTask.taskId ? 'rounded-lg ring-2 ring-[#3f8bca] ring-offset-2 dark:ring-offset-slate-950' : ''}`}>
          <div className="space-y-4">
            <Card>
              <CardBody className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="section-heading">Issue Description</h2>
                  {getAssignedToName(focusedPcar) && (
                    <span className={`rounded-[4px] px-2 py-1 text-xs font-medium ${focusedPcarIsMine ? 'bg-[#eef4fb] text-[#3f8bca] dark:bg-blue-500/15 dark:text-blue-300' : 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300'}`}>
                      Assigned to: {getAssignedToName(focusedPcar)}{focusedPcarIsMine ? ' (you)' : ''}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-[#52627a] dark:text-slate-300">{focusedPcar.description || focusedPcar.title}</p>
                {!focusedPcarIsMine && (
                  <p className="mt-3 rounded-[4px] bg-[#fff8e6] px-3 py-2 text-xs text-[#8a6116] dark:bg-amber-500/10 dark:text-amber-300">
                    This PCAR is assigned to {getAssignedToName(focusedPcar) ?? 'another user'} — only they can complete the Root Cause Analysis and submit it for approval.
                  </p>
                )}
              </CardBody>
            </Card>
            {focusedPcar.documentId && (
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
                          onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadUpdatedLinkedDocument(file); e.target.value = ''; }}
                        />
                        <Button variant="secondary" size="sm" onClick={handleViewLinkedDocument} leftIcon={<Eye className="h-3.5 w-3.5" />}>View</Button>
                        <Button variant="secondary" size="sm" onClick={handleDownloadLinkedDocument} leftIcon={<Download className="h-3.5 w-3.5" />}>Download</Button>
                        <Button variant="secondary" size="sm" onClick={handleDownloadLinkedDocumentForEditing} leftIcon={<PencilLine className="h-3.5 w-3.5" />}>Download for Editing</Button>
                        <Button variant="secondary" size="sm" onClick={() => linkedDocFileInputRef.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>Upload Updated File</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-[#94a3b8] dark:text-slate-400">Loading linked document…</p>
                  )}
                </CardBody>
              </Card>
            )}
            <Card>
              <CardBody className="p-5">
                <h2 className="section-heading">Root Cause Analysis <span className="text-[#e24c53]">*</span></h2>
                <p className="mt-2 text-xs text-[#718198] dark:text-slate-400">Mandatory. Minimum 20 characters. Use the 5-Whys method.</p>
                <textarea disabled={!focusedPcarIsMine} className="field-control mt-3 min-h-[116px] w-full py-3 disabled:cursor-not-allowed disabled:opacity-60" placeholder="Why did the deviation occur? Trace back through causes..." value={pcarDraft.rootCause} onChange={(event) => setPcarDraft({ ...pcarDraft, rootCause: event.target.value })} />
                <div className="mt-2 text-xs text-[#94a3b8] dark:text-slate-400">{pcarDraft.rootCause.trim().length} / 20 min</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-4 p-5">
                <h2 className="section-heading">Corrective &amp; Preventive Action</h2>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Immediate correction<input disabled={!focusedPcarIsMine} className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" placeholder="Quarantine affected item, reassign tasks..." value={pcarDraft.correction} onChange={(event) => setPcarDraft({ ...pcarDraft, correction: event.target.value })} /></label>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Preventive action<input disabled={!focusedPcarIsMine} className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" placeholder="Update procedure, add secondary verification..." value={pcarDraft.preventiveAction} onChange={(event) => setPcarDraft({ ...pcarDraft, preventiveAction: event.target.value })} /></label>
                <label className="block text-sm text-[#52627a] dark:text-slate-300">Target closure date<input disabled={!focusedPcarIsMine} type="date" className="field-control mt-2 h-10 w-full disabled:cursor-not-allowed disabled:opacity-60" value={pcarDraft.targetDate} onChange={(event) => setPcarDraft({ ...pcarDraft, targetDate: event.target.value })} /></label>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <div className="flex justify-end"><span className={`rounded-[5px] px-3 py-2 text-sm font-semibold ${focusedPcar.priority === 'critical' ? 'bg-[#fde1e2] text-[#c73c44] dark:bg-red-500/15 dark:text-red-300' : 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300'}`}>Severity: {focusedPcar.priority}</span></div>
            <Card>
              <CardBody className="p-5">
                <h2 className="section-heading">Approvers</h2>
                <div className="mt-4 space-y-3 text-sm text-[#52627a] dark:text-slate-300"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#efb514]" />QA Lead — pending</div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#cbd5e3]" />Plant Manager — waiting</div></div>
              </CardBody>
            </Card>
            <Button
              className="w-full"
              onClick={handlePcarSubmit}
              disabled={!focusedPcarIsMine || needsCorrectionUpload}
              title={
                !focusedPcarIsMine
                  ? `Only ${getAssignedToName(focusedPcar) ?? 'the assignee'} can submit this PCAR`
                  : needsCorrectionUpload
                    ? 'Upload the corrected file first — see Linked Document above'
                    : undefined
              }
            >
              Submit for approval
            </Button>
            {needsCorrectionUpload && focusedPcarIsMine && (
              <p className="text-center text-xs text-[#b96a08] dark:text-amber-300">Upload the corrected file above before submitting.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1"><h2 className="section-heading">PCAR Register</h2></div>

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
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Title</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Submitted By</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Assigned To</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Priority</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Due Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Type</th>
                  {canManageAllTasks && (
                    <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={canManageAllTasks ? 8 : 7} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
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
                        {editingId === task.taskId ? (
                          <input
                            type="text"
                            value={editData.title || ''}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          />
                        ) : (
                          <div>
                            <p className="font-medium text-navy-900 dark:text-white">{task.title}</p>
                            {task.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400">{task.description}</p>
                            )}
                            {canManageAllTasks && (
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
                        <span className={`text-sm ${isTaskMine(task) ? 'font-medium text-[#3f8bca]' : 'text-gray-600 dark:text-gray-400'}`}>
                          {getAssignedToName(task) ?? '—'}{isTaskMine(task) ? ' (you)' : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={getStatusBadgeColor(task.status)} variant="outline">
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId ? (
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
                        {editingId === task.taskId ? (
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
                        <span className="text-sm text-gray-600 dark:text-gray-400">{task.taskType.replace('_', ' ')}</span>
                      </td>
                      {canManageAllTasks && (
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
                          ) : (
                            <>
                              {task.status !== 'done' && (
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
                              <button
                                onClick={() => setDeleteConfirm({ taskId: task.taskId, taskTitle: task.title })}
                                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
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

      {/* Add Task Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-xl font-serif font-bold text-navy-900 dark:text-white">Create New Task</h2>
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

              <div ref={docPickerRef} className="relative">
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Document *</label>
                <input
                  type="text"
                  placeholder="Search by file name or folder path..."
                  value={docSearchQuery}
                  onFocus={() => setShowDocDropdown(true)}
                  onChange={(e) => {
                    setDocSearchQuery(e.target.value);
                    setShowDocDropdown(true);
                    if (newTask.documentId) setNewTask({ ...newTask, documentId: '' });
                  }}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {showDocDropdown && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-navy-700 dark:bg-navy-900">
                    {filteredDocumentOptions.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No matching documents</p>
                    ) : (
                      filteredDocumentOptions.map((doc) => (
                        <button
                          type="button"
                          key={doc.documentId}
                          onClick={() => {
                            setNewTask({ ...newTask, documentId: doc.documentId });
                            setDocSearchQuery(getDocumentLabel(doc));
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Type</label>
                  <select
                    value={newTask.taskType}
                    onChange={(e) => setNewTask({ ...newTask, taskType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    <option value="correction">Correction</option>
                    <option value="rca">RCA</option>
                    <option value="audit_action">Audit Action</option>
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
                  onClick={() => { setShowAddForm(false); setNewTaskAttachment(null); setDocSearchQuery(''); setShowDocDropdown(false); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateTask}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Task'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Status Change Confirmation Modal */}
      {statusChangeConfirm.taskId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
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
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.taskId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
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
        </div>
      )}

      {attachmentsFor && (
        <TaskAttachmentsModal
          taskId={attachmentsFor.taskId}
          taskTitle={attachmentsFor.title}
          onClose={() => setAttachmentsFor(null)}
        />
      )}
    </div>
  );
}
