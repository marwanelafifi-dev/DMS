import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eye, FileSearch, Search as SearchIcon, Download, FileText, FileCode, Image, Film } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doclingApi, type ParsedDocument } from '../../services/doclingApi';
import type { Document } from '../../types';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { useSearchSuggestions } from '../../hooks/useSearchSuggestions';
import { useAllDmsDocuments } from '../../hooks/useAllDmsDocuments';
import { Badge, Button, Card, CardBody } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { SearchSuggestionsDropdown } from '../custom/SearchSuggestionsDropdown';
import { matchesDmsMetadata } from '../../utils/dmsMetadataSearch';
import { statusLabels } from '../../utils/documentStatus';
import { resolveLibraryStatus } from '../../fixtures/documentLibrary';
import { folderPathLabel } from '../../utils/folderPath';
import { filterActiveOcrDocuments, findActiveDmsDocument } from '../../utils/activeOcrDocuments';

export function Search() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
  const [results, setResults] = useState<ParsedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [libraryResults, setLibraryResults] = useState<Document[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [hasLibrarySearched, setHasLibrarySearched] = useState(false);
  const { documents: allDmsDocuments, folders: allDmsFolders } = useAllDmsDocuments();
  // Read via a ref inside runSearch instead of depending on allDmsDocuments
  // directly — otherwise the background DMS-documents load finishing would
  // change runSearch's identity mid-flight, which re-triggers the "run search
  // on URL change" effect and aborts/restarts the in-flight search.
  const allDmsDocumentsRef = useRef<Document[]>([]);
  useEffect(() => {
    allDmsDocumentsRef.current = allDmsDocuments;
  }, [allDmsDocuments]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const { suggestions, isLoading: isSuggestLoading } = useSearchSuggestions(isSuggestionsOpen ? searchQuery : '', allDmsDocuments);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState({
    status: '',
    owner: '',
    dateFrom: '',
    dateTo: '',
    fileType: '',
    minSize: '',
    maxSize: '',
  });

  const findDmsDocument = useCallback(
    (document: ParsedDocument) => findActiveDmsDocument(document, allDmsDocuments),
    [allDmsDocuments],
  );

  const openInLibrary = useCallback((document: ParsedDocument) => {
    const dmsDoc = findDmsDocument(document);
    if (dmsDoc) {
      navigate(`/documents?preview=${encodeURIComponent(dmsDoc.documentId)}`);
    } else {
      showError('This file is not linked to a Document Library entry yet');
    }
  }, [findDmsDocument, navigate, showError]);

  // Content search alone misses anything findable only by metadata (owner
  // name, extension, department, tags, description, status...). This finds
  // DMS documents that match on metadata but weren't already found by OCR
  // content. Some DMS records (e.g. metadata-only entries with no uploaded
  // file version yet) have an empty fileName — fall back to their
  // title/name instead of excluding them entirely.
  const findMetadataMatches = useCallback((dmsDocuments: Document[], contentMatches: ParsedDocument[], query: string): ParsedDocument[] => {
    const matchedFileNames = new Set(contentMatches.map((doc) => doc.filename.toLowerCase()));
    return dmsDocuments
      .map((doc: any) => ({ doc, displayName: doc.fileName || doc.name || doc.title }))
      .filter(({ doc, displayName }) => displayName && !matchedFileNames.has(displayName.toLowerCase()) && matchesDmsMetadata(doc, query))
      .map(({ doc, displayName }, index): ParsedDocument => ({
        id: -(index + 1),
        filename: displayName,
        content: doc.description || '',
        created_at: (doc as any).createdAt,
      }));
  }, []);

  // The last OCR content-only matches, kept separately from `results` so the
  // DMS-metadata re-merge effect below can recombine them without needing to
  // re-run the OCR search itself.
  const contentMatchesRef = useRef<ParsedDocument[]>([]);

  const runSearch = useCallback(async (query: string, signal?: AbortSignal) => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const indexedMatches = await doclingApi.searchDocuments(query, signal);
      if (signal?.aborted) return;
      contentMatchesRef.current = indexedMatches;

      const contentMatches = filterActiveOcrDocuments(indexedMatches, allDmsDocumentsRef.current);

      const metadataMatches = findMetadataMatches(allDmsDocumentsRef.current, contentMatches, query);
      // No "no results" toast here — the DMS documents list (used for the
      // metadata half of this search) may still be loading at this point, so
      // whether there are truly zero results isn't known yet. The empty-state
      // card below the search box already reacts to `results` once the
      // metadata re-merge effect settles, without a toast that could go stale.
      setResults([...contentMatches, ...metadataMatches]);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setResults([]);
      showError(error instanceof Error ? error.message : 'Local document search failed');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [showError, showSuccess, findMetadataMatches]);

  // Fresh navigation straight to /search?q=... starts the OCR content search
  // and the DMS-documents load at the same time — the content search usually
  // wins the race, so the very first render's metadata merge sees an empty
  // document list. Once the DMS documents actually finish loading, re-merge
  // against the content matches we already have (no new network calls, no
  // re-running/aborting the OCR search).
  useEffect(() => {
    if (!hasSearched || !searchQuery) return;
    const contentMatches = filterActiveOcrDocuments(contentMatchesRef.current, allDmsDocuments);
    const metadataMatches = findMetadataMatches(allDmsDocuments, contentMatches, searchQuery);
    setResults([...contentMatches, ...metadataMatches]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDmsDocuments]);

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
    setIsSuggestionsOpen(false);
  };

  const selectSuggestion = (doc: ParsedDocument) => {
    setSearchQuery(doc.filename);
    setSearchParams({ q: doc.filename });
    setIsSuggestionsOpen(false);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isSuggestionsOpen && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[activeSuggestionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        setIsSuggestionsOpen(false);
        return;
      }
    }
    if (event.key === 'Enter') handleSearch();
  };

  useEffect(() => {
    setActiveSuggestionIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setIsSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      setLibraryResults((response.data || []).map((document: Document) => ({ ...document, status: resolveLibraryStatus(document) })));
    } catch {
      try {
        const response = await apiClient.getDocuments();
        setLibraryResults(
          (response.data || [])
            .filter((document: Document) =>
              (document.title ?? document.name ?? '')
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((document: Document) => ({ ...document, status: resolveLibraryStatus(document) })),
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

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['pdf'].includes(ext)) return <FileText className="h-5 w-5 text-red-600" />;
    if (['doc', 'docx'].includes(ext)) return <FileText className="h-5 w-5 text-blue-600" />;
    if (['xls', 'xlsx'].includes(ext)) return <FileCode className="h-5 w-5 text-green-600" />;
    if (['ppt', 'pptx'].includes(ext)) return <Film className="h-5 w-5 text-orange-600" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return <Image className="h-5 w-5 text-purple-600" />;
    return <FileText className="h-5 w-5 text-gray-400" />;
  };

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
            <div ref={searchBoxRef} className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0ba]" />
              <input
                id="parsed-document-search"
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setIsSuggestionsOpen(true);
                }}
                onFocus={() => setIsSuggestionsOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search extracted text, tables, and headings..."
                role="combobox"
                aria-expanded={isSuggestionsOpen && searchQuery.trim().length >= 2}
                aria-controls="ocr-search-suggestions"
                aria-autocomplete="list"
                autoComplete="off"
                className="field-control h-10 w-full pl-11 pr-4"
              />
              {isSuggestionsOpen && searchQuery.trim().length >= 2 && (
                <SearchSuggestionsDropdown
                  id="ocr-search-suggestions"
                  query={searchQuery}
                  suggestions={suggestions}
                  activeIndex={activeSuggestionIndex}
                  isLoading={isSuggestLoading}
                  onSelect={selectSuggestion}
                  onHoverIndex={setActiveSuggestionIndex}
                />
              )}
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
                  <option value="qa_review">QA Review</option>
                  <option value="manager_review">Manager Review</option>
                  <option value="correction_in_progress">Correction Needed</option>
                  <option value="qa_final_review">Final Review</option>
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
        <Card className="overflow-hidden dark:bg-navy-950">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#dbe2ec] bg-slate-50 dark:border-white/10 dark:bg-slate-900">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input type="checkbox" className="rounded" />
                  </th>
                  {['File name', 'Type', 'Folder', 'Department', 'Owner', 'Creation date', 'Modified date', 'Tags', 'Status'].map((heading) => (
                    <th key={heading} className="px-6 py-3 text-left text-sm font-semibold text-[#26334d] dark:text-white">
                      {heading}
                    </th>
                  ))}
                  <th className="sticky right-0 z-10 border-l border-[#dbe2ec] bg-slate-50 px-6 py-3 text-left text-sm font-semibold text-[#26334d] dark:border-white/10 dark:bg-slate-900 dark:text-white">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((ocrDoc, index) => {
                  const dmsDoc = findDmsDocument(ocrDoc);
                  const rowBg = index % 2 === 0 ? 'bg-white dark:bg-navy-950' : 'bg-slate-50 dark:bg-slate-900';
                return (
                    <tr
                      key={ocrDoc.id}
                      className={`border-b border-[#dbe2ec] dark:border-white/10 ${rowBg}`}
                    >
                      <td className="w-12 px-4 py-4">
                        <input type="checkbox" className="rounded" />
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => openInLibrary(ocrDoc)}
                          className="flex items-center gap-3 text-left hover:underline"
                        >
                          {getFileIcon(ocrDoc.filename)}
                          <p className="font-medium text-[#26334d] dark:text-white">{ocrDoc.filename}</p>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {(dmsDoc as any)?.extension?.toUpperCase() || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {(dmsDoc ? folderPathLabel(dmsDoc.folderId, allDmsFolders) : undefined) || (dmsDoc as any)?.folderName || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {dmsDoc?.department || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {dmsDoc?.owner?.fullName || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {dmsDoc && dmsDoc.createdAt
                          ? new Date(dmsDoc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                            ', ' +
                            new Date(dmsDoc.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                          : ocrDoc.created_at
                            ? formatDate(ocrDoc.created_at)
                            : '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {dmsDoc && dmsDoc.modifiedAt
                          ? new Date(dmsDoc.modifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                            ', ' +
                            new Date(dmsDoc.modifiedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                        {(dmsDoc as any)?.tags?.length ? (dmsDoc as any).tags.slice(0, 2).join(', ') + ((dmsDoc as any).tags.length > 2 ? `+${(dmsDoc as any).tags.length - 2}` : '') : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          status={
                            dmsDoc?.status === 'released'
                              ? 'success'
                              : dmsDoc?.status === 'correction_in_progress'
                                ? 'error'
                                : dmsDoc?.status === 'draft'
                                  ? 'default'
                                  : 'warning'
                          }
                          variant="outline"
                        >
                          {dmsDoc?.status ? statusLabels[dmsDoc.status] : 'Unknown'}
                        </Badge>
                      </td>
                      <td className={`sticky right-0 z-10 border-l border-[#dbe2ec] px-6 py-4 dark:border-white/10 ${rowBg}`}>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            title="Open in Document Library"
                            aria-label={`Open ${ocrDoc.filename} in Document Library`}
                            onClick={() => openInLibrary(ocrDoc)}
                            className="rounded p-2 text-[#3f8bca] hover:bg-blue-50 dark:hover:bg-slate-800"
                          >
                            <Eye className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            title="Download"
                            aria-label={`Download ${ocrDoc.filename}`}
                            onClick={() => {
                              if (dmsDoc) {
                                void handleDownload(dmsDoc);
                              } else {
                                showError('This file is not linked to a Document Library entry yet');
                              }
                            }}
                            className="rounded p-2 text-[#52627a] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Download className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
                      {['Document', 'Folder', 'Status', 'Owner', 'Date'].map((heading) => (
                        <th key={heading} className="px-6 py-3 text-left text-sm font-semibold text-[#26334d] dark:text-white">
                          {heading}
                        </th>
                      ))}
                      <th className="sticky right-0 z-10 border-l border-[#dbe2ec] bg-slate-100 px-6 py-3 text-left text-sm font-semibold text-[#26334d] dark:border-white/10 dark:bg-slate-900 dark:text-white">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryResults.map((document, index) => {
                      const rowBg = index % 2 === 0 ? 'bg-white dark:bg-navy-950' : 'bg-slate-50 dark:bg-slate-900';
                      return (
                      <tr
                        key={document.documentId}
                        className={`border-b border-[#dbe2ec] dark:border-white/10 ${rowBg}`}
                      >
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => navigate(`/documents?preview=${encodeURIComponent(document.documentId)}`)}
                            className="font-medium text-[#26334d] hover:underline dark:text-white"
                          >
                            {document.title ?? document.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                          {folderPathLabel(document.folderId, allDmsFolders) || '—'}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            status={
                              document.status === 'released'
                                ? 'success'
                                : document.status === 'correction_in_progress'
                                  ? 'error'
                                  : document.status === 'draft'
                                    ? 'default'
                                    : 'warning'
                            }
                            variant="outline"
                          >
                            {statusLabels[document.status]}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                          {document.uploadedByUser?.fullName || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-[#52627a] dark:text-slate-300">
                          {formatDate(document.createdAt ?? document.uploadedAt)}
                        </td>
                        <td className={`sticky right-0 z-10 border-l border-[#dbe2ec] px-6 py-4 dark:border-white/10 ${rowBg}`}>
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
                              <Download className="h-5 w-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
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
