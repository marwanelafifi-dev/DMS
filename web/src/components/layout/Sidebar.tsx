import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, CheckCircle2, Folder, ClipboardList, Lock, Users, FileText, Settings, Home, Bell, Clock, Search as SearchIcon } from 'lucide-react';
import { useState } from 'react';

interface SidebarProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function Sidebar({ isExpanded = false, onToggleExpand }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [tooltipLabel, setTooltipLabel] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const isActive = (path: string) => location.pathname.startsWith(path);

  const menuItem = (
    icon: React.ReactNode,
    label: string,
    path: string,
    badge?: number
  ) => (
    <button
      onClick={() => navigate(path)}
      onMouseEnter={(e) => {
        if (!isExpanded) {
          const rect = e.currentTarget.getBoundingClientRect();
          setTooltipLabel(label);
          setTooltipPos({ x: rect.right + 12, y: rect.top + rect.height / 2 });
        }
      }}
      onMouseLeave={() => setTooltipLabel(null)}
      className={`relative w-full px-4 py-3 flex items-center gap-3 rounded-lg border-l-4 transition-all duration-200 group ${
        isActive(path)
          ? 'bg-blue-50 dark:bg-blue-500/15 border-l-blue-600 dark:border-l-cyan-400 text-navy-900 dark:text-white shadow-sm dark:shadow-none'
          : 'border-l-transparent text-navy-500 dark:text-navy-400 hover:text-navy-900 dark:hover:text-white hover:bg-navy-50 dark:hover:bg-navy-800'
      }`}
      title={label}
    >
      <span className="[&>svg]:w-5 [&>svg]:h-5 flex-shrink-0 transition-all group-hover:scale-110">
        {icon}
      </span>
      {isExpanded && (
        <>
          <span className="flex-1 text-left text-sm font-semibold">{label}</span>
          {badge && (
            <span className="inline-flex items-center justify-center min-w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full shadow-sm">
              {badge}
            </span>
          )}
        </>
      )}
      {!isExpanded && badge && (
        <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-md animate-pulse">
          {badge}
        </span>
      )}
    </button>
  );

  const sectionHeader = (title: string) => {
    if (!isExpanded) return null;
    return (
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-navy-600 dark:text-navy-500 border-t border-navy-100 dark:border-white/10">
        {title}
      </div>
    );
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-white dark:bg-black border-r border-navy-100/50 dark:border-white/10 shadow-sm dark:shadow-black/40 transition-all duration-300 ${
          isExpanded ? 'w-64' : 'w-20'
        }`}
      >
        {/* Header Section */}
        {isExpanded ? (
          <div className="px-4 py-4 border-b border-navy-100/50 dark:border-white/10 flex items-center gap-3 bg-gradient-to-r from-navy-50 to-blue-50 dark:from-navy-950 dark:to-navy-900">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-navy-700 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              D
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-navy-900 dark:text-white truncate">DMS</p>
              <p className="text-xs text-navy-600 dark:text-navy-400 truncate">Si-Ware Systems</p>
            </div>
            <button
              onClick={onToggleExpand}
              className="p-1.5 text-navy-600 dark:text-navy-400 hover:bg-navy-100 dark:hover:bg-white/10 hover:text-navy-900 dark:hover:text-white rounded-lg transition-all duration-200"
              title="Collapse Sidebar"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          </div>
        ) : (
          <div className="py-4 px-2 border-b border-navy-100/50 dark:border-white/10 flex justify-center">
            <button
              onClick={onToggleExpand}
              className="p-2 text-navy-600 dark:text-navy-400 hover:bg-navy-50 dark:hover:bg-white/10 hover:text-navy-900 dark:hover:text-white rounded-lg transition-all duration-200"
              title="Expand Sidebar"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Navigation */}
          {sectionHeader('Navigation')}
          <div className="py-2 px-2">
            {menuItem(<Home />, 'Dashboard', '/dashboard')}
            {menuItem(<CheckCircle2 />, 'My Tasks', '/tasks', 3)}
          </div>

          {/* Vault */}
          {sectionHeader('Vault')}
          <div className="py-2 px-2">
            {menuItem(<Folder />, 'Documents', '/documents')}
            {menuItem(<SearchIcon />, 'Search', '/search')}
            {menuItem(<ClipboardList />, 'Approvals', '/approvals', 2)}
            {menuItem(<Clock />, 'Reminders', '/reminders')}
          </div>

          {/* Administration */}
          {sectionHeader('Administration')}
          <div className="py-2 px-2">
            {menuItem(<Users />, 'Users', '/admin/users')}
            {menuItem(<Lock />, 'Roles', '/admin/roles')}
            {menuItem(<FileText />, 'Audit Trail', '/admin/audit')}
          </div>

          {/* System */}
          {sectionHeader('System')}
          <div className="py-2 px-2">
            {menuItem(<Bell />, 'Notifications', '/notifications')}
          </div>
        </div>

        {/* Bottom - Settings */}
        <div className="py-3 px-2 border-t border-navy-100/50 dark:border-white/10">
          {menuItem(<Settings />, 'Settings', '/settings')}
        </div>
      </aside>

      {/* Tooltip (only shown when collapsed) */}
      {!isExpanded && tooltipLabel && (
        <div
          className="fixed z-50 px-3 py-2 bg-navy-900 dark:bg-black text-white text-sm font-semibold rounded-lg shadow-lg border border-navy-700 dark:border-white/10 whitespace-nowrap pointer-events-none animate-in fade-in"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: 'translateY(-50%)',
          }}
        >
          {tooltipLabel}
          <div
            className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-navy-900 dark:border-r-black"
            style={{ marginRight: '-4px' }}
          />
        </div>
      )}
    </>
  );
}
