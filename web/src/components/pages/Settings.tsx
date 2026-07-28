import { useState, useEffect } from 'react';
import { Bell, Building2, Check, Database, FileText, Lock, LockKeyhole, Settings as SettingsIcon, Users } from 'lucide-react';
import { RolePermissions } from '../custom/RolePermissions';
import { UserManagement } from '../custom/UserManagement';
import { AuditTrail } from '../custom/AuditTrail';
import { Card, CardBody } from '../ui';
import { apiClient } from '../../utils/api';
import type { Document } from '../../types';

type SettingsTab = 'roles' | 'users' | 'audit' | 'settings' | 'notifications' | 'company-data' | 'database';

function ComingSoonPanel({ title }: { title: string }) {
  return (
    <Card>
      <CardBody className="p-8 text-center">
        <h3 className="text-base font-semibold text-[#26334d] dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-[#718198]">Requirements pending — let us know what this page should do.</p>
      </CardBody>
    </Card>
  );
}

interface SettingsProps {
  defaultTab?: SettingsTab;
}

export function Settings({ defaultTab = 'users' }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const [activeLocks, setActiveLocks] = useState<Document[]>([]);

  // Update activeTab when defaultTab prop changes (route change)
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    apiClient.getDocuments()
      .then((response) => setActiveLocks((response.data || []).filter((document: Document) => document.checkoutStatus === 'checked_out')))
      .catch(() => setActiveLocks([]));
  }, []);

  const tabs = [
    {
      id: 'users' as SettingsTab,
      label: 'Users',
      icon: Users,
      description: 'Manage users and assign roles',
    },
    {
      id: 'roles' as SettingsTab,
      label: 'Roles',
      icon: Lock,
      description: 'Manage role-based access control and permissions',
    },
    {
      id: 'audit' as SettingsTab,
      label: 'Audit Trail',
      icon: FileText,
      description: 'View system activity and logging',
    },
    {
      id: 'settings' as SettingsTab,
      label: 'Settings',
      icon: SettingsIcon,
      description: 'General system settings',
    },
    {
      id: 'notifications' as SettingsTab,
      label: 'Notifications',
      icon: Bell,
      description: 'Notification preferences and delivery',
    },
    {
      id: 'company-data' as SettingsTab,
      label: 'Company Data',
      icon: Building2,
      description: 'Organization profile and company information',
    },
    {
      id: 'database' as SettingsTab,
      label: 'Database',
      icon: Database,
      description: 'Database status and maintenance',
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Admin Panel</h1>
        <p className="page-subtitle">Role-Based Access Control · 5 roles × 4 permissions</p>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          <div className="border-b border-[#e2e8f0] px-5 py-4"><h2 className="section-heading">Permissions Matrix</h2></div>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[760px]">
              <thead><tr><th>Role</th><th>View Only</th><th>Download (Read-Only)</th><th>Download for Editing</th><th>Admin / Force-Unlock</th></tr></thead>
              <tbody>
                {[
                  ['Reader', true, true, false, false],
                  ['Writer', true, true, true, false],
                  ['QA', true, true, false, false],
                  ['Manager', true, true, true, false],
                  ['Admin', true, true, true, true],
                ].map(([role, ...permissions]) => (
                  <tr key={String(role)}>
                    <td className="font-medium text-[#2e4083]">{role}</td>
                    {permissions.map((allowed, index) => <td key={index}>{allowed ? <Check className="h-4 w-4 text-[#3b9b6b]" /> : <span className="text-[#cbd5e3]">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4">
            <h2 className="section-heading flex items-center gap-2"><LockKeyhole className="h-4 w-4" />Active Locks</h2>
            <span className="text-xs text-[#718198]">{activeLocks.length} documents checked out</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[680px]">
              <thead><tr><th>Document</th><th>Locked By</th><th>Since</th><th>Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {activeLocks.length > 0 ? activeLocks.map((document) => (
                  <tr key={document.documentId}><td className="font-medium text-[#2e4083]">{document.name}</td><td>{document.checkedOutBy || 'Unknown user'}</td><td>{document.checkedOutAt ? new Date(document.checkedOutAt).toLocaleString() : '—'}</td><td><span className="rounded bg-[#fff1c9] px-2 py-1 text-xs text-[#b96a08]">Checked out</span></td><td className="text-right text-xs text-[#718198]">Managed by checkout policy</td></tr>
                )) : <tr><td colSpan={5} className="py-8 text-center text-sm text-[#94a3b8]">No active document locks</td></tr>}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Quick Navigation */}
      <div className="pt-1"><h2 className="section-heading">Administration</h2></div>
      <div className="flex flex-wrap gap-2 rounded-[5px] border border-[#dbe2ec] bg-white p-2 dark:border-white/10 dark:bg-slate-900">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-[4px] px-4 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-[#e8f0f8] font-semibold text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-[#64748b] hover:bg-[#f4f7fa] dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {activeTab === 'roles' && <RolePermissions />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'audit' && <AuditTrail />}
        {activeTab === 'settings' && <ComingSoonPanel title="Settings" />}
        {activeTab === 'notifications' && <ComingSoonPanel title="Notifications" />}
        {activeTab === 'company-data' && <ComingSoonPanel title="Company Data" />}
        {activeTab === 'database' && <ComingSoonPanel title="Database" />}
      </div>
    </div>
  );
}
