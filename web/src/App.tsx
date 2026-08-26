import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { usePageAccess } from './hooks/usePageAccess';
import type { PageAccessRoleFlags } from './utils/api';
import { Toaster } from 'sonner';

const MainLayout = lazy(() => import('./components/layout/MainLayout').then((module) => ({ default: module.MainLayout })));
const Dashboard = lazy(() => import('./components/pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Documents = lazy(() => import('./components/pages/Documents').then((module) => ({ default: module.Documents })));
const Settings = lazy(() => import('./components/pages/Settings').then((module) => ({ default: module.Settings })));
const Tasks = lazy(() => import('./components/pages/Tasks').then((module) => ({ default: module.Tasks })));
const Approvals = lazy(() => import('./components/pages/Approvals').then((module) => ({ default: module.Approvals })));
const Reminders = lazy(() => import('./components/pages/Reminders').then((module) => ({ default: module.Reminders })));
const SendAnnouncement = lazy(() => import('./components/pages/SendAnnouncement').then((module) => ({ default: module.SendAnnouncement })));
const Search = lazy(() => import('./components/pages/Search').then((module) => ({ default: module.Search })));
const Login = lazy(() => import('./components/pages/Login').then((module) => ({ default: module.Login })));

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950" role="status" aria-label="Loading page">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#2f6f9f]" />
    </div>
  );
}

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

// A user who never had access to a page simply never sees its Sidebar link —
// but nothing stopped them from typing/bookmarking the URL directly and having
// it silently render anyway. Bouncing them back to "/" isn't right either: it
// looks like the click just didn't work, with no explanation of why. This shows
// an explicit "you don't have permission" page instead, still inside the normal
// Sidebar/Navbar chrome (nested under MainLayout), so it reads as a deliberate
// block rather than a broken link or a stray redirect.
function AccessDeniedPage() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
        <ShieldAlert className="h-7 w-7 text-red-500" />
      </div>
      <h1 className="page-heading">Access Denied</h1>
      <p className="max-w-md text-sm text-[#718198] dark:text-slate-400">
        You don't have permission to view this page. If you believe this is a mistake, contact your administrator.
      </p>
      <Link to="/" className="mt-2 text-sm font-medium text-[#3f8bca] hover:underline">Back to Dashboard</Link>
    </div>
  );
}

function RequirePageAccess({ flag }: { flag: keyof PageAccessRoleFlags }) {
  const access = usePageAccess();

  if (access === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dbe2ec] border-t-[#3f8bca]" />
      </div>
    );
  }

  if (!access[flag]) return <AccessDeniedPage />;

  return <Outlet />;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<RouteLoading />}>
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
              <Route element={<RequirePageAccess flag="canViewDocumentLibrary" />}>
                <Route path="/documents" element={<Documents />} />
              </Route>

              {/* Approvals (sidebar label: C-Doc Workflow) */}
              <Route element={<RequirePageAccess flag="canViewApprovals" />}>
                <Route path="/approvals" element={<Approvals />} />
              </Route>

              {/* Reminders */}
              <Route element={<RequirePageAccess flag="canViewReminders" />}>
                <Route path="/reminders" element={<Reminders />} />
              </Route>

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
        </Suspense>
      </AuthProvider>

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </Router>
  );
}

export default App;
