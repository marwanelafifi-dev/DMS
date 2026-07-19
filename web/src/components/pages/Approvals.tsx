import { useEffect, useState } from 'react';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { CheckCircle2, XCircle, Clock, Search, X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import type { Approval } from '../../types';

const PAGE_SIZE = 10;

export function Approvals() {
  const { showSuccess, showError } = useToast();

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [actionModal, setActionModal] = useState<{ isOpen: boolean; approval?: Approval; actionType?: 'approve' | 'reject' }>({ isOpen: false });
  const [actionText, setActionText] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadApprovals = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getPendingApprovals({ page: targetPage, pageSize: PAGE_SIZE });
      const allApprovals = res.data || [];
      setApprovals(allApprovals);
      setTotalCount(res.totalCount ?? allApprovals.length ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadApprovals(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filteredApprovals = approvals.filter(approval => {
    const matchesSearch = (approval.document?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (approval.submittedByUser?.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = !statusFilter || approval.approvalStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const approvalStats = {
    total: totalCount,
    pending: approvals.filter(a => a.approvalStatus === 'pending').length,
    approved: approvals.filter(a => a.approvalStatus === 'approved').length,
    rejected: approvals.filter(a => a.approvalStatus === 'rejected').length,
  };

  const handleApprovalAction = async () => {
    if (!actionModal.approval) return;

    if (actionModal.actionType === 'reject' && !actionText.trim()) {
      showError('Rejection reason is required');
      return;
    }
    if (actionModal.actionType === 'approve' && !actionText.trim()) {
      showError('Comments are required');
      return;
    }

    setIsSubmittingAction(true);
    try {
      if (actionModal.actionType === 'approve') {
        await apiClient.approveDocument(actionModal.approval.documentId, actionText);
      } else {
        await apiClient.rejectDocument(actionModal.approval.documentId, actionText);
      }
      showSuccess(`Document ${actionModal.actionType === 'approve' ? 'approved' : 'rejected'} successfully`);
      setActionModal({ isOpen: false });
      setActionText('');
      loadApprovals();
    } catch (err: any) {
      showError(err.response?.data?.error || `Failed to ${actionModal.actionType} document`);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getStatusColor = (status: Approval['approvalStatus']): any => {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Approvals</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Approvals</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{approvalStats.total}</p>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <Eye className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-yellow-500">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{approvalStats.pending}</p>
            </div>
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-green-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Approved</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{approvalStats.approved}</p>
            </div>
            <div className="bg-green-600 p-3 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-red-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Rejected</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{approvalStats.rejected}</p>
            </div>
            <div className="bg-red-600 p-3 rounded-lg">
              <XCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by document name or submitter..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="px-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Approvals Table */}
      {loadError ? (
        <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
          <CardBody>
            <p className="text-red-700 dark:text-red-300">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => loadApprovals()} className="mt-4">
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
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Document</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Submitted By</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Submitted At</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Approved/Rejected At</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No approvals found
                    </td>
                  </tr>
                ) : (
                  filteredApprovals.map((approval, idx) => (
                    <tr
                      key={approval.approvalId}
                      className={`border-b border-gray-200 dark:border-navy-700 ${
                        idx % 2 === 1 ? 'bg-gray-50 dark:bg-navy-850' : 'bg-white dark:bg-navy-950'
                      } hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-navy-900 dark:text-white">{approval.document?.name || 'Unknown Document'}</p>
                          {approval.document?.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">{approval.document.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-navy-900 dark:text-white">{approval.submittedByUser?.fullName || 'Unknown User'}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{approval.submittedByUser?.email || ''}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={getStatusColor(approval.approvalStatus)} variant="outline">
                          {approval.approvalStatus}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(approval.submittedAt)}</p>
                      </td>
                      <td className="px-6 py-4">
                        {approval.approvalStatus !== 'pending' ? (
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {approval.approvedAt ? formatDate(approval.approvedAt) : 'N/A'}
                            </p>
                            {approval.approvedByUser && (
                              <p className="text-xs text-gray-500 dark:text-gray-500">by {approval.approvedByUser.fullName}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          {approval.approvalStatus === 'pending' ? (
                            <>
                              <button
                                onClick={() => setActionModal({ isOpen: true, approval, actionType: 'approve' })}
                                className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors text-green-600"
                                title="Approve"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setActionModal({ isOpen: true, approval, actionType: 'reject' })}
                                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors text-red-600"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {approval.approvalStatus === 'approved' ? '✓ Approved' : '✗ Rejected'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-navy-700 bg-gray-50 dark:bg-navy-900">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages} ({totalCount} total approvals)
              </p>
              <div className="flex gap-2">
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

      {/* Approval Action Modal */}
      {actionModal.isOpen && actionModal.approval && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className={`flex items-center justify-between p-6 border-b ${
              actionModal.actionType === 'approve'
                ? 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20'
                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20'
            }`}>
              <h2 className={`text-lg font-serif font-bold ${
                actionModal.actionType === 'approve'
                  ? 'text-green-900 dark:text-green-300'
                  : 'text-red-900 dark:text-red-300'
              }`}>
                {actionModal.actionType === 'approve' ? 'Approve Document' : 'Reject Document'}
              </h2>
              <button
                onClick={() => setActionModal({ isOpen: false })}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm font-medium text-navy-900 dark:text-white mb-2">Document</p>
                <p className="text-gray-700 dark:text-gray-300">{actionModal.approval.document?.name}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-navy-900 dark:text-white mb-2">
                  {actionModal.actionType === 'approve' ? 'Comments' : 'Rejection Reason'} *
                </p>
                <textarea
                  placeholder={actionModal.actionType === 'approve'
                    ? 'Add approval comments...'
                    : 'Explain the rejection reason...'}
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent h-32"
                />
              </div>

              {actionModal.approval.comments && actionModal.actionType === 'approve' && (
                <div className="p-3 bg-gray-100 dark:bg-navy-800 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Previous Comments</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{actionModal.approval.comments}</p>
                </div>
              )}

              {actionModal.approval.rejectionReason && actionModal.actionType === 'reject' && (
                <div className="p-3 bg-gray-100 dark:bg-navy-800 rounded-lg">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Previous Rejection Reason</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{actionModal.approval.rejectionReason}</p>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="secondary"
                  onClick={() => setActionModal({ isOpen: false })}
                  disabled={isSubmittingAction}
                >
                  Cancel
                </Button>
                <Button
                  variant={actionModal.actionType === 'approve' ? 'primary' : 'danger'}
                  onClick={handleApprovalAction}
                  disabled={isSubmittingAction}
                >
                  {isSubmittingAction
                    ? `${actionModal.actionType === 'approve' ? 'Approving' : 'Rejecting'}...`
                    : (actionModal.actionType === 'approve' ? 'Approve' : 'Reject')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
