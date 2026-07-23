import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './components/pages/Dashboard';
import { Documents } from './components/pages/Documents';
import { Settings } from './components/pages/Settings';
import { Tasks } from './components/pages/Tasks';
import { Approvals } from './components/pages/Approvals';
import { Reminders } from './components/pages/Reminders';
import { Search } from './components/pages/Search';
import { Toaster } from 'sonner';

function App() {
  return (
    <Router>
      <Routes>
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
      </Routes>

      {/* Toast notifications */}
      <Toaster position="bottom-right" />
    </Router>
  );
}

export default App;
