import { useState } from 'react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen bg-navy-900 dark:bg-navy-900 flex flex-col">
      {/* Top Navbar */}
      <Navbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-navy-900 dark:bg-navy-900">
          <div className="max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
