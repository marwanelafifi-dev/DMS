import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { CheckCircle2, ChevronLeft, ChevronRight, AlertCircle, Eye, Download } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ApprovalDetailView } from '../custom/ApprovalDetailView';

const PAGE_SIZE = 10;

type ApprovalTab = 'qa-queue' | 'manager-queue' | 'release-queue';

interface QueueDocument {
  documentId: string;
  versionId: string;
  fileName: string;
  ownerName: string;
  department: string;
  status: string;
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

export function Approvals() {
  const [tab, setTab] = useState<ApprovalTab>('qa-queue');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);

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

  const refreshAllQueues = () => {
    loadQaQueue(qaPage);
    loadManagerQueue(managerPage);
    loadReleaseQueue(releasePage);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (tab === 'qa-queue') loadQaQueue(qaPage);
    else if (tab === 'manager-queue') loadManagerQueue(managerPage);
    else loadReleaseQueue(releasePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, qaPage, managerPage, releasePage]);

  if (selectedApprovalId) {
    return (
      <ApprovalDetailView
        approvalId={selectedApprovalId}
        users={allUsers}
        onClose={() => setSelectedApprovalId(null)}
        onChanged={refreshAllQueues}
      />
    );
  }

  const tabs: Array<{ key: ApprovalTab; label: string; count: number }> = [
    { key: 'qa-queue', label: 'QA Review (Stage 1)', count: qaTotalCount },
    { key: 'manager-queue', label: 'Manager Review (Stage 2)', count: managerTotalCount },
    { key: 'release-queue', label: 'Final Release (Stage 3)', count: releaseTotalCount },
  ];

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">C-Doc Workflow</h1>
          <p className="page-subtitle">Controlled Document Lifecycle</p>
        </div>
      </div>

      {/* Tabs */}
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
          onAction={setSelectedApprovalId}
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
          onAction={setSelectedApprovalId}
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
          onAction={setSelectedApprovalId}
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
  onAction: (approvalId: string) => void;
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
    approval.documents.map((doc) => ({ approval, doc }))
  );

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-navy-900 border-b border-gray-200 dark:border-navy-700">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Document ID</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">File Name</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Owner</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Department</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Submitted</th>
              <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ approval, doc }, idx) => (
              <tr
                key={doc.documentId}
                className={`border-b border-gray-200 dark:border-navy-700 ${
                  idx % 2 === 1 ? 'bg-gray-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-950'
                } hover:bg-gray-100 dark:hover:bg-slate-800/60 transition-colors`}
              >
                <td className="px-6 py-4">
                  <p className="font-mono text-xs text-gray-500 dark:text-gray-400" title={doc.documentId}>
                    {doc.documentId.slice(0, 8)}…
                  </p>
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium text-navy-900 dark:text-white">{doc.fileName}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">{doc.ownerName}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">{doc.department}</p>
                </td>
                <td className="px-6 py-4">
                  <Badge status="default" variant="outline">{approval.status}</Badge>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(approval.createdAt)}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => handlePreview(doc.documentId)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                      title="Preview"
                      aria-label={`Preview ${doc.fileName}`}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDownload(doc.documentId, doc.versionId)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
                      title="Download"
                      aria-label={`Download ${doc.fileName}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onAction(approval.approvalId)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
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
