import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Search, Download, Filter, Calendar, ListChecks, Users as UsersIcon, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '../../utils/api';

const PAGE_SIZE = 25;

interface AuditLog {
  logId: string;
  userId: string;
  action: string;
  metadata: Record<string, any> | null;
  createdAt: string;
}

interface UserLite {
  userId: string;
  fullName: string;
}

// Mirrors AuditActions in api/Services/AuditService.cs
const ACTION_TYPES = [
  'FOLDER_CREATED', 'FOLDER_UPDATED', 'FOLDER_DELETED',
  'DOCUMENT_CREATED', 'DOCUMENT_UPDATED', 'DOCUMENT_DELETED',
  'DOCUMENT_UPLOADED', 'DOCUMENT_DOWNLOADED',
  'DOCUMENT_CHECKOUT', 'DOCUMENT_CHECKIN', 'DOCUMENT_CHECKOUT_EXPIRED',
  'DOCUMENT_SUBMITTED', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED',
  'TASK_COMPLETED',
  'PERMISSION_GRANTED', 'PERMISSION_REVOKED',
  'REMINDER_SENT',
  'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED',
];

const getActionBadge = (action: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  if (action.endsWith('_DELETED') || action.endsWith('_REJECTED') || action === 'USER_DEACTIVATED' || action === 'PERMISSION_REVOKED' || action === 'DOCUMENT_CHECKOUT_EXPIRED') return 'error';
  if (action.endsWith('_CREATED') || action.endsWith('_APPROVED') || action.endsWith('_GRANTED') || action.endsWith('_UPLOADED') || action.endsWith('_COMPLETED')) return 'success';
  if (action.endsWith('_UPDATED') || action === 'DOCUMENT_SUBMITTED') return 'warning';
  return 'info';
};

const formatMetadata = (metadata: Record<string, any> | null) => {
  if (!metadata) return '—';
  return Object.entries(metadata)
    .filter(([key]) => !key.toLowerCase().endsWith('id'))
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ') || '—';
};

export function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadData = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [logsRes, usersRes] = await Promise.all([
        apiClient.getAuditTrail({ page: targetPage, pageSize: PAGE_SIZE }),
        apiClient.getUsers({ activeOnly: false }),
      ]);
      setLogs(logsRes.data || []);
      setTotalCount(logsRes.totalCount ?? logsRes.data?.length ?? 0);
      setTotalPages(logsRes.totalPages ?? 1);
      setUsers(usersRes.data || []);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API. Is the backend running?');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach(u => map.set(u.userId, u.fullName));
    return map;
  }, [users]);

  const getUserName = (userId: string) => userNameById.get(userId) || 'Unknown user';

  const filteredLogs = logs.filter(log => {
    const userName = getUserName(log.userId);
    const details = formatMetadata(log.metadata);

    const matchesSearch =
      userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      details.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = !selectedAction || log.action === selectedAction;

    const logDate = log.createdAt.slice(0, 10);
    const matchesFrom = !dateRange.from || logDate >= dateRange.from;
    const matchesTo = !dateRange.to || logDate <= dateRange.to;

    return matchesSearch && matchesAction && matchesFrom && matchesTo;
  });

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleExport = () => {
    const header = ['Timestamp', 'User', 'Action', 'Details'];
    const rows = filteredLogs.map(log => [
      formatTimestamp(log.createdAt),
      getUserName(log.userId),
      log.action,
      formatMetadata(log.metadata),
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Audit Trail &amp; Logging</h2>
        <SkeletonTable />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Audit Trail &amp; Logging</h2>
        <Card className="border-l-4 border-l-red-600">
          <CardBody>
            <p className="text-red-700 dark:text-red-400 font-medium">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => loadData(page)}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Audit Trail &amp; Logging</h2>
        <Button variant="primary" size="sm" className="flex items-center gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Export Logs
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Total Logs
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{totalCount}</p>
            </div>
            <ListChecks className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Active Users (this page)
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">
                {new Set(logs.map(l => l.userId)).size}
              </p>
            </div>
            <UsersIcon className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Doc Actions (this page)
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">
                {logs.filter(l => l.action.startsWith('DOCUMENT')).length}
              </p>
            </div>
            <FileText className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by user, action, or details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Action Filter */}
        <div className="relative flex items-center gap-2">
          <Filter className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Actions</option>
            {ACTION_TYPES.map(action => (
              <option key={action} value={action}>{action.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div className="relative flex items-center gap-2">
          <Calendar className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-800 text-navy-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-700/60 shadow-sm dark:shadow-black/30">
        <table className="w-full text-sm bg-white dark:bg-navy-900">
          <thead className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900 border-b-2 border-b-blue-500/40 dark:border-b-cyan-500/40">
            <tr className="text-left text-white">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Timestamp</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">User</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Action</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-800">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log, idx) => (
                <tr
                  key={log.logId}
                  className={`${
                    idx % 2 === 0
                      ? 'bg-white dark:bg-navy-900'
                      : 'bg-gray-50 dark:bg-navy-950/60'
                  } hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
                >
                  <td className="px-6 py-4 text-gray-700 dark:text-navy-200 whitespace-nowrap">
                    {formatTimestamp(log.createdAt)}
                  </td>
                  <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white whitespace-nowrap">
                    {getUserName(log.userId)}
                  </td>
                  <td className="px-6 py-4">
                    <Badge status={getActionBadge(log.action)} size="sm" variant="outline">
                      {log.action.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-gray-700 dark:text-navy-200 max-w-md truncate">
                    {formatMetadata(log.metadata)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500 dark:text-navy-400">
                  No audit logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50 dark:bg-navy-950/60 border-t border-gray-200 dark:border-navy-800">
          <p className="text-sm text-gray-600 dark:text-navy-400">
            Page <span className="font-semibold text-navy-900 dark:text-white">{page}</span> of{' '}
            <span className="font-semibold text-navy-900 dark:text-white">{totalPages}</span>
            {' '}&mdash; {totalCount} total logs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg text-navy-600 dark:text-navy-300 hover:bg-navy-100 dark:hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg text-navy-600 dark:text-navy-300 hover:bg-navy-100 dark:hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Audit Trail Information</h4>
        <p className="text-sm text-blue-800 dark:text-blue-400">
          All system activities are logged for compliance and security purposes. These logs are immutable and retained according to your organization's retention policy.
        </p>
      </div>
    </div>
  );
}
