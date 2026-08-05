import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { CheckCircle2, ChevronLeft, ChevronRight, AlertCircle, Eye, Download, FileText } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ApprovalDetailView } from '../custom/ApprovalDetailView';
import { usePageAccess } from '../../hooks/usePageAccess';

const PAGE_SIZE = 10;

type ApprovalTab = 'qa-queue' | 'manager-queue' | 'release-queue';

interface QueueDocument {
  documentId: string;
  versionId: string;
  fileName: string;
  ownerName: string;
  department: string;
  status: string;
  originalDocumentId?: string | null;
  hasDocId?: boolean;
}

interface QueueApproval {
  approvalId: string;
  createdAt: string;
  createdByUserName?: string;
  documentCount: number;
  status: string;
  qaDecision?: string;
  approvalNotes?: string;
  qaNotes?: string;
  documents: QueueDocument[];
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const statusStyles: Record<string, string> = {
  pending: 'bg-[#fff1c9] text-[#b96a08]',
  correction_requested: 'bg-[#fde1e2] text-[#c73c44]',
  approved: 'bg-[#dbe9fb] text-[#2f6f9f]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  open: 'bg-[#edf1f5] text-[#62718a]',
};

const statusLabel = (status: string) => status
  .split('_')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

const extensionStyles: Record<string, string> = {
  txt: 'bg-slate-100 text-slate-600',
  doc: 'bg-blue-50 text-blue-700',
  docx: 'bg-blue-50 text-blue-700',
  xlsx: 'bg-emerald-50 text-emerald-700',
  pptx: 'bg-orange-50 text-orange-700',
  pdf: 'bg-red-50 text-red-700',
  png: 'bg-violet-50 text-violet-700',
  jpg: 'bg-violet-50 text-violet-700',
  jpeg: 'bg-violet-50 text-violet-700',
};

const extensionStyleFor = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return extensionStyles[ext] ?? 'bg-slate-100 text-slate-600';
};

export function Approvals() {
  const access = usePageAccess();
  const [tab, setTab] = useState<ApprovalTab | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<Array<{ groupId: string; name: string }>>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);

  // QA queue (Stage 1)
  const [qaApprovals, setQaApprovals] = useState<QueueApproval[]>([]);
  const [qaIsLoading, setQaIsLoading] = useState(false);
  const [qaLoadError, setQaLoadError] = useState<string | null>(null);
  const [qaPage, setQaPage] = useState(1);
  const [qaTotalCount, setQaTotalCount] = useState(0);
  const [qaTotalPages, setQaTotalPages] = useState(1);

  // Manager queue (Stage 2)
  const [managerApprovals, setManagerApprovals] = useState<QueueApproval[]>([]);
  const [managerIsLoading, setManagerIsLoading] = useState(false);
  const [managerLoadError, setManagerLoadError] = useState<string | null>(null);
  const [managerPage, setManagerPage] = useState(1);
  const [managerTotalCount, setManagerTotalCount] = useState(0);
  const [managerTotalPages, setManagerTotalPages] = useState(1);

  // Final release queue (Stage 3)
  const [releaseApprovals, setReleaseApprovals] = useState<QueueApproval[]>([]);
  const [releaseIsLoading, setReleaseIsLoading] = useState(false);
  const [releaseLoadError, setReleaseLoadError] = useState<string | null>(null);
  const [releasePage, setReleasePage] = useState(1);
  const [releaseTotalCount, setReleaseTotalCount] = useState(0);
  const [releaseTotalPages, setReleaseTotalPages] = useState(1);

  const loadQaQueue = async (targetPage = qaPage) => {
    setQaIsLoading(true);
    setQaLoadError(null);
    try {
      const res = await apiClient.getQaReviewQueue({ page: targetPage, pageSize: PAGE_SIZE });
      const data = res.data || [];
      setQaApprovals(data);
      setQaTotalCount(res.totalCount ?? data.length ?? 0);
      setQaTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setQaLoadError(err.response?.data?.error || 'Failed to load QA queue');
    } finally {
      setQaIsLoading(false);
    }
  };

  const loadManagerQueue = async (targetPage = managerPage) => {
    setManagerIsLoading(true);
    setManagerLoadError(null);
    try {
      const res = await apiClient.getManagerReviewQueue({ page: targetPage, pageSize: PAGE_SIZE });
      const data = res.data || [];
      setManagerApprovals(data);
      setManagerTotalCount(res.totalCount ?? data.length ?? 0);
      setManagerTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setManagerLoadError(err.response?.data?.error || 'Failed to load manager review queue');
    } finally {
      setManagerIsLoading(false);
    }
  };

  const loadReleaseQueue = async (targetPage = releasePage) => {
    setReleaseIsLoading(true);
    setReleaseLoadError(null);
    try {
      const res = await apiClient.getFinalReleaseQueue({ page: targetPage, pageSize: PAGE_SIZE });
      const data = res.data || [];
      setReleaseApprovals(data);
      setReleaseTotalCount(res.totalCount ?? data.length ?? 0);
      setReleaseTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setReleaseLoadError(err.response?.data?.error || 'Failed to load final release queue');
    } finally {
      setReleaseIsLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await apiClient.getUsers();
      setAllUsers(res.data || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadGroups = async () => {
    try {
      const res = await apiClient.getGroups();
      setAllGroups(res.data || []);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  const refreshAllQueues = () => {
    if (access?.canViewQaStage) loadQaQueue(qaPage);
    if (access?.canViewManagerStage) loadManagerQueue(managerPage);
    if (access?.canViewFinalReleaseStage) loadReleaseQueue(releasePage);
  };

  useEffect(() => {
    loadUsers();
    loadGroups();
  }, []);

  // Each role only sees the stage tabs its C-Doc Workflow access grants — e.g.
  // Manager only ever needed Stage 2, Quality only Stage 1 and Stage 3 (see
  // DmsPageAccessRole.CanView*Stage). Pick the first one this role can see as
  // the default active tab once access has actually loaded.
  const tabs: Array<{ key: ApprovalTab; label: string; count: number }> = useMemo(() => [
    ...(access?.canViewQaStage ? [{ key: 'qa-queue' as const, label: 'QA Review (Stage 1)', count: qaTotalCount }] : []),
    ...(access?.canViewManagerStage ? [{ key: 'manager-queue' as const, label: 'Manager Review (Stage 2)', count: managerTotalCount }] : []),
    ...(access?.canViewFinalReleaseStage ? [{ key: 'release-queue' as const, label: 'Final Release (Stage 3)', count: releaseTotalCount }] : []),
  ], [access, qaTotalCount, managerTotalCount, releaseTotalCount]);

  useEffect(() => {
    if (!access) return;
    if (tab === null || !tabs.some((t) => t.key === tab)) {
      setTab(tabs[0]?.key ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, tabs]);

  useEffect(() => {
    if (tab === 'qa-queue') loadQaQueue(qaPage);
    else if (tab === 'manager-queue') loadManagerQueue(managerPage);
    else if (tab === 'release-queue') loadReleaseQueue(releasePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qaPage, managerPage, releasePage]);

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">Document Workflow</h1>
          <p className="page-subtitle">Controlled Document Lifecycle</p>
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 0 && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 font-medium text-sm transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-300'
              }`}
            >
              {t.label} {t.count > 0 && <span className="ml-1 text-xs bg-orange-500 text-white px-2 py-0.5 rounded">({t.count})</span>}
            </button>
          ))}
        </div>
      )}

      {access && tabs.length === 0 && (
        <Card>
          <CardBody className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-slate-400">Your role does not have access to any Document Workflow stage.</p>
          </CardBody>
        </Card>
      )}

      {/* QA Review Queue (Stage 1) */}
      {tab === 'qa-queue' && (
        <ApprovalQueueTable
          approvals={qaApprovals}
          isLoading={qaIsLoading}
          loadError={qaLoadError}
          onRetry={() => loadQaQueue()}
          emptyLabel="No documents awaiting QA review"
          page={qaPage}
          totalPages={qaTotalPages}
          totalCount={qaTotalCount}
          onPageChange={setQaPage}
          actionLabel="Review"
          onAction={(approvalId, documentId) => { setSelectedApprovalId(approvalId); setFocusDocumentId(documentId); }}
        />
      )}

      {/* Manager Review Queue (Stage 2) */}
      {tab === 'manager-queue' && (
        <ApprovalQueueTable
          approvals={managerApprovals}
          isLoading={managerIsLoading}
          loadError={managerLoadError}
          onRetry={() => loadManagerQueue()}
          emptyLabel="No documents awaiting manager review"
          page={managerPage}
          totalPages={managerTotalPages}
          totalCount={managerTotalCount}
          onPageChange={setManagerPage}
          actionLabel="Review"
          onAction={(approvalId, documentId) => { setSelectedApprovalId(approvalId); setFocusDocumentId(documentId); }}
        />
      )}

      {/* Final Release Queue (Stage 3) */}
      {tab === 'release-queue' && (
        <ApprovalQueueTable
          approvals={releaseApprovals}
          isLoading={releaseIsLoading}
          loadError={releaseLoadError}
          onRetry={() => loadReleaseQueue()}
          emptyLabel="No documents awaiting final release"
          page={releasePage}
          totalPages={releaseTotalPages}
          totalCount={releaseTotalCount}
          onPageChange={setReleasePage}
          actionLabel="Release"
          onAction={(approvalId, documentId) => { setSelectedApprovalId(approvalId); setFocusDocumentId(documentId); }}
        />
      )}

      {selectedApprovalId && focusDocumentId && (
        <ApprovalDetailView
          approvalId={selectedApprovalId}
          documentId={focusDocumentId}
          users={allUsers}
          groups={allGroups}
          onClose={() => { setSelectedApprovalId(null); setFocusDocumentId(null); }}
          onChanged={refreshAllQueues}
        />
      )}
    </div>
  );
}

interface ApprovalQueueTableProps {
  approvals: QueueApproval[];
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  emptyLabel: string;
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  actionLabel: string;
  onAction: (approvalId: string, documentId: string) => void;
}

function ApprovalQueueTable({
  approvals,
  isLoading,
  loadError,
  onRetry,
  emptyLabel,
  page,
  totalPages,
  totalCount,
  onPageChange,
  actionLabel,
  onAction,
}: ApprovalQueueTableProps) {
  if (loadError) {
    return (
      <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
        <CardBody>
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-700 dark:text-red-300">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
                Retry
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (isLoading) return <SkeletonTable />;

  if (approvals.length === 0) {
    return (
      <Card>
        <CardBody className="text-center py-12">
          <CheckCircle2 className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-slate-400">{emptyLabel}</p>
        </CardBody>
      </Card>
    );
  }

  const navigate = useNavigate();

  const handlePreview = (documentId: string) => {
    navigate(`/documents?preview=${encodeURIComponent(documentId)}`);
  };

  const handleDownload = async (documentId: string, versionId: string) => {
    try {
      await apiClient.downloadDocument(documentId, versionId);
    } catch {
      // Download failures are surfaced via the browser's own network error UI here;
      // this list doesn't have its own toast wiring.
    }
  };

  const rows = approvals.flatMap((approval) =>
    (approval.documents ?? []).map((doc) => ({ approval, doc }))
  );

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table w-full" aria-label="Approval queue">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>Doc ID</th>
              <th>File name</th>
              <th>Owner</th>
              <th>Department</th>
              <th>Status</th>
              <th>Submitted</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ approval, doc }, index) => (
              <tr
                key={doc.documentId}
                className={`${index % 2 ? 'bg-[#f8fafc] dark:bg-slate-800/35' : 'bg-white dark:bg-slate-900'} hover:bg-[#f2f6fa] dark:hover:bg-slate-800/60`}
              >
                <td className="text-[#52627a] dark:text-slate-200">
                  {doc.originalDocumentId ? (
                    <span className="font-mono text-xs" title={doc.documentId}>{doc.originalDocumentId}</span>
                  ) : (
                    <span className="font-mono text-xs italic text-[#93a4bd]" title={`No Document ID set — internal ID: ${doc.documentId}`}>Not set</span>
                  )}
                </td>
                <td className="min-w-0">
                  <button type="button" onClick={() => handlePreview(doc.documentId)} className="flex w-full min-w-0 items-center gap-2 text-left" aria-label={`Open ${doc.fileName}`}>
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded ${extensionStyleFor(doc.fileName)}`}><FileText className="h-4 w-4" /></span>
                    <span className="block min-w-0 truncate text-sm font-semibold text-[#2e4083] dark:text-slate-100" title={doc.fileName}>{doc.fileName}</span>
                  </button>
                </td>
                <td className="text-[#52627a] dark:text-slate-200">{doc.ownerName}</td>
                <td className="text-[#52627a] dark:text-slate-200">{doc.department}</td>
                <td>
                  <span className={`rounded px-2 py-1 text-xs font-medium ${statusStyles[approval.status] ?? 'bg-[#edf1f5] text-[#62718a]'}`}>
                    {statusLabel(approval.status)}
                  </span>
                </td>
                <td className="text-[11px] text-[#718198]">{formatDate(approval.createdAt)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      title="Preview"
                      onClick={() => handlePreview(doc.documentId)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#2f3e83] text-white hover:bg-[#263472] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
                      aria-label={`Preview ${doc.fileName}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Download"
                      onClick={() => handleDownload(doc.documentId, doc.versionId)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#f1f4f8] text-[#52627a] hover:bg-[#e7ecf2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      aria-label={`Download ${doc.fileName}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(approval.approvalId, doc.documentId)}
                      className="rounded-[4px] bg-[#2f3e83] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#263472] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
                    >
                      {actionLabel}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-stretch gap-3 border-t border-gray-200 bg-gray-50 px-4 py-4 dark:border-navy-700 dark:bg-navy-900 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {totalPages} ({totalCount} total)
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4 mr-1 inline" />
              Previous
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
              Next
              <ChevronRight className="w-4 h-4 ml-1 inline" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
