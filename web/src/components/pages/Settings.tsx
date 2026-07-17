import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Users, Lock, FileText } from 'lucide-react';
import { RolePermissions } from '../custom/RolePermissions';
import { UserManagement } from '../custom/UserManagement';
import { AuditTrail } from '../custom/AuditTrail';

type SettingsTab = 'roles' | 'users' | 'audit';

interface SettingsProps {
  defaultTab?: SettingsTab;
}

export function Settings({ defaultTab = 'users' }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  // Update activeTab when defaultTab prop changes (route change)
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

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
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <SettingsIcon className="w-8 h-8 text-blue-500" />
          <h1 className="text-4xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Admin Panel</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-300 font-serif">
          System configuration and management
        </p>
      </div>

      {/* Quick Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                isActive
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-md ring-2 ring-blue-300 dark:ring-blue-600'
                  : 'border-gray-200 dark:border-navy-700 bg-white dark:bg-navy-800 hover:border-blue-300 dark:hover:border-blue-700'
              }`}
            >
              <Icon className={`w-6 h-6 mb-2 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`} />
              <h3 className={`font-semibold text-sm ${isActive ? 'text-navy-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {tab.label}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {tab.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="mt-8">
        {activeTab === 'roles' && <RolePermissions />}
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'audit' && <AuditTrail />}
      </div>
    </div>
  );
}
