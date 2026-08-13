import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './components/pages/Dashboard';
import { Documents } from './components/pages/Documents';
import { Settings } from './components/pages/Settings';
import { Tasks } from './components/pages/Tasks';
import { Approvals } from './components/pages/Approvals';
import { Reminders } from './components/pages/Reminders';
import { SendAnnouncement } from './components/pages/SendAnnouncement';
import { Search } from './components/pages/Search';
import { Login } from './components/pages/Login';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { usePageAccess } from './hooks/usePageAccess';
import type { PageAccessRoleFlags } from './utils/api';
import { Toaster } from 'sonner';

function RequireAuth() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

// Second layer of defense beyond hiding the Sidebar link — a user who
// navigates straight to a URL for a page their role can't see gets bounced
// to the Dashboard instead of the page silently rendering.
function RequirePageAccess({ flag }: { flag: keyof PageAccessRoleFlags }) {
  const access = usePageAccess();

  if (access === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" />
      </div>
    );
  }

  if (!access[flag]) return <Navigate to="/" replace />;

  return <Outlet />;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RequireAuth />}>
            {/* MainLayout (Sidebar + Navbar) is now a single shared parent
                route rendered once via <Outlet/> — it no longer unmounts and
                remounts on every navigation the way it did when each route
                below wrapped its own separate <MainLayout> instance. */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<Dashboard />} />

              {/* Tasks (sidebar label: PCAR / Corrective Action) */}
              <Route element={<RequirePageAccess flag="canViewPcar" />}>
                <Route path="/tasks" element={<Tasks />} />
              </Route>

              {/* Documents */}
              <Route path="/documents" element={<Documents />} />

              {/* Approvals (sidebar label: C-Doc Workflow) */}
              <Route element={<RequirePageAccess flag="canViewApprovals" />}>
                <Route path="/approvals" element={<Approvals />} />
              </Route>

              {/* Reminders */}
              <Route path="/reminders" element={<Reminders />} />

              {/* Send Announcement — posting is Full Access/Quality by default,
                  but role-editable via the new CanSendAnnouncements flag */}
              <Route element={<RequirePageAccess flag="canSendAnnouncements" />}>
                <Route path="/send-announcement" element={<SendAnnouncement />} />
              </Route>

              {/* Search */}
              <Route path="/search" element={<Search />} />

              {/* Admin Panel */}
              <Route element={<RequirePageAccess flag="canViewAdminPanel" />}>
                <Route path="/admin/users" element={<Settings defaultTab="users" />} />
                <Route path="/admin/roles" element={<Settings defaultTab="roles" />} />
                <Route path="/admin/groups" element={<Settings defaultTab="groups" />} />
                <Route path="/admin/audit" element={<Settings defaultTab="audit" />} />
                <Route path="/admin/settings" element={<Settings defaultTab="settings" />} />
                <Route path="/admin/notifications" element={<Settings defaultTab="notifications" />} />
                <Route path="/admin/company-data" element={<Settings defaultTab="company-data" />} />
                <Route path="/admin/database" element={<Settings defaultTab="database" />} />
              </Route>

              {/* Legacy settings routes */}
              <Route path="/settings/*" element={<Settings />} />

              {/* 404 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </Router>
  );
}

export default App;
