import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Button, Badge } from '../ui';
import { Spinner } from '../ui/Skeleton';
import { X, AlertCircle, Eye, Download, FileCheck2, FileX2, Upload, Loader2, Sparkles, FilePen } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { doclingApi } from '../../services/doclingApi';
import { EditDocumentModal } from './EditDocumentModal';

interface ApprovalDocument {
  documentId: string;
  versionId: string;
  fileName: string;
  ownerName: string;
  department?: string | null;
  category?: string | null;
  originalDocumentId?: string | null;
  status?: string | null;
  versionNumber?: string | null;
  fileSizeBytes?: number | null;
  sha256Hash?: string | null;
}

interface ApprovalDetail {
  approvalId: string;
  createdBy: string;
  createdByUserName?: string;
  createdAt: string;
  currentStage: string;
  status: string;
  qaNotes?: string | null;
  managerNotes?: string | null;
  releaseNotes?: string | null;
  documents: ApprovalDocument[];
}

interface ApprovalDetailViewProps {
  approvalId: string;
  users: Array<{ userId: string; fullName: string }>;
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

export function ApprovalDetailView({ approvalId, users, onClose, onChanged }: ApprovalDetailViewProps) {
  const navigate = useNavigate();
  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shared decision-form state
  const [mode, setMode] = useState<'view' | 'accept' | 'correction' | 'self-correct'>('view');
  const [notes, setNotes] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [correctionFile, setCorrectionFile] = useState<File | null>(null);
  const [releaseNotes, setReleaseNotes] = useState('');
  const [editDocumentId, setEditDocumentId] = useState<string | null>(null);

  // First Review (QA) requirement: every document needs a Document ID before
  // QA can accept. Regular uploaders never see this field at upload time — this
  // is where QA/Admin resolves it, either by typing the real ID or generating one.
  const [docIds, setDocIds] = useState<Record<string, string>>({});
  const [manualDocIdInput, setManualDocIdInput] = useState<Record<string, string>>({});
  const [docIdBusy, setDocIdBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getApproval(approvalId);
      if (!res.success) throw new Error(res.error);
      setApproval(res.data);
      setDocIds(Object.fromEntries(res.data.documents.map((d: ApprovalDocument) => [d.documentId, d.originalDocumentId || ''])));
      setManualDocIdInput(Object.fromEntries(res.data.documents.map((d: ApprovalDocument) => [d.documentId, d.originalDocumentId || ''])));
    } catch (err: any) {
      setLoadError(err?.response?.data?.error || err.message || 'Failed to load approval');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId]);

  const resetForm = () => {
    setMode('view');
    setNotes('');
    setTaskTitle('');
    setTaskDescription('');
    setAssignToUserId('');
    setDueDate('');
    setCorrectionFile(null);
    setReleaseNotes('');
    setActionError(null);
  };

  const runAction = async (fn: () => Promise<any>) => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res && res.success === false) throw new Error(res.error);
      onChanged();
      onClose();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err.message || 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const missingDocIdDocuments = (approval?.documents ?? []).filter((d) => !docIds[d.documentId]?.trim());
  const allDocIdsResolved = missingDocIdDocuments.length === 0;

  const handleGenerateDocId = async (documentId: string) => {
    setDocIdBusy((prev) => ({ ...prev, [documentId]: true }));
    setActionError(null);
    try {
      const alreadyHasId = Boolean(docIds[documentId]?.trim());
      const document = approval?.documents.find((d) => d.documentId === documentId);
      let extractedFromFile: string | null = null;

      // Only bother re-scanning the file itself when there's no ID yet — once QA has
      // set one, "Generate New ID" means a fresh system sequence, not another parse.
      if (!alreadyHasId && document?.versionId) {
        try {
          const { blob, fileName } = await apiClient.getDocumentFile(documentId, document.versionId);
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
        setDocIds((prev) => ({ ...prev, [documentId]: extractedFromFile! }));
        setManualDocIdInput((prev) => ({ ...prev, [documentId]: extractedFromFile! }));
        return;
      }

      const res = await apiClient.generateDocId(documentId);
      if (res.success) {
        setDocIds((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
        setManualDocIdInput((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
      } else {
        setActionError(res.error || 'Failed to generate Document ID');
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.error || 'Failed to generate Document ID');
    } finally {
      setDocIdBusy((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  const handleSetDocId = async (documentId: string) => {
    const value = manualDocIdInput[documentId]?.trim();
    if (!value) return;
    setDocIdBusy((prev) => ({ ...prev, [documentId]: true }));
    setActionError(null);
    try {
      const res = await apiClient.setDocId(documentId, value);
      if (res.success) {
        setDocIds((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
      } else {
        setActionError(res.error || 'Failed to save Document ID');
      }
    } catch (err: any) {
      setActionError(err?.response?.data?.error || 'Failed to save Document ID');
    } finally {
      setDocIdBusy((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  const handleQaAccept = () => runAction(() => apiClient.qaAcceptApproval(approvalId, notes || undefined));

  const handleQaCorrection = () => {
    if (!taskTitle.trim() || !taskDescription.trim() || !assignToUserId || !dueDate) {
      setActionError('Task title, description, assignee, and due date are all required');
      return;
    }
    return runAction(() => apiClient.qaRequestCorrection(approvalId, taskTitle, taskDescription, assignToUserId, dueDate, notes || undefined));
  };

  const handleManagerApprove = () => runAction(() => apiClient.managerApprove(approvalId, notes || undefined));

  const handleManagerRejectTask = () => {
    if (!taskTitle.trim() || !taskDescription.trim() || !assignToUserId || !dueDate) {
      setActionError('Task title, description, assignee, and due date are all required');
      return;
    }
    return runAction(() => apiClient.managerRejectWithCorrection(approvalId, notes || 'Corrections required', taskTitle, taskDescription, assignToUserId, dueDate));
  };

  const handleManagerSelfCorrect = () => {
    if (!correctionFile) {
      setActionError('Choose the corrected file to upload');
      return;
    }
    return runAction(() => apiClient.managerSelfCorrect(approvalId, correctionFile, notes || 'Corrected directly by manager'));
  };

  const handleFinalRelease = () => runAction(() => apiClient.qaFinalRelease(approvalId, releaseNotes || undefined));

  const handlePreview = (documentId: string) => navigate(`/documents?preview=${encodeURIComponent(documentId)}`);
  const handleDownload = (documentId: string, versionId: string) => apiClient.downloadDocument(documentId, versionId).catch(() => {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Approval Review</h2>
            {approval && (
              <p className="text-sm text-gray-500 dark:text-slate-400">{STAGE_LABEL[approval.currentStage] ?? approval.currentStage}</p>
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

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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

          {approval && !isLoading && (
            <>
              <div className="text-sm text-gray-600 dark:text-slate-400">
                Submitted by <span className="font-medium text-navy-900 dark:text-white">{approval.createdByUserName || 'Unknown'}</span> on{' '}
                {new Date(approval.createdAt).toLocaleString()}
              </div>

              <div className="space-y-3">
                {approval.documents.map((doc) => (
                  <Card key={doc.documentId} className="overflow-hidden">
                    <CardBody className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-navy-900 dark:text-white">{doc.fileName}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">
                            v{doc.versionNumber || '1.0'} · {formatBytes(doc.fileSizeBytes)} · {doc.ownerName}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handlePreview(doc.documentId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            title="Preview"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDownload(doc.documentId, doc.versionId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditDocumentId(doc.documentId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            title="Edit"
                          >
                            <FilePen className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-slate-400">
                        {doc.department && <Badge status="default" variant="outline">{doc.department}</Badge>}
                        {doc.category && <Badge status="default" variant="outline">{doc.category}</Badge>}
                        <span title={doc.documentId}>Doc ID: {doc.originalDocumentId || 'Not set'}</span>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>

              {(approval.qaNotes || approval.managerNotes) && (
                <div className="space-y-1 rounded border border-gray-200 bg-gray-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                  {approval.qaNotes && <p><span className="font-medium text-navy-900 dark:text-white">QA notes:</span> {approval.qaNotes}</p>}
                  {approval.managerNotes && <p><span className="font-medium text-navy-900 dark:text-white">Manager notes:</span> {approval.managerNotes}</p>}
                </div>
              )}

              {actionError && (
                <div className="flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {actionError}
                </div>
              )}

              {/* ---- Stage 1: QA Review ---- */}
              {approval.currentStage === 'qa_review' && mode === 'view' && (
                <div className="flex gap-3">
                  <Button onClick={() => setMode('accept')} disabled={isSubmitting} className="flex-1">
                    <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Accept &amp; Send to Manager
                  </Button>
                  <Button onClick={() => setMode('correction')} disabled={isSubmitting} variant="secondary" className="flex-1">
                    <FileX2 className="mr-1.5 inline h-4 w-4" /> Request Correction
                  </Button>
                </div>
              )}

              {approval.currentStage === 'qa_review' && mode === 'accept' && (
                <DecisionForm
                  title="Accept for Manager Review"
                  onCancel={resetForm}
                  onSubmit={handleQaAccept}
                  submitLabel="Confirm Accept"
                  isSubmitting={isSubmitting}
                  submitDisabled={!allDocIdsResolved}
                  submitTitle="Every document needs a Document ID before QA can accept"
                >
                  <DocIdResolutionPanel
                    documents={approval.documents}
                    docIds={docIds}
                    manualDocIdInput={manualDocIdInput}
                    setManualDocIdInput={setManualDocIdInput}
                    docIdBusy={docIdBusy}
                    onGenerate={handleGenerateDocId}
                    onSave={handleSetDocId}
                    isSubmitting={isSubmitting}
                  />
                  <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} />
                </DecisionForm>
              )}

              {approval.currentStage === 'qa_review' && mode === 'correction' && (
                <CorrectionTaskForm
                  users={users}
                  taskTitle={taskTitle} setTaskTitle={setTaskTitle}
                  taskDescription={taskDescription} setTaskDescription={setTaskDescription}
                  assignToUserId={assignToUserId} setAssignToUserId={setAssignToUserId}
                  dueDate={dueDate} setDueDate={setDueDate}
                  notes={notes} setNotes={setNotes}
                  onCancel={resetForm}
                  onSubmit={handleQaCorrection}
                  isSubmitting={isSubmitting}
                />
              )}

              {/* ---- Stage 2: Manager Review ---- */}
              {approval.currentStage === 'manager_review' && mode === 'view' && (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => setMode('accept')} disabled={isSubmitting} className="flex-1">
                    <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Approve
                  </Button>
                  <Button onClick={() => setMode('correction')} disabled={isSubmitting} variant="secondary" className="flex-1">
                    <FileX2 className="mr-1.5 inline h-4 w-4" /> Reject — Assign Correction Task
                  </Button>
                  <Button onClick={() => setMode('self-correct')} disabled={isSubmitting} variant="secondary" className="flex-1">
                    <Upload className="mr-1.5 inline h-4 w-4" /> Reject — Fix It Myself
                  </Button>
                </div>
              )}

              {approval.currentStage === 'manager_review' && mode === 'accept' && (
                <DecisionForm
                  title="Approve for Final Release"
                  onCancel={resetForm}
                  onSubmit={handleManagerApprove}
                  submitLabel="Confirm Approve"
                  isSubmitting={isSubmitting}
                >
                  <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} />
                </DecisionForm>
              )}

              {approval.currentStage === 'manager_review' && mode === 'correction' && (
                <CorrectionTaskForm
                  users={users}
                  taskTitle={taskTitle} setTaskTitle={setTaskTitle}
                  taskDescription={taskDescription} setTaskDescription={setTaskDescription}
                  assignToUserId={assignToUserId} setAssignToUserId={setAssignToUserId}
                  dueDate={dueDate} setDueDate={setDueDate}
                  notes={notes} setNotes={setNotes}
                  notesLabel="Rejection reason"
                  onCancel={resetForm}
                  onSubmit={handleManagerRejectTask}
                  isSubmitting={isSubmitting}
                />
              )}

              {approval.currentStage === 'manager_review' && mode === 'self-correct' && (
                <DecisionForm
                  title="Upload Corrected File"
                  onCancel={resetForm}
                  onSubmit={handleManagerSelfCorrect}
                  submitLabel="Upload &amp; Send to Final Release"
                  isSubmitting={isSubmitting}
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
              {approval.currentStage === 'final_release' && mode === 'view' && (
                <Button onClick={() => setMode('accept')} disabled={isSubmitting} className="w-full">
                  <FileCheck2 className="mr-1.5 inline h-4 w-4" /> Final Release
                </Button>
              )}

              {approval.currentStage === 'final_release' && mode === 'accept' && (
                <DecisionForm
                  title="Final Release"
                  onCancel={resetForm}
                  onSubmit={handleFinalRelease}
                  submitLabel="Release Document(s)"
                  isSubmitting={isSubmitting}
                >
                  <TextAreaField label="Release notes (optional)" value={releaseNotes} onChange={setReleaseNotes} />
                </DecisionForm>
              )}

              {approval.currentStage === 'released' && (
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
          fileName={approval?.documents.find((d) => d.documentId === editDocumentId)?.fileName ?? ''}
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
      <CardBody className="space-y-3">
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
  documents, docIds, manualDocIdInput, setManualDocIdInput, docIdBusy, onGenerate, onSave, isSubmitting,
}: {
  documents: ApprovalDocument[];
  docIds: Record<string, string>;
  manualDocIdInput: Record<string, string>;
  setManualDocIdInput: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  docIdBusy: Record<string, boolean>;
  onGenerate: (documentId: string) => void;
  onSave: (documentId: string) => void;
  isSubmitting: boolean;
}) {
  const missingCount = documents.filter((d) => !docIds[d.documentId]?.trim()).length;

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${missingCount > 0 ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50'}`}>
      <p className={`text-sm font-medium ${missingCount > 0 ? 'text-amber-900 dark:text-amber-300' : 'text-gray-700 dark:text-slate-300'}`}>
        {missingCount > 0
          ? `Document ID required before accepting (${missingCount} document${missingCount !== 1 ? 's' : ''})`
          : 'Document IDs — edit if a wrong value was extracted'}
      </p>
      {documents.map((doc) => {
        const isMissing = !docIds[doc.documentId]?.trim();
        const busy = docIdBusy[doc.documentId];
        return (
          <div key={doc.documentId} className="flex flex-wrap items-center gap-2 rounded-md bg-white/60 p-2 dark:bg-slate-900/40">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-slate-300" title={doc.fileName}>{doc.fileName}</span>
            {!isMissing && (
              <span className="whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                {docIds[doc.documentId]}
              </span>
            )}
            <input
              type="text"
              placeholder="Original Document ID"
              value={manualDocIdInput[doc.documentId] || ''}
              onChange={(e) => setManualDocIdInput((prev) => ({ ...prev, [doc.documentId]: e.target.value }))}
              disabled={busy || isSubmitting}
              className="w-36 rounded border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <Button type="button" size="sm" variant="secondary" onClick={() => onSave(doc.documentId)} disabled={!manualDocIdInput[doc.documentId]?.trim() || busy || isSubmitting}>
              {isMissing ? 'Save' : 'Correct'}
            </Button>
            <Button type="button" size="sm" onClick={() => onGenerate(doc.documentId)} disabled={busy || isSubmitting}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="ml-1">{isMissing ? 'Generate from System' : 'Generate New ID'}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function CorrectionTaskForm({
  users, taskTitle, setTaskTitle, taskDescription, setTaskDescription,
  assignToUserId, setAssignToUserId, dueDate, setDueDate, notes, setNotes,
  notesLabel = 'Notes (optional)', onCancel, onSubmit, isSubmitting,
}: {
  users: Array<{ userId: string; fullName: string }>;
  taskTitle: string; setTaskTitle: (v: string) => void;
  taskDescription: string; setTaskDescription: (v: string) => void;
  assignToUserId: string; setAssignToUserId: (v: string) => void;
  dueDate: string; setDueDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  notesLabel?: string;
  onCancel: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  return (
    <DecisionForm title="Correction Task" onCancel={onCancel} onSubmit={onSubmit} submitLabel="Send Correction Task" isSubmitting={isSubmitting}>
      <TextField label="Task title" value={taskTitle} onChange={setTaskTitle} />
      <TextAreaField label="Task description" value={taskDescription} onChange={setTaskDescription} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-navy-900 dark:text-white">Assign to</label>
          <select
            value={assignToUserId}
            onChange={(e) => setAssignToUserId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>{u.fullName}</option>
            ))}
          </select>
        </div>
        <TextField label="Due date" type="date" value={dueDate} onChange={setDueDate} />
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
