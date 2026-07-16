import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Icon components (svg)
const CheckCircleIcon = ({ className }: { className?: string }) => <svg className={className || "w-5 h-5"} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;
const FolderIcon = ({ className }: { className?: string }) => <svg className={className || "w-5 h-5"} fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>;
const ClipboardListIcon = ({ className }: { className?: string }) => <svg className={className || "w-5 h-5"} fill="currentColor" viewBox="0 0 20 20"><path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" /><path fillRule="evenodd" d="M3 7h14v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0V4h14v3H3z" clipRule="evenodd" /></svg>;
const CogIcon = ({ className }: { className?: string }) => <svg className={className || "w-5 h-5"} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const ChevronDownIcon = ({ className }: { className?: string }) => <svg className={className || "w-4 h-4"} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>;
const ChevronRightIcon = ({ className }: { className?: string }) => <svg className={className || "w-4 h-4"} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;

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
      className={`w-full flex items-center gap-3 px-4 py-2 rounded-md transition-colors ${
        isActive(path)
          ? 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
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
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-300 transition-colors mt-4 first:mt-0"
      >
        <span className="flex-1 text-left">{title}</span>
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4" />
        ) : (
          <ChevronRightIcon className="w-4 h-4" />
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
        className={`fixed lg:static left-0 top-navbar-height-mobile lg:top-0 w-full sm:w-sidebar-width h-[calc(100vh-var(--navbar-mobile-height))] lg:h-screen bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform lg:transform-none z-40 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } overflow-y-auto flex flex-col`}
      >
        {/* My Tasks Section */}
        <div className="p-4 space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-2 mb-3">
            Quick Links
          </h2>
          {menuItem(
            <CheckCircleIcon className="w-5 h-5" />,
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
                <FolderIcon className="w-5 h-5" />,
                'All Documents',
                '/documents'
              )}
              {menuItem(
                <FolderIcon className="w-5 h-5" />,
                'Recent',
                '/documents?sort=recent'
              )}
              {menuItem(
                <FolderIcon className="w-5 h-5" />,
                'My Uploads',
                '/documents?filter=mine'
              )}
            </div>
          )}

          {sectionHeader('Approvals', 'approvals')}
          {expandedSections.includes('approvals') && (
            <div className="space-y-1 pl-2">
              {menuItem(
                <ClipboardListIcon className="w-5 h-5" />,
                'Pending Approvals',
                '/approvals',
                2
              )}
              {menuItem(
                <ClipboardListIcon className="w-5 h-5" />,
                'Approval History',
                '/approvals/history'
              )}
            </div>
          )}
        </div>

        {/* Settings Section */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-2 mb-3">
            Settings
          </h2>
          {menuItem(
            <CogIcon className="w-5 h-5" />,
            'Permissions',
            '/settings/permissions'
          )}
          {menuItem(
            <CogIcon className="w-5 h-5" />,
            'Audit Log',
            '/settings/audit'
          )}
        </div>
      </aside>
    </>
  );
}
