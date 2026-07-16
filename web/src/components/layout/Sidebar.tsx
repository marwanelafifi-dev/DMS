import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle2, Folder, ClipboardList, Settings, ChevronDown, ChevronRight } from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedSections, setExpandedSections] = useState<string[]>(['vault']);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  };

  const isActive = (path: string) => location.pathname.startsWith(path);

  const menuItem = (
    icon: React.ReactNode,
    label: string,
    path: string,
    badge?: number
  ) => (
    <button
      onClick={() => {
        navigate(path);
        onClose?.();
      }}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all ${
        isActive(path)
          ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg'
          : 'text-slate-700 dark:text-slate-300 hover:bg-primary-100 dark:hover:bg-primary-900/20 border border-transparent'
      }`}
    >
      {icon}
      <span className="flex-1 text-left text-sm font-medium">{label}</span>
      {badge ? (
        <span className="bg-error text-white text-xs rounded-full px-2 py-0.5">
          {badge}
        </span>
      ) : null}
    </button>
  );

  const sectionHeader = (title: string, sectionKey: string) => {
    const isExpanded = expandedSections.includes(sectionKey);
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold text-navy-900 dark:text-primary-300 uppercase tracking-widest hover:text-primary-600 dark:hover:text-primary-200 transition-colors mt-4 first:mt-0"
      >
        <span className="flex-1 text-left">{title}</span>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
    );
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static left-0 top-navbar-height-mobile lg:top-0 w-full sm:w-sidebar-width h-[calc(100vh-var(--navbar-mobile-height))] lg:h-screen bg-white dark:bg-navy-800 border-r border-primary-100 dark:border-primary-900 transform transition-transform lg:transform-none z-40 shadow-xl ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } overflow-y-auto flex flex-col`}
      >
        {/* My Tasks Section */}
        <div className="p-4 space-y-2 border-b border-slate-200 dark:border-primary-900">
          <h2 className="text-xs font-extrabold text-navy-900 dark:text-primary-300 uppercase tracking-widest px-2 mb-3 flex items-center gap-2">
            Quick Links
          </h2>
          {menuItem(
            <CheckCircle2 className="w-5 h-5 bg-gradient-to-br from-navy-900 to-primary-500" />,
            'My Tasks',
            '/tasks',
            3
          )}
        </div>

        {/* Vault Section */}
        <div className="flex-1 px-4 space-y-2 overflow-y-auto">
          {sectionHeader('Vault', 'vault')}

          {expandedSections.includes('vault') && (
            <div className="space-y-1 pl-2">
              {menuItem(
                <Folder className="w-5 h-5" />,
                'All Documents',
                '/documents'
              )}
              {menuItem(
                <Folder className="w-5 h-5" />,
                'Recent',
                '/documents?sort=recent'
              )}
              {menuItem(
                <Folder className="w-5 h-5" />,
                'My Uploads',
                '/documents?filter=mine'
              )}
            </div>
          )}

          {sectionHeader('Approvals', 'approvals')}
          {expandedSections.includes('approvals') && (
            <div className="space-y-1 pl-2">
              {menuItem(
                <ClipboardList className="w-5 h-5" />,
                'Pending Approvals',
                '/approvals',
                2
              )}
              {menuItem(
                <ClipboardList className="w-5 h-5" />,
                'Approval History',
                '/approvals/history'
              )}
            </div>
          )}
        </div>

        {/* Settings Section */}
        <div className="p-4 border-t border-slate-200 dark:border-primary-900 space-y-2">
          <h2 className="text-xs font-extrabold text-navy-900 dark:text-primary-300 uppercase tracking-widest px-2 mb-3 flex items-center gap-2">
            Settings
          </h2>
          {menuItem(
            <Settings className="w-5 h-5" />,
            'Permissions',
            '/settings/permissions'
          )}
          {menuItem(
            <Settings className="w-5 h-5" />,
            'Audit Log',
            '/settings/audit'
          )}
        </div>
      </aside>
    </>
  );
}
