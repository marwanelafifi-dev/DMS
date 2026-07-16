import { useState } from 'react';
import { Card, CardBody } from '../ui';

interface SearchFilterProps {
  onSearch: (query: string) => void;
  onAdvancedFilter: (filters: {
    status?: string;
    owner?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => void;
  showAdvanced?: boolean;
}

export function SearchFilter({
  onSearch,
  onAdvancedFilter,
  showAdvanced = true,
}: SearchFilterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    owner: '',
    dateFrom: '',
    dateTo: '',
  });

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    onSearch(query);
  };

  const handleFilterChange = (key: string, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onAdvancedFilter(newFilters);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilters({ status: '', owner: '', dateFrom: '', dateTo: '' });
    onSearch('');
    onAdvancedFilter({ status: '', owner: '', dateFrom: '', dateTo: '' });
  };

  return (
    <div className="space-y-4">
      {/* Simple Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search documents by name..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full px-4 py-2 pl-10 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-navy-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-600 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>

      {/* Advanced Filters Toggle */}
      {showAdvanced && (
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          {showAdvancedFilters ? '▼ Hide advanced filters' : '▶ Show advanced filters'}
        </button>
      )}

      {/* Advanced Filters */}
      {showAdvanced && showAdvancedFilters && (
        <Card>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-blue-300 mb-2">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-navy-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending Approval</option>
                  <option value="released">Released</option>
                  <option value="rejected">Rejected</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              {/* Owner Filter */}
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-blue-300 mb-2">
                  Owner
                </label>
                <input
                  type="text"
                  placeholder="Filter by owner name..."
                  value={filters.owner}
                  onChange={(e) => handleFilterChange('owner', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-navy-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Date From */}
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-blue-300 mb-2">
                  From Date
                </label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-navy-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Date To */}
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-blue-300 mb-2">
                  To Date
                </label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-navy-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Clear Filters Button */}
            <button
              onClick={clearFilters}
              className="w-full px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 rounded-lg hover:bg-blue-50 dark:hover:bg-navy-700 transition-colors"
            >
              Clear All Filters
            </button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
