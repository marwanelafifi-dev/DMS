import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  ClipboardCheck,
  Eye,
  FileWarning,
  Folder,
  LayoutDashboard,
  Settings,
  X,
} from 'lucide-react';

interface SidebarProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const navItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, exact: true },
  { label: 'Document Library', path: '/documents', icon: Folder },
  { label: 'Preview Canvas', path: '/documents/doc-1', icon: Eye, preview: true },
  { label: 'C-Doc Workflow', path: '/approvals', icon: ClipboardCheck },
  { label: 'PCAR / Corrective Action', path: '/tasks', icon: FileWarning },
  { label: 'Admin Panel', path: '/admin/roles', icon: Settings, admin: true },
];

export function Sidebar({ isExpanded = false, onToggleExpand }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: (typeof navItems)[number]) => {
    if (item.exact) return location.pathname === '/';
    if (item.preview) return /^\/documents\/[^/]+/.test(location.pathname);
    if (item.admin) return location.pathname.startsWith('/admin') || location.pathname.startsWith('/settings');
    if (item.path === '/documents') return location.pathname === '/documents';
    return location.pathname.startsWith(item.path);
  };

  const goTo = (item: (typeof navItems)[number]) => {
    if (item.preview) {
      navigate(item.path);
    } else {
      navigate(item.path);
    }
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col bg-[#2f3e83] text-white transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 ${
          isExpanded ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[68px] flex-shrink-0 items-center border-b border-white/10 px-5">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 text-left" aria-label="Go to dashboard">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#54afd2]">
              <span className="absolute -right-0.5 top-1 h-2 w-2 rounded-full bg-[#2f3e83]" />
            </span>
            <span>
              <span className="block text-[16px] font-semibold leading-5">Si-Ware</span>
              <span className="block text-[11px] font-medium uppercase tracking-[0.09em] text-[#69c1df]">Sovereign DMS</span>
            </span>
          </button>
          <button onClick={onToggleExpand} className="ml-auto rounded p-1.5 text-white/75 hover:bg-white/10 lg:hidden" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <button
                key={item.label}
                onClick={() => goTo(item)}
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
