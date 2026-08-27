import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
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

// Mirrors AuditActions in api/Services/AuditService.cs, plus the C-Doc
// Workflow / Document-ID action strings ApprovalsController and
// DocumentsController log as raw literals rather than named constants.
const ACTION_TYPES = [
  'FOLDER_CREATED', 'FOLDER_UPDATED', 'FOLDER_DELETED', 'FOLDER_RESTORED', 'RECYCLE_BIN_PURGED',
  'DOCUMENT_CREATED', 'DOCUMENT_UPDATED', 'DOCUMENT_DELETED', 'DOCUMENT_RESTORED',
  'DOCUMENT_UPLOADED', 'DOCUMENT_VERSION_REVERTED', 'DOCUMENT_DOWNLOADED',
  'DOCUMENT_CHECKOUT', 'DOCUMENT_CHECKIN', 'DOCUMENT_CHECKOUT_EXPIRED', 'DOCUMENT_CHECKOUT_FORCE_UNLOCKED',
  'DOCUMENT_SUBMITTED', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED',
  'DOCUMENT_ID_EXTRACTED', 'DOCUMENT_ID_GENERATED', 'DOCUMENT_ID_SET_MANUALLY',
  'TASK_COMPLETED', 'CORRECTION_TASK_COMPLETED', 'TASK_ATTACHMENT_UPLOADED', 'TASK_ATTACHMENT_DELETED',
  'TASK_CORRECTION_RESUBMITTED',
  'PERMISSION_GRANTED', 'PERMISSION_REVOKED',
  'REMINDER_SENT', 'REMINDER_CREATED', 'REMINDER_DELETED',
  'AUDIT_EVENT_CREATED', 'AUDIT_EVENT_DELETED',
  'GOOGLE_CALENDAR_CONNECTED', 'GOOGLE_CALENDAR_DISCONNECTED', 'GOOGLE_CALENDAR_SYNCED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_DELETED', 'USER_PASSWORD_RESET', 'USER_LOGIN',
  'GROUP_CREATED', 'GROUP_UPDATED', 'GROUP_DELETED', 'GROUP_MEMBER_ADDED', 'GROUP_MEMBER_REMOVED',
  'GROUP_SUBGROUP_ADDED', 'GROUP_SUBGROUP_REMOVED',
  'ROLE_PERMISSIONS_UPDATED', 'ROLE_CREATED', 'ROLE_DELETED', 'ROLE_RENAMED', 'USER_ROLE_UPDATED',
  'ACCESS_OVERRIDE_CREATED', 'ACCESS_OVERRIDE_UPDATED', 'ACCESS_OVERRIDE_DELETED',
  'DROPDOWN_ITEM_CREATED', 'DROPDOWN_ITEM_DELETED', 'DROPDOWN_ITEMS_IMPORTED',
  'DOCUMENT_SUBMITTED_FOR_APPROVAL', 'QA_ACCEPTED', 'QA_CORRECTION_REQUESTED',
  'MANAGER_APPROVED', 'MANAGER_REJECTED', 'MANAGER_SELF_CORRECTED',
  'QA_FINAL_RELEASE', 'QA_FINAL_REJECTED',
];

const getActionBadge = (action: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  if (action.endsWith('_DELETED') || action.endsWith('_REJECTED') || action === 'USER_DEACTIVATED' || action === 'PERMISSION_REVOKED' || action === 'DOCUMENT_CHECKOUT_EXPIRED') return 'error';
  if (action.endsWith('_CREATED') || action.endsWith('_APPROVED') || action.endsWith('_GRANTED') || action.endsWith('_UPLOADED') || action.endsWith('_COMPLETED')) return 'success';
  if (action.endsWith('_UPDATED') || action === 'DOCUMENT_SUBMITTED') return 'warning';
  return 'info';
};

// Splits "fullName" / "FullName" into "Full Name" — every metadata key comes
// back camelCased from the API, but reads better in a human-facing table
// with real spacing.
const humanizeKey = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/^./, (c) => c.toUpperCase());

const formatDiffValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '(none)';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '(none)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

// Real bug found live: several "*_UPDATED" audit entries used to log the raw
// request object as one of the metadata fields (e.g. `changedFields`) —
// every field the endpoint *accepts*, not what was actually edited, plus a
// redundant `updatedAt` restating the entry's own timestamp. That produced
// exactly the unreadable dump this was built to replace: "Tags: ISO 9001,
// UpdatedAt: 2026-08-27T09:53:32.72Z, Department: Quality Management,
// Description: ...". Newer entries (see AuditService.BuildChanges) log a
// clean `{ field: { from, to } }` payload — this renders those as
// "Field: before → after" and falls back to a plain key/value listing for
// every other action's metadata shape, skipping raw IDs and nested objects
// it doesn't recognize instead of printing "[object Object]".
const buildMetadataEntries = (metadata: Record<string, any> | null): string[] => {
  if (!metadata) return [];
  const entries: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key.toLowerCase().endsWith('id')) continue;
    if (key.toLowerCase() === 'changes' || key.toLowerCase() === 'permissions') continue;
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object' && !Array.isArray(value)) continue; // unrecognized nested shape
    entries.push(`${humanizeKey(key)}: ${Array.isArray(value) ? value.join(', ') : value}`);
  }
  const changes = metadata.changes ?? metadata.Changes;
  if (changes && typeof changes === 'object') {
    for (const [field, diff] of Object.entries(changes as Record<string, any>)) {
      if (diff && typeof diff === 'object' && ('from' in diff || 'to' in diff)) {
        entries.push(`${field}: ${formatDiffValue(diff.from)} → ${formatDiffValue(diff.to)}`);
      }
    }
  }
  // A File/Folder Permission override's granted/denied actions (see
  // AuditService.SummarizeOverrideFlags) — only ever the flags actually set
  // to Allow/Deny, so this only shows what genuinely changed access.
  const permissions = metadata.permissions ?? metadata.Permissions;
  if (permissions && typeof permissions === 'object') {
    for (const [field, allowed] of Object.entries(permissions as Record<string, boolean>)) {
      entries.push(`${humanizeKey(field)}: ${allowed ? 'Allow' : 'Deny'}`);
    }
  }
  return entries;
};

const formatMetadata = (metadata: Record<string, any> | null) => {
  const entries = buildMetadataEntries(metadata);
  return entries.length > 0 ? entries.join(', ') : '—';
};

// The Details cell is truncated to keep the table readable, which silently
// cut off anything past the visible width with no way to read the rest —
// click-to-expand (matching the same pattern already used for long cells
// in the Document Library) shows every field on its own line instead.
function DetailsCell({ metadata }: { metadata: Record<string, any> | null }) {
  const entries = buildMetadataEntries(metadata);
  if (entries.length === 0) return <span>—</span>;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="block max-w-md truncate text-left hover:underline">
          {entries.join(', ')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-[100] max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-lg dark:border-navy-700 dark:bg-navy-900 dark:text-white"
        >
          <ul className="space-y-1">
            {entries.map((entry) => <li key={entry} className="break-words">{entry}</li>)}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
      <div className="overflow-hidden rounded-[5px] border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm bg-white dark:bg-navy-900">
          <thead className="border-b border-[#e2e8f0] bg-[#f7f9fc] dark:border-white/10 dark:bg-slate-950">
            <tr className="text-left text-xs uppercase text-[#64748b] dark:text-slate-400">
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
                  <td className="px-6 py-4 text-gray-700 dark:text-navy-200">
                    <DetailsCell metadata={log.metadata} />
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
        </div>

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
