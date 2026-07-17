import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './components/pages/Dashboard';
import { Documents } from './components/pages/Documents';
import { DocumentViewer } from './components/pages/DocumentViewer';
import { Settings } from './components/pages/Settings';
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
              <div className="py-8">
                <h1 className="text-3xl font-serif font-bold tracking-tight mb-4 text-navy-900 dark:text-white">Tasks</h1>
                <p className="text-navy-500 dark:text-navy-300">
                  Task management coming soon...
                </p>
              </div>
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

        {/* Document Viewer */}
        <Route
          path="/documents/:id"
          element={
            <MainLayout>
              <DocumentViewer />
            </MainLayout>
          }
        />

        {/* Approvals */}
        <Route
          path="/approvals"
          element={
            <MainLayout>
              <div className="py-8">
                <h1 className="text-3xl font-serif font-bold tracking-tight mb-4 text-navy-900 dark:text-white">Approvals</h1>
                <p className="text-navy-500 dark:text-navy-300">
                  Approval workflows coming soon...
                </p>
              </div>
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
