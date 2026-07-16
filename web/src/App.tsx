import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './components/pages/Dashboard';
import { Documents } from './components/pages/Documents';
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
                <h1 className="text-3xl font-bold mb-4">Tasks</h1>
                <p className="text-gray-600 dark:text-gray-400">
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
              <div className="py-8">
                <h1 className="text-3xl font-bold mb-4">Document Viewer</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Document viewer coming soon...
                </p>
              </div>
            </MainLayout>
          }
        />

        {/* Approvals */}
        <Route
          path="/approvals"
          element={
            <MainLayout>
              <div className="py-8">
                <h1 className="text-3xl font-bold mb-4">Approvals</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Approval workflows coming soon...
                </p>
              </div>
            </MainLayout>
          }
        />

        {/* Settings */}
        <Route
          path="/settings/*"
          element={
            <MainLayout>
              <div className="py-8">
                <h1 className="text-3xl font-bold mb-4">Settings</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Settings panel coming soon...
                </p>
              </div>
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
