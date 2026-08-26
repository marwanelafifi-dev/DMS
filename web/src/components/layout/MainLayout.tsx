import { useCallback, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';
import { ScheduledNoticeBanner } from './ScheduledNoticeBanner';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dms.sidebar.collapsed';

function readStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    // Storage-disabled browsers just start expanded every time.
    return false;
  }
}

export function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Persisted so the icon rail survives a reload, the way a desktop app would.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const location = useLocation();
  // The Document Library manages its own full-height, full-width layout
  // (folder pane + table, both scrolling independently) — the shared
  // centered/padded/width-capped wrapper below is right for a simple page like
  // the Dashboard, but on a wide monitor it left large unused margins on every
  // side of a page that's meant to be a dense working view, not prose-width
  // content.
  const isFullBleedPage = location.pathname.startsWith('/documents');

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Collapse still applies for this session; it just won't be remembered.
      }
      return next;
    });
  }, []);

  // Document dialogs render in a body portal so page-entry transforms cannot
  // turn `position: fixed` into a page-relative offset. Publish the live desktop
  // rail width at the document root so the portal remains exactly beside the
  // sidebar in both expanded and collapsed states.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--dms-sidebar-width', sidebarCollapsed ? '76px' : '286px');
    return () => {
      document.documentElement.style.removeProperty('--dms-sidebar-width');
    };
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f3f6fa] text-[#17213a] dark:bg-slate-950 dark:text-white">
      <Sidebar
        isExpanded={sidebarOpen}
        onToggleExpand={() => setSidebarOpen((open) => !open)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ScheduledNoticeBanner />
        <Navbar onMenuClick={() => setSidebarOpen((open) => !open)} />

        <main className="flex-1 overflow-y-auto bg-[#f3f6fa] dark:bg-slate-950">
          <div
            key={location.pathname}
            className={
              isFullBleedPage
                ? 'page-transition h-full w-full'
                : 'page-transition mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7'
            }
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
