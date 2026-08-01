import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './components/pages/Dashboard';
import { Documents } from './components/pages/Documents';
import { Settings } from './components/pages/Settings';
import { Tasks } from './components/pages/Tasks';
import { Approvals } from './components/pages/Approvals';
import { Reminders } from './components/pages/Reminders';
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
            <Route
              path="/"
              element={
                <MainLayout>
                  <Dashboard />
                </MainLayout>
              }
            />

            {/* Tasks (sidebar label: PCAR / Corrective Action) */}
            <Route element={<RequirePageAccess flag="canViewPcar" />}>
              <Route
                path="/tasks"
                element={
                  <MainLayout>
                    <Tasks />
                  </MainLayout>
                }
              />
            </Route>

            {/* Documents */}
            <Route
              path="/documents"
              element={
                <MainLayout>
                  <Documents />
                </MainLayout>
              }
            />

            {/* Approvals (sidebar label: C-Doc Workflow) */}
            <Route element={<RequirePageAccess flag="canViewApprovals" />}>
              <Route
                path="/approvals"
                element={
                  <MainLayout>
                    <Approvals />
                  </MainLayout>
                }
              />
            </Route>

            {/* Reminders */}
            <Route
              path="/reminders"
              element={
                <MainLayout>
                  <Reminders />
                </MainLayout>
              }
            />

            {/* Search */}
            <Route
              path="/search"
              element={
                <MainLayout>
                  <Search />
                </MainLayout>
              }
            />

            {/* Admin Panel */}
            <Route element={<RequirePageAccess flag="canViewAdminPanel" />}>
              <Route
                path="/admin/users"
                element={
                  <MainLayout>
                    <Settings defaultTab="users" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/roles"
                element={
                  <MainLayout>
                    <Settings defaultTab="roles" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/groups"
                element={
                  <MainLayout>
                    <Settings defaultTab="groups" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/audit"
                element={
                  <MainLayout>
                    <Settings defaultTab="audit" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/settings"
                element={
                  <MainLayout>
                    <Settings defaultTab="settings" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/notifications"
                element={
                  <MainLayout>
                    <Settings defaultTab="notifications" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/company-data"
                element={
                  <MainLayout>
                    <Settings defaultTab="company-data" />
                  </MainLayout>
                }
              />

              <Route
                path="/admin/database"
                element={
                  <MainLayout>
                    <Settings defaultTab="database" />
                  </MainLayout>
                }
              />
            </Route>

            {/* Legacy settings routes */}
            <Route
              path="/settings/*"
              element={
                <MainLayout>
                  <Settings />
                </MainLayout>
              }
            />

            {/* 404 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </Router>
  );
}

export default App;
