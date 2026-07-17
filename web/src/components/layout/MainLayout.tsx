import { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="h-screen bg-white dark:bg-black flex flex-col transition-colors duration-300">
      {/* Top Navbar */}
      <Navbar onMenuClick={() => setSidebarExpanded(!sidebarExpanded)} />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          isExpanded={sidebarExpanded}
          onToggleExpand={() => setSidebarExpanded(!sidebarExpanded)}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-white dark:bg-black dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,_#002E5C33,_transparent)] transition-colors duration-300">
          <div className="w-full mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
