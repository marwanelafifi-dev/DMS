import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ClipboardCheck,
  Database,
  FileWarning,
  Folder,
  LayoutDashboard,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  Users,
  X,
} from 'lucide-react';

interface SidebarProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, exact: true },
  { label: 'Document Library', path: '/documents', icon: Folder },
  { label: 'C-Doc Workflow', path: '/approvals', icon: ClipboardCheck },
  { label: 'PCAR / Corrective Action', path: '/tasks', icon: FileWarning },
];

const adminItems = [
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Roles', path: '/admin/roles', icon: Shield },
  { label: 'Settings', path: '/admin/settings', icon: SettingsIcon },
  { label: 'Notifications', path: '/admin/notifications', icon: Bell },
  { label: 'Company Data', path: '/admin/company-data', icon: Building2 },
  { label: 'Audit Trail', path: '/admin/audit', icon: ScrollText },
  { label: 'Database', path: '/admin/database', icon: Database },
];

export function Sidebar({ isExpanded = false, onToggleExpand }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin') || location.pathname.startsWith('/settings');
  const [adminOpen, setAdminOpen] = useState(isAdminRoute);

  useEffect(() => {
    if (isAdminRoute) setAdminOpen(true);
  }, [isAdminRoute]);

  const isActive = (item: (typeof navItems)[number]) => {
    if (item.exact) return location.pathname === '/';
    if (item.path === '/documents') return location.pathname === '/documents';
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col bg-gradient-to-b from-[#283777] via-[#1f2c5f] to-[#12193d] text-white transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 ${
          isExpanded ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative flex h-[68px] flex-shrink-0 items-center justify-center border-b border-[#dbe2ec] bg-white px-5 dark:border-slate-950 dark:bg-slate-950">
          <button onClick={() => navigate('/')} className="flex items-center justify-center" aria-label="Go to dashboard">
            <img src="/images/si-ware-logo.png" alt="Si-Ware" className="block h-9 w-auto max-w-[200px] object-contain dark:hidden" />
            <img src="/images/si-ware-logo-dark.png" alt="Si-Ware" className="hidden h-9 w-auto max-w-[200px] object-contain dark:block" />
          </button>
          <button onClick={onToggleExpand} className="absolute right-4 rounded p-1.5 text-[#52627a] hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <button
                key={item.label}
                onClick={() => goTo(item.path)}
                className={`flex h-[43px] w-full items-center gap-3 border-l-[3px] px-5 text-left text-[15px] transition-colors ${
                  active
                    ? 'border-[#70a3e8] bg-white/[0.12] font-semibold text-white'
                    : 'border-transparent font-medium text-white/92 hover:bg-white/[0.08]'
                }`}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.9} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            onClick={() => setAdminOpen((open) => !open)}
            className={`flex h-[43px] w-full items-center gap-3 border-l-[3px] px-5 text-left text-[15px] transition-colors ${
              isAdminRoute
                ? 'border-[#70a3e8] bg-white/[0.12] font-semibold text-white'
                : 'border-transparent font-medium text-white/92 hover:bg-white/[0.08]'
            }`}
          >
            <SettingsIcon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.9} />
            <span className="flex-1">Admin Panel</span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-white/60 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
          </button>
          {adminOpen && (
            <div className="pb-1 pt-1">
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

          <div className="px-5 pb-2 pt-5 text-[11px] font-medium uppercase tracking-[0.1em] text-white/45">Compliance</div>
          <div className="space-y-1 px-5">
            <div className="flex items-center gap-2.5 py-2 text-xs text-white/65">
              <span className="h-2.5 w-2.5 rounded-full bg-[#58d68d]" />
              ISO 9001:2015
            </div>
            <div className="flex items-center gap-2.5 py-2 text-xs text-white/65">
              <span className="h-2.5 w-2.5 rounded-full bg-[#58d68d]" />
              ISO 27001:2022
            </div>
          </div>
        </nav>

        <div className="border-t border-white/10 px-4 py-4 text-xs text-white/55">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4" />
            <span>On-Premises Vault</span>
          </div>
          <div className="mt-2 text-[11px] text-white/35">v3.2.1 · Build 20260721</div>
        </div>
      </aside>
    </>
  );
}
