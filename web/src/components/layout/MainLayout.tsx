import { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f3f6fa] text-[#17213a] dark:bg-slate-950 dark:text-white">
      <Sidebar
        isExpanded={sidebarOpen}
        onToggleExpand={() => setSidebarOpen((open) => !open)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar onMenuClick={() => setSidebarOpen((open) => !open)} />

        <main className="flex-1 overflow-y-auto bg-[#f3f6fa] dark:bg-slate-950">
          <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
