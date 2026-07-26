import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Eye, FileSearch, Search as SearchIcon } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doclingApi, type ParsedDocument } from '../../services/doclingApi';
import type { Document } from '../../types';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { Badge, Button, Card, CardBody } from '../ui';
import { MarkdownViewer } from '../custom/MarkdownViewer';
import { SkeletonTable } from '../ui/Skeleton';

export function Search() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [results, setResults] = useState<ParsedDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<ParsedDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [libraryResults, setLibraryResults] = useState<Document[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [hasLibrarySearched, setHasLibrarySearched] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    owner: '',
    dateFrom: '',
    dateTo: '',
    fileType: '',
    minSize: '',
    maxSize: '',
  });

  const runSearch = useCallback(async (query: string, signal?: AbortSignal) => {
    setIsLoading(true);
    setHasSearched(true);
    setSelectedDocument(null);
    try {
      const matches = await doclingApi.searchDocuments(query, signal);
      setResults(matches);
      if (matches.length === 0) {
        showSuccess(`No parsed documents found matching "${query}"`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setResults([]);
      showError(error instanceof Error ? error.message : 'Local document search failed');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [showError, showSuccess]);

  useEffect(() => {
    const query = (searchParams.get('q') ?? '').trim();
    setSearchQuery(query);
    if (!query) return;

    const controller = new AbortController();
    void runSearch(query, controller.signal);
    return () => controller.abort();
  }, [runSearch, searchParams]);

  const handleSearch = () => {
    const query = searchQuery.trim();
    if (!query) {
      showError('Please enter a search query');
      return;
    }
    setSearchParams({ q: query });
  };

  const handleLibrarySearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      showError('Please enter a search query');
      return;
    }

    setIsLibraryLoading(true);
    setHasLibrarySearched(true);
    try {
      const response = await apiClient.searchDocuments(query, filters);
      setLibraryResults(response.data || []);
    } catch {
      try {
        const response = await apiClient.getDocuments();
        setLibraryResults(
          (response.data || []).filter((document: Document) =>
            (document.title ?? document.name ?? '')
              .toLowerCase()
              .includes(query.toLowerCase()),
          ),
        );
      } catch {
        setLibraryResults([]);
        showError('DMS metadata search failed');
      }
    } finally {
      setIsLibraryLoading(false);
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

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading">OCR Document Search</h1>
        <p className="page-subtitle">Search Markdown content extracted locally by Docling</p>
      </div>

      <Card className="dark:bg-navy-950">
        <CardBody>
          <label className="mb-2 block text-sm font-medium text-[#26334d] dark:text-white" htmlFor="parsed-document-search">
            Search parsed document contents
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0ba]" />
              <input
                id="parsed-document-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearch();
                }}
                placeholder="Search extracted text, tables, and headings..."
                className="field-control h-10 w-full pl-11 pr-4"
              />
            </div>
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? 'Searching...' : 'Search'}
            </Button>
          </div>

          <details className="mt-4 border-t border-[#dbe2ec] pt-4 dark:border-white/10">
            <summary className="cursor-pointer text-sm font-medium text-[#26334d] hover:text-[#2f78b7] dark:text-white">
              Advanced DMS metadata filters
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-[#52627a] dark:text-slate-300">
                Status
                <select
                  value={filters.status}
                  onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                  className="field-control mt-1 w-full"
                >
                  <option value="">Any Status</option>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending Approval</option>
                  <option value="released">Released</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[#52627a] dark:text-slate-300">
                Owner
                <input
                  value={filters.owner}
                  onChange={(event) => setFilters({ ...filters, owner: event.target.value })}
                  placeholder="e.g., John Doe"
                  className="field-control mt-1 w-full"
                />
              </label>
              <label className="text-xs font-medium text-[#52627a] dark:text-slate-300">
                File Type
                <select
                  value={filters.fileType}
                  onChange={(event) => setFilters({ ...filters, fileType: event.target.value })}
                  className="field-control mt-1 w-full"
                >
                  <option value="">Any Type</option>
                  <option value="pdf">PDF</option>
                  <option value="docx">Word</option>
                  <option value="xlsx">Excel</option>
                  <option value="pptx">PowerPoint</option>
                  <option value="image">Image</option>
                </select>
              </label>
              <label className="text-xs font-medium text-[#52627a] dark:text-slate-300">
                From Date
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
                  className="field-control mt-1 w-full"
                />
              </label>
              <label className="text-xs font-medium text-[#52627a] dark:text-slate-300">
                To Date
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
                  className="field-control mt-1 w-full"
                />
              </label>
              <div className="flex items-end gap-2">
                <Button
                  variant="secondary"
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
                >
                  Reset
                </Button>
                <Button onClick={handleLibrarySearch} disabled={isLibraryLoading}>
                  {isLibraryLoading ? 'Searching DMS...' : 'Search DMS metadata'}
                </Button>
              </div>
            </div>
          </details>
        </CardBody>
      </Card>

      {!hasSearched ? (
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/20">
          <CardBody className="py-12 text-center">
            <FileSearch className="mx-auto mb-4 h-12 w-12 text-blue-400" />
            <p className="text-blue-700 dark:text-blue-300">
              Enter a phrase to search documents already parsed by Docling.
            </p>
          </CardBody>
        </Card>
      ) : isLoading ? (
        <SkeletonTable />
      ) : results.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <SearchIcon className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="text-[#718198]">No parsed documents found matching your search.</p>
          </CardBody>
        </Card>
      ) : (
        <div className={`grid min-w-0 gap-5 ${selectedDocument ? 'xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]' : ''}`}>
          <Card className="min-w-0 overflow-hidden dark:bg-navy-950">
            <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10">
              <h2 className="section-heading">{results.length} matching {results.length === 1 ? 'file' : 'files'}</h2>
            </div>
            <ul className="divide-y divide-[#e2e8f0] dark:divide-white/10">
              {results.map((document) => (
                <li key={document.id} className="flex min-w-0 items-center gap-3 px-5 py-4">
                  <FileSearch className="h-5 w-5 flex-shrink-0 text-[#3f8bca]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#26334d] dark:text-white">{document.filename}</p>
                    {document.created_at && <p className="mt-1 text-xs text-[#718198]">Parsed {document.created_at}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label={`View parsed ${document.filename}`}
                    onClick={() => setSelectedDocument(document)}
                    className="rounded p-2 text-[#3f8bca] hover:bg-blue-50 dark:hover:bg-slate-800"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selectedDocument && (
            <section className="min-w-0" aria-label={`Parsed content for ${selectedDocument.filename}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-[#26334d] dark:text-white">{selectedDocument.filename}</h2>
                  <p className="text-xs text-[#718198]">Read-only Markdown generated locally by Docling</p>
                </div>
              </div>
              <MarkdownViewer content={selectedDocument.content} />
            </section>
          )}
        </div>
      )}

      {hasLibrarySearched && (
        <section aria-labelledby="dms-metadata-results">
          <h2 id="dms-metadata-results" className="section-heading mb-3">
            DMS metadata results
          </h2>
          {isLibraryLoading ? (
            <SkeletonTable />
          ) : libraryResults.length === 0 ? (
            <Card>
              <CardBody className="py-8 text-center text-[#718198]">
                No DMS documents found matching your metadata search.
              </CardBody>
            </Card>
          ) : (
            <Card className="overflow-hidden dark:bg-navy-950">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-[#dbe2ec] bg-slate-100 dark:border-white/10 dark:bg-slate-900">
                    <tr>
                      {['Document', 'Status', 'Owner', 'Date', 'Actions'].map((heading) => (
                        <th key={heading} className="px-6 py-3 text-left text-sm font-semibold text-[#26334d] dark:text-white">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {libraryResults.map((document, index) => (
                      <tr
                        key={document.documentId}
                        className={`border-b border-[#dbe2ec] dark:border-white/10 ${
                          index % 2 === 0 ? 'bg-white dark:bg-navy-950' : 'bg-slate-50 dark:bg-slate-900'
                        }`}
                      >
                        <td className="px-6 py-4">
                          <p className="font-medium text-[#26334d] dark:text-white">
                            {document.title ?? document.name}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            status={
                              document.status === 'released'
                                ? 'success'
                                : document.status === 'pending_approval'
                                  ? 'warning'
                                  : 'info'
                            }
                            variant="outline"
                          >
                            {document.status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                          {document.uploadedByUser?.fullName || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                          {formatDate(document.createdAt ?? document.uploadedAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              aria-label={`Open ${document.title ?? document.name}`}
                              onClick={() => navigate(`/documents?preview=${encodeURIComponent(document.documentId)}`)}
                              className="rounded p-2 text-[#3f8bca] hover:bg-blue-50 dark:hover:bg-slate-800"
                            >
                              <Eye className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Download ${document.title ?? document.name}`}
                              onClick={() => void handleDownload(document)}
                              className="rounded p-2 text-[#52627a] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <ChevronRight className="h-5 w-5" />
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
        </section>
      )}
    </div>
  );
}
