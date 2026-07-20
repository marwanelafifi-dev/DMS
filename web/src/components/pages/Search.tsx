import { useState } from 'react';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Search as SearchIcon, Eye, ChevronRight } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import type { Document } from '../../types';

export function Search() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Advanced filters
  const [filters, setFilters] = useState({
    status: '',
    owner: '',
    dateFrom: '',
    dateTo: '',
    fileType: '',
    minSize: '',
    maxSize: '',
  });

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      showError('Please enter a search query');
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    try {
      // Use simple search for now, advanced search can use advancedSearch endpoint once implemented
      const res = await apiClient.searchDocuments(searchQuery, filters);
      setResults(res.data || []);
      if (res.data?.length === 0) {
        showSuccess(`No documents found matching "${searchQuery}"`);
      } else {
        showSuccess(`Found ${res.data?.length} document(s)`);
      }
    } catch (err: any) {
      // Fallback to getDocuments if search endpoint isn't available
      try {
        const res = await apiClient.getDocuments();
        const filtered = (res.data || []).filter((doc: Document) =>
          (doc.title ?? doc.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        );
        setResults(filtered);
        if (filtered.length === 0) {
          showSuccess(`No documents found matching "${searchQuery}"`);
        } else {
          showSuccess(`Found ${filtered.length} document(s)`);
        }
      } catch {
        showError('Search failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (document: Document) => {
    if (!document.currentVersionId) {
      showError('This document does not have an uploaded file version');
      return;
    }

    try {
      await apiClient.downloadDocument(document.documentId, document.currentVersionId);
      showSuccess('Download started');
    } catch {
      showError('Failed to download document');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white mb-2">
          Advanced Search
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Search and filter documents across your entire vault
        </p>
      </div>

      {/* Search Bar */}
      <Card className="bg-white dark:bg-navy-950">
        <CardBody className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">
              Search Documents
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="e.g., Quality Management Policy, ISO 9001..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <Button variant="primary" onClick={handleSearch} disabled={isLoading}>
                {isLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </div>

          {/* Advanced Filters */}
          <details className="border-t border-gray-200 dark:border-navy-700 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-navy-900 dark:text-white hover:text-blue-600">
              Advanced Filters
            </summary>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded text-sm bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Any Status</option>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending Approval</option>
                  <option value="released">Released</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Owner
                </label>
                <input
                  type="text"
                  placeholder="e.g., John Doe"
                  value={filters.owner}
                  onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded text-sm bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  File Type
                </label>
                <select
                  value={filters.fileType}
                  onChange={(e) => setFilters({ ...filters, fileType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded text-sm bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  <option value="">Any Type</option>
                  <option value="pdf">PDF</option>
                  <option value="docx">Word</option>
                  <option value="xlsx">Excel</option>
                  <option value="pptx">PowerPoint</option>
                  <option value="image">Image</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded text-sm bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  To Date
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded text-sm bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Clear Filters
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setFilters({
                      status: '',
                      owner: '',
                      dateFrom: '',
                      dateTo: '',
                      fileType: '',
                      minSize: '',
                      maxSize: '',
                    })
                  }
                  className="w-full"
                >
                  Reset
                </Button>
              </div>
            </div>
          </details>
        </CardBody>
      </Card>

      {/* Results */}
      {!hasSearched ? (
        <Card className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900">
          <CardBody>
            <div className="text-center">
              <SearchIcon className="w-12 h-12 text-blue-400 mx-auto mb-4" />
              <p className="text-blue-700 dark:text-blue-300">
                Enter a search term and filters to find documents
              </p>
            </div>
          </CardBody>
        </Card>
      ) : isLoading ? (
        <SkeletonTable />
      ) : results.length === 0 ? (
        <Card className="bg-gray-50 dark:bg-navy-950">
          <CardBody className="text-center py-12">
            <SearchIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              No documents found matching your search
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 dark:bg-navy-900 border-b border-gray-200 dark:border-navy-700">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">
                    Document
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">
                    Owner
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">
                    Date
                  </th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((doc, idx) => (
                  <tr
                    key={doc.documentId}
                    className={`border-b border-gray-200 dark:border-navy-700 ${
                      idx % 2 === 1 ? 'bg-gray-50 dark:bg-navy-850' : 'bg-white dark:bg-navy-950'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium text-navy-900 dark:text-white truncate">
                        {doc.title ?? doc.name}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <Badge status={doc.status === 'released' ? 'success' : doc.status === 'pending_approval' ? 'warning' : 'info'} variant="outline">
                        {doc.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {doc.uploadedByUser?.fullName || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(doc.createdAt ?? doc.uploadedAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => navigate(`/documents/${doc.documentId}`)}
                          className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4 text-blue-600" />
                        </button>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors"
                          title="Download"
                        >
                          <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Results Summary */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-navy-700 bg-gray-50 dark:bg-navy-900">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Showing {results.length} result{results.length !== 1 ? 's' : ''} for "{searchQuery}"
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
