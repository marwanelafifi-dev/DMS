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

            {/* Tasks */}
            <Route
              path="/tasks"
              element={
                <MainLayout>
                  <Tasks />
                </MainLayout>
              }
            />

            {/* Documents */}
            <Route
              path="/documents"
              element={
                <MainLayout>
                  <Documents />
                </MainLayout>
              }
            />

            {/* Approvals */}
            <Route
              path="/approvals"
              element={
                <MainLayout>
                  <Approvals />
                </MainLayout>
              }
            />

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
