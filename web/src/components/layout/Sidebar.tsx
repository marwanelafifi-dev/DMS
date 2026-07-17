import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle2, Folder, ClipboardList, ChevronDown, ChevronRight, Lock, Users, FileText } from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedSections, setExpandedSections] = useState<string[]>(['admin']);

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
          ? 'bg-white text-navy-900 shadow-lg'
          : 'text-white hover:bg-navy-900 border border-transparent'
      }`}
    >
      {icon}
      <span className="flex-1 text-left text-sm font-medium">{label}</span>
      {badge ? (
        <span className="bg-red-600 text-white text-xs rounded-full px-2 py-0.5 font-bold">
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
        className="w-full flex items-center gap-3 px-4 py-3 text-xs font-extrabold text-white uppercase tracking-widest hover:bg-navy-900 hover:text-gray-200 transition-colors mt-4 first:mt-0 rounded-lg"
      >
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 flex-shrink-0 text-blue-400" />
        ) : (
          <ChevronRight className="w-5 h-5 flex-shrink-0 text-gray-400" />
        )}
        <span className="flex-1 text-left">{title}</span>
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
        className={`fixed lg:static left-0 top-navbar-height-mobile lg:top-0 w-full sm:w-sidebar-width h-[calc(100vh-var(--navbar-mobile-height))] lg:h-full bg-navy-900 border-r border-navy-800 transform transition-transform lg:transform-none z-40 shadow-xl ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } flex flex-col overflow-y-auto`}
      >
        {/* My Tasks Section */}
        <div className="p-4 space-y-2 border-b border-navy-800">
          <h2 className="text-xs font-extrabold text-white uppercase tracking-widest px-2 mb-3 flex items-center gap-2">
            Quick Links
          </h2>
          {menuItem(
            <CheckCircle2 className="w-5 h-5 bg-gradient-to-br from-navy-900 to-primary-500" />,
            'My Tasks',
            '/tasks',
            3
          )}
        </div>

        {/* Vault & Approvals Section */}
        <div className="flex-1 px-4 space-y-2 overflow-y-auto min-h-0">
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

        {/* Admin Panel Section */}
        <div className="p-4 border-t border-navy-800">
          {sectionHeader('Admin Panel', 'admin')}

          {expandedSections.includes('admin') && (
            <div className="space-y-1 pl-2 mt-2">
              {menuItem(
                <Users className="w-5 h-5" />,
                'Users',
                '/admin/users'
              )}
              {menuItem(
                <Lock className="w-5 h-5" />,
                'Roles',
                '/admin/roles'
              )}
              {menuItem(
                <FileText className="w-5 h-5" />,
                'Audit Trail',
                '/admin/audit'
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
