import { Fragment, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageAccess } from '../../hooks/usePageAccess';
import { apiClient, type HeaderSettings, type PageAccessRoleFlags } from '../../utils/api';
import {
  Bell,
  BellRing,
  Building2,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileWarning,
  Folder,
  LayoutDashboard,
  KeyRound,
  History,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  Users,
  UsersRound,
  X,
} from 'lucide-react';

interface SidebarProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  // Desktop-only icon-rail mode. The mobile drawer always opens at full width,
  // so every collapse-related class below is `lg:`-scoped on purpose.
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navItems: Array<{ label: string; path: string; icon: typeof LayoutDashboard; exact?: boolean; visibleWhen: keyof PageAccessRoleFlags }> = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, exact: true, visibleWhen: 'canViewDashboard' },
  { label: 'Document Library', path: '/documents', icon: Folder, visibleWhen: 'canViewDocumentLibrary' },
  { label: 'Document Workflow', path: '/approvals', icon: ClipboardCheck, visibleWhen: 'canViewApprovals' },
  { label: 'Tasks (Internal Use)', path: '/tasks', icon: ClipboardCheck, visibleWhen: 'canViewTasks' },
  { label: 'PCAR (Auditor Findings)', path: '/pcars', icon: FileWarning, visibleWhen: 'canViewPcar' },
  { label: 'Reminders', path: '/reminders', icon: BellRing, visibleWhen: 'canViewReminders' },
  { label: 'Task / PCAR Reminder Policy', path: '/reminders/policy', icon: Bell, visibleWhen: 'canManageTaskReminderPolicy' },
  { label: 'Send Announcement', path: '/send-announcement', icon: Megaphone, visibleWhen: 'canSendAnnouncements' },
];

const adminItems = [
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Roles', path: '/admin/roles', icon: Shield },
  { label: 'Groups', path: '/admin/groups', icon: UsersRound },
  { label: 'Settings', path: '/admin/settings', icon: SettingsIcon },
  { label: 'Notifications', path: '/admin/notifications', icon: Bell },
  { label: 'Company Data', path: '/admin/company-data', icon: Building2 },
  { label: 'Audit Trail', path: '/admin/audit', icon: ScrollText },
  { label: 'Database', path: '/admin/database', icon: Database },
  { label: 'API Keys', path: '/admin/api-keys', icon: KeyRound },
];

export function Sidebar({ isExpanded = false, onToggleExpand, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const pageAccess = usePageAccess();
  // Never optimistically render navigation while permissions are loading.
  // Besides creating a distracting flash, doing so reveals page names to an
  // account that may not be authorized to know those areas exist.
  const visibleNavItems = pageAccess
    ? navItems.filter((item) => pageAccess[item.visibleWhen] === true)
    : [];
  const canViewAdminPanel = pageAccess?.canViewAdminPanel === true;
  const isAdminRoute = location.pathname.startsWith('/admin') || location.pathname.startsWith('/settings');
  const [adminOpen, setAdminOpen] = useState(isAdminRoute);
  const [headerConfig, setHeaderConfig] = useState<HeaderSettings>({ showLogoInHeader: true, logoAltText: 'Si-Ware' });

  useEffect(() => {
    if (isAdminRoute) setAdminOpen(true);
  }, [isAdminRoute]);

  useEffect(() => {
    apiClient.getPlatformSettings()
      .then((res) => { if (res.success && res.data?.header) setHeaderConfig(res.data.header); })
      .catch(() => {});
  }, []);

  const isActive = (item: (typeof navItems)[number]) => {
    if (item.exact) return location.pathname === '/';
    if (item.path === '/documents' || item.path === '/tasks' || item.path === '/reminders') return location.pathname === item.path;
    return location.pathname.startsWith(item.path);
  };

  const goTo = (path: string) => {
    navigate(path);
    if (isExpanded) onToggleExpand?.();
  };

  return (
    <>
      {isExpanded && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden"
          onClick={onToggleExpand}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col bg-gradient-to-b from-[#283777] via-[#1f2c5f] to-[#12193d] text-white transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 lg:transition-[width] ${
          isExpanded ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'lg:w-[76px]' : 'lg:w-[286px]'}`}
      >
        <div className="relative flex h-[68px] flex-shrink-0 items-center justify-center border-b border-[#dbe2ec] bg-white px-5 dark:border-slate-950 dark:bg-slate-950">
          {headerConfig.showLogoInHeader && (
            <button
              onClick={() => navigate('/')}
              className={`flex items-center justify-center ${isCollapsed ? 'lg:hidden' : ''}`}
              aria-label="Go to dashboard"
            >
              {headerConfig.logoObjectKey ? (
                <img src="/api/branding/logo/header" alt={headerConfig.logoAltText} className="h-9 w-auto max-w-[200px] object-contain" />
              ) : (
                <>
                  <img src="/images/si-ware-logo.png" alt={headerConfig.logoAltText} width="129" height="36" className="block h-9 w-auto max-w-[200px] object-contain dark:hidden" />
                  <img src="/images/si-ware-logo-dark.png" alt={headerConfig.logoAltText} width="129" height="36" loading="lazy" className="hidden h-9 w-auto max-w-[200px] object-contain dark:block" />
                </>
              )}
            </button>
          )}
          <button onClick={onToggleExpand} className="absolute right-4 rounded p-1.5 text-[#52627a] hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse toggle. Centred when the rail is collapsed (the logo
              is hidden there), tucked to the right alongside the logo otherwise. */}
          <button
            onClick={onToggleCollapse}
            className={`hidden rounded p-1.5 text-[#52627a] hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10 lg:block ${
              isCollapsed ? '' : 'absolute right-3'
            }`}
            aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {isCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Fragment key={item.label}>
                <button
                  onClick={() => goTo(item.path)}
                  title={isCollapsed ? item.label : undefined}
                  className={`flex h-[43px] w-full items-center gap-3 border-l-[3px] px-5 text-left text-[15px] transition-colors ${
                    active
                      ? 'border-[#70a3e8] bg-white/[0.12] font-semibold text-white'
                      : 'border-transparent font-medium text-white/92 hover:bg-white/[0.08]'
                  } ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}
                >
                  <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.9} />
                  <span className={isCollapsed ? 'lg:hidden' : ''}>{item.label}</span>
                </button>
                {item.path === '/pcars' && pageAccess?.canViewHistoricalPcars && (
                  <button
                    onClick={() => goTo('/tasks/history')}
                    title={isCollapsed ? 'Historical PCAR Archive' : undefined}
                    className={`flex h-[38px] w-full items-center gap-3 border-l-[3px] pl-11 pr-5 text-left text-sm transition-colors ${
                      location.pathname === '/tasks/history' ? 'border-[#70a3e8] bg-white/[0.12] font-semibold text-[#7dd3fc]' : 'border-transparent text-white/80 hover:bg-white/[0.08] hover:text-white'
                    } ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}
                  >
                    <History className="h-4 w-4 flex-shrink-0 text-[#7dd3fc]" strokeWidth={1.9} />
                    <span className={isCollapsed ? 'lg:hidden' : ''}>Historical PCAR Archive</span>
                  </button>
                )}
              </Fragment>
            );
          })}

          {canViewAdminPanel && (
          <button
            onClick={() => {
              // The submenu has nowhere to render inside a 76px icon rail, so
              // opening Admin from the collapsed state expands the rail first
              // rather than silently doing nothing.
              if (isCollapsed) {
                onToggleCollapse?.();
                setAdminOpen(true);
                return;
              }
              setAdminOpen((open) => !open);
            }}
            title={isCollapsed ? 'Admin Panel' : undefined}
            className={`flex h-[43px] w-full items-center gap-3 border-l-[3px] px-5 text-left text-[15px] transition-colors ${
              isAdminRoute
                ? 'border-[#70a3e8] bg-white/[0.12] font-semibold text-white'
                : 'border-transparent font-medium text-white/92 hover:bg-white/[0.08]'
            } ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}
          >
            <SettingsIcon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.9} />
            <span className={`flex-1 ${isCollapsed ? 'lg:hidden' : ''}`}>Admin Panel</span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-white/60 transition-transform ${adminOpen ? 'rotate-180' : ''} ${isCollapsed ? 'lg:hidden' : ''}`} />
          </button>
          )}
          {canViewAdminPanel && adminOpen && (
            <div className={`pb-1 pt-1 ${isCollapsed ? 'lg:hidden' : ''}`}>
              {adminItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.label}
                    onClick={() => goTo(item.path)}
                    className={`flex h-[38px] w-full items-center gap-3 pl-11 pr-5 text-left text-sm transition-colors ${
                      active ? 'font-semibold text-[#7dd3fc]' : 'text-white/80 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-[#7dd3fc]" strokeWidth={1.9} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}

        </nav>

        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-white/35">
          <span className={isCollapsed ? 'lg:hidden' : ''}>v3.2.1 · Build 20260721</span>
          <span className={`hidden ${isCollapsed ? 'lg:block lg:text-center' : ''}`}>v3.2</span>
        </div>
      </aside>
    </>
  );
}
