import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Button, Badge } from '../ui';
import { Spinner } from '../ui/Skeleton';
import { X, AlertCircle, Eye, Download, FileCheck2, FileX2, Upload, Loader2, Sparkles, FilePen } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { doclingApi } from '../../services/doclingApi';
import { EditDocumentModal } from './EditDocumentModal';
import { usePageAccess } from '../../hooks/usePageAccess';

// One document's place in the C-Doc Workflow — stage/status is tracked per
// document (see 058_approval_document_stage_tracking.sql), independent of any
// other document that happened to be submitted in the same batch.
interface ApprovalDocumentDetail {
  approvalId: string;
  documentId: string;
  versionId: string;
  createdBy: string;
  createdByUserName?: string;
  createdAt: string;
  currentStage: string;
  status: string;
  qaNotes?: string | null;
  managerNotes?: string | null;
  releaseNotes?: string | null;
  fileName: string;
  ownerName: string;
  department?: string | null;
  category?: string | null;
  originalDocumentId?: string | null;
  versionNumber?: string | null;
  fileSizeBytes?: number | null;
  sha256Hash?: string | null;
  linkedTask?: { taskId: string; title: string; status: string; assigneeName?: string | null } | null;
  blocked?: boolean;
}

interface ApprovalDetailViewProps {
  approvalId: string;
  documentId: string;
  users: Array<{ userId: string; fullName: string }>;
  groups: Array<{ groupId: string; name: string }>;
  onClose: () => void;
  onChanged: () => void;
}

const STAGE_LABEL: Record<string, string> = {
  qa_review: 'QA Review (Stage 1)',
  manager_review: 'Manager Review (Stage 2)',
  final_release: 'Final Release (Stage 3)',
  released: 'Released',
  rejected: 'Rejected',
};

function formatBytes(bytes?: number | null) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function ApprovalDetailView({ approvalId, documentId, users, groups, onClose, onChanged }: ApprovalDetailViewProps) {
  const navigate = useNavigate();
  const access = usePageAccess();
  const canApprove = access?.canApprove ?? false;
  const canReject = access?.canReject ?? false;
  const [item, setItem] = useState<ApprovalDocumentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shared decision-form state
  const [mode, setMode] = useState<'view' | 'accept' | 'correction' | 'self-correct'>('view');
  const [notes, setNotes] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskType, setTaskType] = useState('correction');
  const [priority, setPriority] = useState('high');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [assignToGroupId, setAssignToGroupId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [correctionTaskAttachment, setCorrectionTaskAttachment] = useState<File | null>(null);
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const [releaseNotes, setReleaseNotes] = useState('');
  const [editDocumentId, setEditDocumentId] = useState<string | null>(null);

  // First Review (QA) requirement: this document needs a Document ID before QA
  // can accept it. Regular uploaders never see this field at upload time — this
  // is where QA/Admin resolves it, either by typing the real ID or generating one.
  const [docId, setDocId] = useState('');
  const [manualDocIdInput, setManualDocIdInput] = useState('');
  const [docIdBusy, setDocIdBusy] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getApproval(approvalId, documentId);
      if (!res.success) throw new Error(res.error);
      setItem(res.data);
      setDocId(res.data.originalDocumentId || '');
      setManualDocIdInput(res.data.originalDocumentId || '');
    } catch (err: any) {
      setLoadError(err?.response?.data?.error || err.message || 'Failed to load approval');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId, documentId]);

  const resetForm = () => {
    setMode('view');
    setNotes('');
    setTaskTitle('');
    setTaskDescription('');
    setTaskType('correction');
    setPriority('high');
    setAssignToUserId('');
    setAssignToGroupId('');
    setDueDate('');
    setCorrectionTaskAttachment(null);
    setCorrectionFile(null);
    setReleaseNotes('');
    setActionError(null);
  };

  const runAction = async (fn: () => Promise<any>, afterSuccess?: (data: any) => Promise<void>) => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res && res.success === false) throw new Error(res.error);
      if (afterSuccess) await afterSuccess(res.data);
      onChanged();
      onClose();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err.message || 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const docIdResolved = Boolean(docId.trim());

  const handleGenerateDocId = async () => {
    setDocIdBusy(true);
    setActionError(null);
    try {
      const alreadyHasId = docIdResolved;
      let extractedFromFile: string | null = null;

      // Only bother re-scanning the file itself when there's no ID yet — once QA has
      // set one, "Generate New ID" means a fresh system sequence, not another parse.
      if (!alreadyHasId && item?.versionId) {
        try {
          const { blob, fileName } = await apiClient.getDocumentFile(documentId, item.versionId);
          const file = new File([blob], fileName);
          const { content } = await doclingApi.convertDocument(file);
          const extractRes = await apiClient.extractDocId(documentId, content);
          if (extractRes.success && extractRes.data.found) {
            extractedFromFile = extractRes.data.originalDocumentId;
          }
        } catch {
          // Re-parsing failed — fall through to system-generated sequence below.
        }
      }

      if (extractedFromFile) {
        setDocId(extractedFromFile);
        setManualDocIdInput(extractedFromFile);
        return;
      }

      const res = await apiClient.generateDocId(documentId);
      if (res.success) {
        setDocId(res.data.originalDocumentId);
        setManualDocIdInput(res.data.originalDocumentId);
      } else {
        setActionError(res.error || 'Failed to generate Document ID');
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.error || 'Failed to generate Document ID');
    } finally {
      setDocIdBusy(false);
    }
  };

  const handleSetDocId = async () => {
    const value = manualDocIdInput.trim();
    if (!value) return;
    setDocIdBusy(true);
    setActionError(null);
    try {
      const res = await apiClient.setDocId(documentId, value);
      if (res.success) {
        setDocId(res.data.originalDocumentId);
      } else {
        setActionError(res.error || 'Failed to save Document ID');
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.error || 'Failed to save Document ID');
    } finally {
      setDocIdBusy(false);
    }
  };

  const handleQaAccept = () => runAction(() => apiClient.qaAcceptApproval(approvalId, documentId, notes || undefined));

  const handleQaCorrection = () => {
    if (!taskTitle.trim() || !taskDescription.trim() || (!assignToUserId && !assignToGroupId) || !dueDate) {
      setActionError('Task title, description, assignee, and due date are all required');
      return;
    }
    return runAction(
      () => apiClient.qaRequestCorrection(approvalId, documentId, taskTitle, taskDescription, { userId: assignToUserId || undefined, groupId: assignToGroupId || undefined }, dueDate, notes || undefined, taskType, priority),
      async (data) => { if (data?.taskId && correctionTaskAttachment) await apiClient.uploadTaskAttachment(data.taskId, correctionTaskAttachment); },
    );
  };

  const handleManagerApprove = () => runAction(() => apiClient.managerApprove(approvalId, documentId, notes || undefined));

  const handleManagerRejectTask = () => {
    if (!taskTitle.trim() || !taskDescription.trim() || (!assignToUserId && !assignToGroupId) || !dueDate) {
      setActionError('Task title, description, assignee, and due date are all required');
      return;
    }
    return runAction(
      () => apiClient.managerRejectWithCorrection(approvalId, documentId, notes || 'Corrections required', taskTitle, taskDescription, { userId: assignToUserId || undefined, groupId: assignToGroupId || undefined }, dueDate, taskType, priority),
      async (data) => { if (data?.taskId && correctionTaskAttachment) await apiClient.uploadTaskAttachment(data.taskId, correctionTaskAttachment); },
    );
  };

  const handleManagerSelfCorrect = () => {
    if (!correctionFile) {
      setActionError('Choose the corrected file to upload');
      return;
    }
    return runAction(() => apiClient.managerSelfCorrect(approvalId, documentId, correctionFile, notes || 'Corrected directly by manager'));
  };

  const handleFinalRelease = () => runAction(() => apiClient.qaFinalRelease(approvalId, documentId, releaseNotes || undefined));

  const handleQaFinalReject = () => {
    if (!taskTitle.trim() || !taskDescription.trim() || (!assignToUserId && !assignToGroupId) || !dueDate) {
      setActionError('Task title, description, assignee, and due date are all required');
      return;
    }
    return runAction(
      () => apiClient.qaFinalReject(approvalId, documentId, notes || 'Corrections required', taskTitle, taskDescription, { userId: assignToUserId || undefined, groupId: assignToGroupId || undefined }, dueDate, taskType, priority),
      async (data) => { if (data?.taskId && correctionTaskAttachment) await apiClient.uploadTaskAttachment(data.taskId, correctionTaskAttachment); },
    );
  };

  const handlePreview = () => navigate(`/documents?preview=${encodeURIComponent(documentId)}`);
  const handleDownload = () => { if (item) apiClient.downloadDocument(documentId, item.versionId).catch(() => {}); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[97vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Approval Review</h2>
            {item && (
              <p className="text-sm text-gray-500 dark:text-slate-400">{STAGE_LABEL[item.currentStage] ?? item.currentStage}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Spinner />
            </div>
          )}

          {loadError && (
            <Card className="border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20">
              <CardBody>
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                  <div>
                    <p className="text-red-700 dark:text-red-300">{loadError}</p>
                    <Button variant="secondary" size="sm" onClick={load} className="mt-3">Retry</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {item && !isLoading && (
            <>
              <div className="text-sm text-gray-600 dark:text-slate-400">
                Submitted by <span className="font-medium text-navy-900 dark:text-white">{item.createdByUserName || 'Unknown'}</span> on{' '}
                {new Date(item.createdAt).toLocaleString()}
              </div>

              {item.linkedTask && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <strong>Blocked by an open task</strong> — "{item.linkedTask.title}" is still {item.linkedTask.status}, assigned to {item.linkedTask.assigneeName ?? 'Unassigned'}. This document can't be approved until it's completed.
                  </div>
                </div>
              )}

              <Card className="overflow-hidden">
                <CardBody className="space-y-2 !py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={handlePreview}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Open ${item.fileName}`}
                    >
                      <p className="font-medium text-navy-900 hover:underline dark:text-white">{item.fileName}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        v{item.versionNumber || '1.0'} · {formatBytes(item.fileSizeBytes)} · {item.ownerName}
                      </p>
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePreview}
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleDownload}
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditDocumentId(documentId)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        title="Edit"
                      >
                        <FilePen className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-slate-400">
                    {item.department && <Badge status="default" variant="outline">{item.department}</Badge>}
                    {item.category && <Badge status="default" variant="outline">{item.category}</Badge>}
                    <span title={documentId}>Doc ID: {item.originalDocumentId || 'Not set'}</span>
                  </div>
                </CardBody>
              </Card>

              {(item.qaNotes || item.managerNotes) && (
                <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                  {item.qaNotes && <p><span className="font-medium text-navy-900 dark:text-white">QA notes:</span> {item.qaNotes}</p>}
                  {item.managerNotes && <p><span className="font-medium text-navy-900 dark:text-white">Manager notes:</span> {item.managerNotes}</p>}
                </div>
              )}

              {actionError && (
                <div className="flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {actionError}
                </div>
              )}

              {/* ---- Stage 1: QA Review ---- */}
              {item.currentStage === 'qa_review' && mode === 'view' && (
                <div className="flex gap-3">
                  <Button onClick={() => setMode('accept')} disabled={isSubmitting || !canApprove || item?.blocked} title={!canApprove ? 'Your role does not have Approve permission' : undefined} className="flex-1">
                    <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Accept &amp; Send to Manager
                  </Button>
                  <Button onClick={() => setMode('correction')} disabled={isSubmitting || !canReject} title={!canReject ? 'Your role does not have Reject permission' : undefined} variant="secondary" className="flex-1">
                    <FileX2 className="mr-1.5 inline h-4 w-4" /> Request Correction
                  </Button>
                </div>
              )}

              {item.currentStage === 'qa_review' && mode === 'accept' && (
                <DecisionForm
                  title="Accept for Manager Review"
                  onCancel={resetForm}
                  onSubmit={handleQaAccept}
                  submitLabel="Confirm Accept"
                  isSubmitting={isSubmitting}
                  submitDisabled={!docIdResolved || !canApprove || item?.blocked}
                  submitTitle={!canApprove ? 'Your role does not have Approve permission' : 'This document needs a Document ID before QA can accept'}
                >
                  <DocIdResolutionPanel
                    fileName={item.fileName}
                    docId={docId}
                    manualDocIdInput={manualDocIdInput}
                    setManualDocIdInput={setManualDocIdInput}
                    busy={docIdBusy}
                    onGenerate={handleGenerateDocId}
                    onSave={handleSetDocId}
                    isSubmitting={isSubmitting}
                  />
                  <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} />
                </DecisionForm>
              )}

              {item.currentStage === 'qa_review' && mode === 'correction' && (
                <CorrectionTaskForm
                  users={users}
                  groups={groups}
                  taskTitle={taskTitle} setTaskTitle={setTaskTitle}
                  taskDescription={taskDescription} setTaskDescription={setTaskDescription}
                  taskType={taskType} setTaskType={setTaskType}
                  priority={priority} setPriority={setPriority}
                  assignToUserId={assignToUserId} setAssignToUserId={setAssignToUserId}
                  assignToGroupId={assignToGroupId} setAssignToGroupId={setAssignToGroupId}
                  dueDate={dueDate} setDueDate={setDueDate}
                  attachment={correctionTaskAttachment} setAttachment={setCorrectionTaskAttachment}
                  notes={notes} setNotes={setNotes}
                  onCancel={resetForm}
                  onSubmit={handleQaCorrection}
                  isSubmitting={isSubmitting}
                  submitDisabled={!canReject}
                  submitTitle={!canReject ? 'Your role does not have Reject permission' : undefined}
                />
              )}

              {/* ---- Stage 2: Manager Review ---- */}
              {item.currentStage === 'manager_review' && mode === 'view' && (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => setMode('accept')} disabled={isSubmitting || !canApprove || item?.blocked} title={!canApprove ? 'Your role does not have Approve permission' : undefined} className="flex-1">
                    <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Approve
                  </Button>
                  <Button onClick={() => setMode('correction')} disabled={isSubmitting || !canReject} title={!canReject ? 'Your role does not have Reject permission' : undefined} variant="secondary" className="flex-1">
                    <FileX2 className="mr-1.5 inline h-4 w-4" /> Reject — Assign Correction Task
                  </Button>
                  <Button onClick={() => setMode('self-correct')} disabled={isSubmitting || !canReject} title={!canReject ? 'Your role does not have Reject permission' : undefined} variant="secondary" className="flex-1">
                    <Upload className="mr-1.5 inline h-4 w-4" /> Reject — Fix It Myself
                  </Button>
                </div>
              )}

              {item.currentStage === 'manager_review' && mode === 'accept' && (
                <DecisionForm
                  title="Approve for Final Release"
                  onCancel={resetForm}
                  onSubmit={handleManagerApprove}
                  submitLabel="Confirm Approve"
                  isSubmitting={isSubmitting}
                  submitDisabled={!canApprove || item?.blocked}
                  submitTitle={!canApprove ? 'Your role does not have Approve permission' : undefined}
                >
                  <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} />
                </DecisionForm>
              )}

              {item.currentStage === 'manager_review' && mode === 'correction' && (
                <CorrectionTaskForm
                  users={users}
                  groups={groups}
                  taskTitle={taskTitle} setTaskTitle={setTaskTitle}
                  taskDescription={taskDescription} setTaskDescription={setTaskDescription}
                  taskType={taskType} setTaskType={setTaskType}
                  priority={priority} setPriority={setPriority}
                  assignToUserId={assignToUserId} setAssignToUserId={setAssignToUserId}
                  assignToGroupId={assignToGroupId} setAssignToGroupId={setAssignToGroupId}
                  dueDate={dueDate} setDueDate={setDueDate}
                  attachment={correctionTaskAttachment} setAttachment={setCorrectionTaskAttachment}
                  notes={notes} setNotes={setNotes}
                  notesLabel="Rejection reason"
                  onCancel={resetForm}
                  onSubmit={handleManagerRejectTask}
                  isSubmitting={isSubmitting}
                  submitDisabled={!canReject}
                  submitTitle={!canReject ? 'Your role does not have Reject permission' : undefined}
                />
              )}

              {item.currentStage === 'manager_review' && mode === 'self-correct' && (
                <DecisionForm
                  title="Upload Corrected File"
                  onCancel={resetForm}
                  onSubmit={handleManagerSelfCorrect}
                  submitLabel="Upload &amp; Send to Final Release"
                  isSubmitting={isSubmitting}
                  submitDisabled={!canReject}
                  submitTitle={!canReject ? 'Your role does not have Reject permission' : undefined}
                >
                  <div>
                    <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Corrected file</label>
                    <input
                      type="file"
                      onChange={(e) => setCorrectionFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-600 dark:text-slate-300"
                    />
                  </div>
                  <TextAreaField label="Reason for correction" value={notes} onChange={setNotes} />
                </DecisionForm>
              )}

              {/* ---- Stage 3: Final Release ---- */}
              {item.currentStage === 'final_release' && mode === 'view' && (
                <div className="flex gap-3">
                  <Button onClick={() => setMode('accept')} disabled={isSubmitting || !canApprove || item?.blocked} title={!canApprove ? 'Your role does not have Approve permission' : undefined} className="flex-1">
                    <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Final Release
                  </Button>
                  <Button onClick={() => setMode('correction')} disabled={isSubmitting || !canReject} title={!canReject ? 'Your role does not have Reject permission' : undefined} variant="secondary" className="flex-1">
                    <FileX2 className="mr-1.5 inline h-4 w-4" /> Reject — Assign Correction Task
                  </Button>
                </div>
              )}

              {item.currentStage === 'final_release' && mode === 'accept' && (
                <DecisionForm
                  title="Final Release"
                  onCancel={resetForm}
                  onSubmit={handleFinalRelease}
                  submitLabel="Release Document"
                  isSubmitting={isSubmitting}
                  submitDisabled={!canApprove || item?.blocked}
                  submitTitle={!canApprove ? 'Your role does not have Approve permission' : undefined}
                >
                  <TextAreaField label="Release notes (optional)" value={releaseNotes} onChange={setReleaseNotes} />
                </DecisionForm>
              )}

              {item.currentStage === 'final_release' && mode === 'correction' && (
                <CorrectionTaskForm
                  users={users}
                  groups={groups}
                  taskTitle={taskTitle} setTaskTitle={setTaskTitle}
                  taskDescription={taskDescription} setTaskDescription={setTaskDescription}
                  taskType={taskType} setTaskType={setTaskType}
                  priority={priority} setPriority={setPriority}
                  assignToUserId={assignToUserId} setAssignToUserId={setAssignToUserId}
                  assignToGroupId={assignToGroupId} setAssignToGroupId={setAssignToGroupId}
                  dueDate={dueDate} setDueDate={setDueDate}
                  attachment={correctionTaskAttachment} setAttachment={setCorrectionTaskAttachment}
                  notes={notes} setNotes={setNotes}
                  notesLabel="Rejection reason"
                  onCancel={resetForm}
                  onSubmit={handleQaFinalReject}
                  isSubmitting={isSubmitting}
                  submitDisabled={!canReject}
                  submitTitle={!canReject ? 'Your role does not have Reject permission' : undefined}
                />
              )}

              {item.currentStage === 'released' && (
                <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300">
                  Released.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {editDocumentId && (
        <EditDocumentModal
          documentId={editDocumentId}
          fileName={item?.fileName ?? ''}
          onClose={() => setEditDocumentId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function DecisionForm({
  title, children, onCancel, onSubmit, submitLabel, isSubmitting, submitDisabled, submitTitle,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  submitTitle?: string;
}) {
  return (
    <Card className="border border-blue-200 dark:border-blue-900">
      <CardBody className="space-y-2 !py-3">
        <h3 className="font-medium text-navy-900 dark:text-white">{title}</h3>
        {children}
        <div className="flex gap-3 pt-1">
          <Button onClick={onSubmit} disabled={isSubmitting || submitDisabled} title={submitDisabled ? submitTitle : undefined} className="flex-1">{isSubmitting ? 'Submitting…' : submitLabel}</Button>
          <Button onClick={onCancel} disabled={isSubmitting} variant="secondary" className="flex-1">Cancel</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function DocIdResolutionPanel({
  fileName, docId, manualDocIdInput, setManualDocIdInput, busy, onGenerate, onSave, isSubmitting,
}: {
  fileName: string;
  docId: string;
  manualDocIdInput: string;
  setManualDocIdInput: (value: string) => void;
  busy: boolean;
  onGenerate: () => void;
  onSave: () => void;
  isSubmitting: boolean;
}) {
  const isMissing = !docId.trim();

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${isMissing ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50'}`}>
      <p className={`text-sm font-medium ${isMissing ? 'text-amber-900 dark:text-amber-300' : 'text-gray-700 dark:text-slate-300'}`}>
        {isMissing ? 'Document ID required before accepting' : 'Document ID — edit if a wrong value was extracted'}
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-white/60 p-2 dark:bg-slate-900/40">
        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-slate-300" title={fileName}>{fileName}</span>
        {!isMissing && (
          <span className="whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            {docId}
          </span>
        )}
        <input
          type="text"
          placeholder="Original Document ID"
          value={manualDocIdInput}
          onChange={(e) => setManualDocIdInput(e.target.value)}
          disabled={busy || isSubmitting}
          className="w-36 rounded border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <Button type="button" size="sm" variant="secondary" onClick={onSave} disabled={!manualDocIdInput.trim() || busy || isSubmitting}>
          {isMissing ? 'Save' : 'Correct'}
        </Button>
        <Button type="button" size="sm" onClick={onGenerate} disabled={busy || isSubmitting}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span className="ml-1">{isMissing ? 'Generate from System' : 'Generate New ID'}</span>
        </Button>
      </div>
    </div>
  );
}

// Mirrors the fields on the "Create New Task" (New PCAR) modal in Tasks.tsx —
// per explicit request, rejecting from any C-Doc Workflow stage should feel
// like filing a real PCAR, not a stripped-down form with only a title and an
// assignee. Document is implicit here (it's the one being reviewed).
function CorrectionTaskForm({
  users, groups, taskTitle, setTaskTitle, taskDescription, setTaskDescription,
  taskType, setTaskType, priority, setPriority,
  assignToUserId, setAssignToUserId, assignToGroupId, setAssignToGroupId, dueDate, setDueDate,
  attachment, setAttachment, notes, setNotes,
  notesLabel = 'Notes (optional)', onCancel, onSubmit, isSubmitting, submitDisabled, submitTitle,
}: {
  users: Array<{ userId: string; fullName: string }>;
  groups: Array<{ groupId: string; name: string }>;
  taskTitle: string; setTaskTitle: (v: string) => void;
  taskDescription: string; setTaskDescription: (v: string) => void;
  taskType: string; setTaskType: (v: string) => void;
  priority: string; setPriority: (v: string) => void;
  assignToUserId: string; setAssignToUserId: (v: string) => void;
  assignToGroupId: string; setAssignToGroupId: (v: string) => void;
  dueDate: string; setDueDate: (v: string) => void;
  attachment: File | null; setAttachment: (f: File | null) => void;
  notes: string; setNotes: (v: string) => void;
  notesLabel?: string;
  onCancel: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  submitTitle?: string;
}) {
  return (
    <DecisionForm title="Correction Task" onCancel={onCancel} onSubmit={onSubmit} submitLabel="Send Correction Task" isSubmitting={isSubmitting} submitDisabled={submitDisabled} submitTitle={submitTitle}>
      <TextField label="Task title" value={taskTitle} onChange={setTaskTitle} />
      <TextAreaField label="Task description" value={taskDescription} onChange={setTaskDescription} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="correction">Correction</option>
            <option value="rca">RCA</option>
            <option value="audit_action">Audit Action</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Assign to</label>
          <select
            value={assignToGroupId ? `group:${assignToGroupId}` : assignToUserId ? `user:${assignToUserId}` : ''}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              setAssignToUserId(kind === 'user' ? id : '');
              setAssignToGroupId(kind === 'group' ? id : '');
            }}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Select user or group…</option>
            <optgroup label="Users">
              {users.map((u) => (
                <option key={u.userId} value={`user:${u.userId}`}>{u.fullName}</option>
              ))}
            </optgroup>
            {groups.length > 0 && (
              <optgroup label="Groups">
                {groups.map((g) => (
                  <option key={g.groupId} value={`group:${g.groupId}`}>{g.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <TextField label="Due date" type="date" value={dueDate} onChange={setDueDate} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Attachment</label>
        <input
          type="file"
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-600 dark:text-slate-300"
        />
        {attachment && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{attachment.name}</p>}
      </div>
      <TextAreaField label={notesLabel} value={notes} onChange={setNotes} />
    </DecisionForm>
  );
}

function TextField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
    </div>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
    </div>
  );
}
