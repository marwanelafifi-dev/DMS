import { useState } from 'react';
import { Card, CardBody, Badge, Button } from '../ui';
import { Search, Download, Filter, Calendar, ListChecks, CheckCircle2, Users as UsersIcon, FileText } from 'lucide-react';

interface AuditLog {
  logId: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId?: string;
  timestamp: string;
  ipAddress: string;
  details: string;
  status: 'success' | 'failure';
}

const ACTION_TYPES = [
  'DOCUMENT_VIEWED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DOWNLOADED',
  'DOCUMENT_DELETED',
  'DOCUMENT_APPROVED',
  'DOCUMENT_REJECTED',
  'USER_CREATED',
  'USER_MODIFIED',
  'USER_DELETED',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'SETTINGS_CHANGED',
];

const ACTION_BADGE: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  'DOCUMENT_VIEWED': 'info',
  'DOCUMENT_UPLOADED': 'success',
  'DOCUMENT_DOWNLOADED': 'info',
  'DOCUMENT_DELETED': 'error',
  'DOCUMENT_APPROVED': 'success',
  'DOCUMENT_REJECTED': 'error',
  'USER_CREATED': 'success',
  'USER_MODIFIED': 'warning',
  'USER_DELETED': 'error',
  'PERMISSION_GRANTED': 'success',
  'PERMISSION_REVOKED': 'error',
  'SETTINGS_CHANGED': 'default',
};

export function AuditTrail() {
  const [auditLogs] = useState<AuditLog[]>([
    {
      logId: 'log-1',
      userId: 'user-2',
      userName: 'Ahmed Ali',
      action: 'DOCUMENT_UPLOADED',
      resource: 'Documents',
      resourceId: 'doc-1',
      timestamp: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.100',
      details: 'Uploaded ISO 9001:2015 Quality Procedure',
      status: 'success',
    },
    {
      logId: 'log-2',
      userId: 'user-3',
      userName: 'Sarah Johnson',
      action: 'DOCUMENT_APPROVED',
      resource: 'Approvals',
      resourceId: 'doc-2',
      timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.105',
      details: 'Approved Document Control Procedure',
      status: 'success',
    },
    {
      logId: 'log-3',
      userId: 'user-1',
      userName: 'Mohammed Anwar',
      action: 'DOCUMENT_DOWNLOADED',
      resource: 'Documents',
      resourceId: 'doc-4',
      timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.110',
      details: 'Downloaded Audit Results Q2 2026',
      status: 'success',
    },
    {
      logId: 'log-4',
      userId: 'user-4',
      userName: 'Lisa Chen',
      action: 'USER_CREATED',
      resource: 'Users',
      timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.120',
      details: 'Created new user: John Davis (john@si-ware.com)',
      status: 'success',
    },
    {
      logId: 'log-5',
      userId: 'user-2',
      userName: 'Ahmed Ali',
      action: 'PERMISSION_GRANTED',
      resource: 'Permissions',
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.100',
      details: 'Granted Manager role to user: Lisa Chen',
      status: 'success',
    },
    {
      logId: 'log-6',
      userId: 'user-1',
      userName: 'Mohammed Anwar',
      action: 'DOCUMENT_DELETED',
      resource: 'Documents',
      resourceId: 'doc-99',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.110',
      details: 'Deleted document: Old Test Document',
      status: 'success',
    },
    {
      logId: 'log-7',
      userId: 'user-3',
      userName: 'Sarah Johnson',
      action: 'DOCUMENT_VIEWED',
      resource: 'Documents',
      resourceId: 'doc-1',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.105',
      details: 'Viewed ISO 9001:2015 Quality Procedure',
      status: 'success',
    },
    {
      logId: 'log-8',
      userId: 'user-5',
      userName: 'John Davis',
      action: 'SETTINGS_CHANGED',
      resource: 'Settings',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      ipAddress: '192.168.1.115',
      details: 'Changed user profile settings',
      status: 'success',
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });

  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch =
      log.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = !selectedAction || log.action === selectedAction;

    const logDate = log.timestamp.slice(0, 10);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-navy-900 dark:text-white">Audit Trail &amp; Logging</h2>
        <Button variant="primary" size="sm" className="flex items-center gap-2">
          <Download className="w-4 h-4" />
          Export Logs
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Total Logs
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">{auditLogs.length}</p>
            </div>
            <ListChecks className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Successful
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">
                {auditLogs.filter(l => l.status === 'success').length}
              </p>
            </div>
            <CheckCircle2 className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Active Users
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">
                {new Set(auditLogs.map(l => l.userId)).size}
              </p>
            </div>
            <UsersIcon className="w-11 h-11 bg-navy-800 text-white rounded-lg p-2.5 flex-shrink-0" />
          </CardBody>
        </Card>

        <Card className="border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 font-semibold">
                Doc Actions
              </p>
              <p className="text-4xl font-bold text-navy-900 dark:text-white">
                {auditLogs.filter(l => l.action.includes('DOCUMENT')).length}
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
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm">
        <table className="w-full text-sm bg-white dark:bg-navy-800">
          <thead className="bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-950 dark:to-navy-900">
            <tr className="text-left text-white">
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Timestamp</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">User</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Action</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Details</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">Resource</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide">IP Address</th>
              <th className="px-6 py-4 font-semibold text-sm tracking-wide text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-navy-700">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log, idx) => (
                <tr
                  key={log.logId}
                  className={`${
                    idx % 2 === 0
                      ? 'bg-white dark:bg-navy-800'
                      : 'bg-gray-50 dark:bg-navy-850'
                  } hover:bg-gray-100 dark:hover:bg-navy-700/50 transition-colors`}
                >
                  <td className="px-6 py-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {formatTimestamp(log.timestamp)}
                  </td>
                  <td className="px-6 py-4 font-semibold text-navy-900 dark:text-white whitespace-nowrap">
                    {log.userName}
                  </td>
                  <td className="px-6 py-4">
                    <Badge status={ACTION_BADGE[log.action] || 'default'} size="sm" variant="outline">
                      {log.action.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-gray-700 dark:text-gray-300 max-w-xs">
                    {log.details}
                  </td>
                  <td className="px-6 py-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {log.resource}
                    {log.resourceId && (
                      <span className="text-gray-400 dark:text-gray-500"> · {log.resourceId}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600 dark:text-gray-400 whitespace-nowrap font-mono text-xs">
                    {log.ipAddress}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge status={log.status === 'success' ? 'success' : 'error'} size="sm" variant="outline">
                      {log.status === 'success' ? 'Success' : 'Failed'}
                    </Badge>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                  No audit logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
