import { useEffect, useState } from 'react';
import { Card, CardBody } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { History, RotateCcw, Download, Eye, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import type { DocumentVersion } from '../../types';

interface DocumentVersionHistoryProps {
  documentId: string;
  onClose?: () => void;
}

export function DocumentVersionHistory({ documentId, onClose }: DocumentVersionHistoryProps) {
  const { showSuccess, showError } = useToast();
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [documentId]);

  const loadVersions = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getDocumentVersions(documentId);
      setVersions(res.data || []);
    } catch (err: any) {
      showError('Failed to load document versions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    setIsRollingBack(true);
    try {
      await apiClient.rollbackVersion(documentId, versionId);
      showSuccess('Document rolled back to selected version');
      loadVersions();
      setSelectedVersion(null);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to rollback version');
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleDownload = async (versionId: string) => {
    try {
      const blob = await apiClient.downloadDocument(documentId, versionId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `document-v${versionId}.pdf`;
      a.click();
      showSuccess('Version downloaded');
    } catch (err: any) {
      showError('Failed to download version');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-navy-900 dark:text-white" />
          <h3 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Version History</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {isLoading ? (
        <SkeletonTable />
      ) : versions.length === 0 ? (
        <Card className="bg-gray-50 dark:bg-navy-950">
          <CardBody>
            <p className="text-center text-gray-500 dark:text-gray-400">No versions available</p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 dark:bg-navy-900 border-b border-gray-200 dark:border-navy-700">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Version</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Created</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Created By</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Size</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version, idx) => (
                  <tr
                    key={version.versionId}
                    className={`border-b border-gray-200 dark:border-navy-700 ${
                      idx % 2 === 1 ? 'bg-gray-50 dark:bg-navy-850' : 'bg-white dark:bg-navy-950'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <span className="font-medium text-navy-900 dark:text-white">
                        v{version.versionNumber ?? version.version}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(version.createdAt ?? version.uploadedAt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {version.uploadedByUser?.fullName || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {version.fileSize ? `${(version.fileSize / 1024).toFixed(2)} KB` : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedVersion(version)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors"
                          title="View version"
                        >
                          <Eye className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </button>
                        <button
                          onClick={() => handleDownload(version.versionId)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors"
                          title="Download version"
                        >
                          <Download className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </button>
                        <button
                          onClick={() => handleRollback(version.versionId)}
                          disabled={isRollingBack}
                          className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
                          title="Rollback to this version"
                        >
                          <RotateCcw className="w-4 h-4 text-blue-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selectedVersion && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-300">Version Details</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                Version {selectedVersion.versionNumber ?? selectedVersion.version} • {formatDate(selectedVersion.createdAt ?? selectedVersion.uploadedAt)}
              </p>
            </div>
            <button
              onClick={() => setSelectedVersion(null)}
              className="text-blue-600 hover:text-blue-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
