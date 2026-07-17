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
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
        isActive(path)
          ? 'bg-white text-navy-900 shadow-sm'
          : 'text-navy-100 hover:bg-navy-800'
      }`}
    >
      <span className="flex-shrink-0 [&>svg]:w-[18px] [&>svg]:h-[18px]">{icon}</span>
      <span className="flex-1 text-left text-sm font-medium">{label}</span>
      {badge ? (
        <span className="bg-red-600 text-white text-[11px] rounded-full min-w-[20px] h-5 flex items-center justify-center font-semibold px-1">
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
        className="w-full flex items-center gap-2 px-4 py-2 text-sm font-serif font-semibold text-navy-200 tracking-tight hover:text-white transition-colors rounded-lg"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
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
        <div className="p-4 space-y-1 border-b border-navy-800">
          <h2 className="text-sm font-serif font-semibold text-navy-200 tracking-tight px-4 mb-2">
            Quick Links
          </h2>
          {menuItem(
            <CheckCircle2 />,
            'My Tasks',
            '/tasks',
            3
          )}
        </div>

        {/* Vault & Approvals Section */}
        <div className="px-4 py-2 space-y-1">
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
        <div className="px-4 py-3 border-t border-navy-800">
          {sectionHeader('Admin Panel', 'admin')}

          {expandedSections.includes('admin') && (
            <div className="space-y-1 pl-2 mt-1">
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
