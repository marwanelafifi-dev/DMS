import React, { useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import { Button, Card } from '../ui';
import { useToast } from '../../hooks/useToast';
import { apiClient } from '../../utils/api';
import { doclingApi } from '../../services/doclingApi';
import type { User } from '../../types';

interface QaDecisionDocument {
  documentId: string;
  versionId?: string;
  fileName: string;
  originalDocumentId?: string | null;
  hasDocId?: boolean;
}

interface QaDecisionModalProps {
  isOpen: boolean;
  approvalId: string;
  documentCount: number;
  createdByName: string;
  users?: User[];
  documents?: QaDecisionDocument[];
  onDecision: (decision: 'ACCEPTED' | 'REQUESTED_CORRECTION', approvalId: string) => void;
  onCancel: () => void;
}

type DecisionPath = null | 'accept' | 'request_correction';

export const QaDecisionModal: React.FC<QaDecisionModalProps> = ({
  isOpen,
  approvalId,
  documentCount,
  createdByName,
  users = [],
  documents = [],
  onDecision,
  onCancel,
}) => {
  const [decisionPath, setDecisionPath] = useState<DecisionPath>(null);
  const [qaNotesComments, setQaNotesComments] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showSuccess } = useToast();

  // First Review Stage requirement: every document must have a Document ID
  // before QA can accept. Tracked locally so the UI updates immediately after
  // a manual save or system generation, without waiting on a full refetch.
  const [docIds, setDocIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(documents.map((d) => [d.documentId, d.originalDocumentId || '']))
  );
  // Pre-filled with whatever ID is already on file (extracted or previously set)
  // so QA can correct a wrong value, not just fill in a blank one.
  const [manualDocIdInput, setManualDocIdInput] = useState<Record<string, string>>(() =>
    Object.fromEntries(documents.map((d) => [d.documentId, d.originalDocumentId || '']))
  );
  const [docIdBusy, setDocIdBusy] = useState<Record<string, boolean>>({});

  const missingDocuments = documents.filter((d) => !docIds[d.documentId]?.trim());
  const allDocIdsResolved = missingDocuments.length === 0;

  const handleGenerateDocId = async (documentId: string) => {
    setDocIdBusy((prev) => ({ ...prev, [documentId]: true }));
    setError(null);
    try {
      // Prefer the real Document ID printed on the file itself (e.g. "Doc No.: SWS-13100002")
      // over a fabricated sequential one — re-download the file and re-run the same
      // extraction pass the upload flow does, since the parsed text isn't persisted.
      const document = documents.find((d) => d.documentId === documentId);
      let extractedFromFile: string | null = null;

      if (document?.versionId) {
        try {
          const { blob, fileName } = await apiClient.getDocumentFile(documentId, document.versionId);
          const file = new File([blob], fileName);
          const { content } = await doclingApi.convertDocument(file);
          const extractRes = await apiClient.extractDocId(documentId, content);
          if (extractRes.success && extractRes.data.found) {
            extractedFromFile = extractRes.data.originalDocumentId;
          }
        } catch {
          // Re-parsing failed (unsupported format, service down, etc.) — fall back
          // to system-generated sequence below rather than blocking QA entirely.
        }
      }

      if (extractedFromFile) {
        setDocIds((prev) => ({ ...prev, [documentId]: extractedFromFile! }));
        setManualDocIdInput((prev) => ({ ...prev, [documentId]: extractedFromFile! }));
        showSuccess(`Document ID extracted from file: ${extractedFromFile}`);
        return;
      }

      const res = await apiClient.generateDocId(documentId);
      if (res.success) {
        setDocIds((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
        setManualDocIdInput((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
        showSuccess(`No Document ID found in the file — assigned system ID: ${res.data.originalDocumentId}`);
      } else {
        setError(res.error || 'Failed to generate Document ID');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate Document ID');
    } finally {
      setDocIdBusy((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  const handleSetDocId = async (documentId: string) => {
    const value = manualDocIdInput[documentId]?.trim();
    if (!value) return;

    setDocIdBusy((prev) => ({ ...prev, [documentId]: true }));
    setError(null);
    try {
      const res = await apiClient.setDocId(documentId, value);
      if (res.success) {
        setDocIds((prev) => ({ ...prev, [documentId]: res.data.originalDocumentId }));
        showSuccess('Document ID saved');
      } else {
        setError(res.error || 'Failed to save Document ID');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save Document ID');
    } finally {
      setDocIdBusy((prev) => ({ ...prev, [documentId]: false }));
    }
  };

  // Calculate default due date (5 days from now)
  const getDefaultDueDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 5);
    return date.toISOString().split('T')[0];
  };

  React.useEffect(() => {
    if (isOpen && !dueDate) {
      setDueDate(getDefaultDueDate());
    }
  }, [isOpen, dueDate]);

  const handleAccept = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.qaAcceptApproval(approvalId, qaNotesComments || undefined);

      if (response.success) {
        showSuccess('Documents accepted by QA');
        onDecision('ACCEPTED', approvalId);
      } else {
        setError(response.error || 'Failed to accept documents');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to accept documents');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestCorrection = async () => {
    if (!qaNotesComments.trim()) {
      setError('Please provide QA feedback');
      return;
    }

    if (!assignToUserId) {
      setError('Please select a team member to assign the correction task');
      return;
    }

    if (!taskDescription.trim()) {
      setError('Please enter a task description');
      return;
    }

    if (!dueDate) {
      setError('Please select a due date');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.qaRequestCorrection(
        approvalId,
        qaNotesComments,
        taskDescription,
        assignToUserId,
        new Date(dueDate).toISOString()
      );

      if (response.success) {
        const assignedUserName = users.find((u) => u.userId === assignToUserId)?.fullName || 'Team member';
        showSuccess(`Correction task assigned to ${assignedUserName}`);
        onDecision('REQUESTED_CORRECTION', approvalId);
      } else {
        setError(response.error || 'Failed to create correction task');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create correction task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    setDecisionPath(null);
    setQaNotesComments('');
    setTaskDescription('');
    setAssignToUserId('');
    setDueDate(getDefaultDueDate());
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">
            QA Review: {documentCount} Document{documentCount !== 1 ? 's' : ''}
          </h2>
          <button
            onClick={() => {
              reset();
              onCancel();
            }}
            className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Choose Path */}
          {decisionPath === null && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Submitted by <strong>{createdByName}</strong>
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Accept Button */}
                <button
                  onClick={() => setDecisionPath('accept')}
                  className="p-4 border-2 border-emerald-200 dark:border-emerald-500/30 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors text-left"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                        Accept & Unlock Manager
                      </p>
                      <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                        Documents look good. Proceed to manager review.
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-1" />
                  </div>
                </button>

                {/* Request Correction Button */}
                <button
                  onClick={() => setDecisionPath('request_correction')}
                  className="p-4 border-2 border-orange-200 dark:border-orange-500/30 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors text-left"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-orange-900 dark:text-orange-300">
                        Request Correction
                      </p>
                      <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
                        Create a task for the team to fix issues.
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-1" />
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Accept Form */}
          {decisionPath === 'accept' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAccept();
              }}
              className="space-y-4"
            >
              {documents.length > 0 && (
                <div className={`space-y-3 rounded-lg border p-4 ${
                  missingDocuments.length > 0
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
                    : 'border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50'
                }`}>
                  <p className={`text-sm font-medium ${missingDocuments.length > 0 ? 'text-amber-900 dark:text-amber-300' : 'text-gray-700 dark:text-slate-300'}`}>
                    {missingDocuments.length > 0
                      ? `Document ID required before approval (${missingDocuments.length} document${missingDocuments.length !== 1 ? 's' : ''})`
                      : 'Document IDs — edit if a wrong value was extracted'}
                  </p>
                  {documents.map((doc) => {
                    const isMissing = !docIds[doc.documentId]?.trim();
                    return (
                      <div key={doc.documentId} className="flex flex-wrap items-center gap-2 rounded-md bg-white/60 p-2 dark:bg-slate-900/40">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-slate-300" title={doc.fileName}>
                          {doc.fileName}
                        </span>
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
                          disabled={docIdBusy[doc.documentId] || isSubmitting}
                          className="w-40 rounded border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSetDocId(doc.documentId)}
                          disabled={!manualDocIdInput[doc.documentId]?.trim() || docIdBusy[doc.documentId] || isSubmitting}
                        >
                          {isMissing ? 'Save' : 'Correct'}
                        </Button>
                        {isMissing && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleGenerateDocId(doc.documentId)}
                            disabled={docIdBusy[doc.documentId] || isSubmitting}
                          >
                            {docIdBusy[doc.documentId] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            <span className="ml-1">Generate from System</span>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <label htmlFor="qa-notes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Optional Review Notes
                </label>
                <textarea
                  id="qa-notes"
                  value={qaNotesComments}
                  onChange={(e) => setQaNotesComments(e.target.value)}
                  placeholder="Add any notes for the manager..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>

              {error && (
                <div className="flex items-gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
                <Button
                  variant="secondary"
                  onClick={() => {
                    reset();
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting || !allDocIdsResolved}
                  title={!allDocIdsResolved ? 'Every document needs a Document ID before QA can approve' : ''}
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Accept & Proceed to Manager
                </Button>
              </div>
            </form>
          )}

          {/* Request Correction Form */}
          {decisionPath === 'request_correction' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRequestCorrection();
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="qa-feedback" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  QA Feedback <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="qa-feedback"
                  value={qaNotesComments}
                  onChange={(e) => setQaNotesComments(e.target.value)}
                  placeholder="What needs to be fixed? Be specific..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label htmlFor="task-desc" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Correction Task Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="task-desc"
                  type="text"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="e.g. Fix section 3.2 formatting"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                  disabled={isSubmitting}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="assign-to" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Assign To <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="assign-to"
                    value={assignToUserId}
                    onChange={(e) => setAssignToUserId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                    disabled={isSubmitting}
                  >
                    <option value="">Select team member...</option>
                    {users.map((user) => (
                      <option key={user.userId} value={user.userId}>
                        {user.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="due-date" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                    Due Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
                <Button
                  variant="secondary"
                  onClick={() => {
                    reset();
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button variant="primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Create Correction Task
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
};
