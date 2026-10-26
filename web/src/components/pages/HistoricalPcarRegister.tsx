import { Fragment, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ChevronLeft, ChevronRight, FileSpreadsheet, History, Search, Upload } from 'lucide-react';
import { Button, Card } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { formatDateTime } from '../../utils/formatters';

interface HistoricalPcar {
  historicalPcarId: string;
  legacyRequestId: string;
  groupName?: string;
  requesterName?: string;
  department?: string;
  category?: string;
  subject?: string;
  historicalOwnerName?: string;
  linkedUserName?: string;
  priority?: string;
  severity?: string;
  sourceStatus?: string;
  description?: string;
  resolution?: string;
  closureCode?: string;
  closureComments?: string;
  sourceCreatedAt?: string;
  sourceDueAt?: string;
  sourceCompletedAt?: string;
  sourceUpdatedAt?: string;
}

type ImportRecord = Record<string, string>;
const headerAliases: Record<string, string> = {
  'Request ID': 'requestId', Group: 'group', Requester: 'requester', Department: 'department', Category: 'category',
  Subject: 'subject', Technician: 'technician', Description: 'description', Priority: 'priority', Severity: 'severity',
  'Request Status': 'requestStatus', 'Created Time': 'createdTime', 'DueBy Time': 'dueByTime', 'Completed Time': 'completedTime',
  Resolution: 'resolution', 'Request Closure Code': 'closureCode', 'Request Closure Comments': 'closureComments', 'Last Update Time': 'lastUpdateTime',
};

function parseLegacyWorkbook(file: File): Promise<ImportRecord[]> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim() === 'Request ID'));
    if (headerIndex < 0) throw new Error('This file does not contain the required Request ID column.');
    const headers = rows[headerIndex].map((cell) => String(cell).trim());
    if (!headers.includes('Subject') || !headers.includes('Technician'))
      throw new Error('This file is missing required PCAR columns (Subject or Technician).');
    return rows.slice(headerIndex + 1)
      .filter((row) => String(row[headers.indexOf('Request ID')] ?? '').trim())
      .map((row) => Object.fromEntries(headers.map((header, index) => [headerAliases[header], String(row[index] ?? '').trim()])))
      .filter((row) => row.requestId);
  });
}

function HistoricalPcarDetails({ record, onClose }: { record: HistoricalPcar; onClose: () => void }) {
  const facts = [
    ['Historical owner', record.historicalOwnerName || 'Unassigned'], ['Requester', record.requesterName || '—'],
    ['Department / group', [record.department, record.groupName].filter(Boolean).join(' / ') || '—'], ['Category / severity', [record.category, record.severity].filter(Boolean).join(' / ') || '—'],
    ['Created', record.sourceCreatedAt ? formatDateTime(record.sourceCreatedAt) : '—'], ['Due', record.sourceDueAt ? formatDateTime(record.sourceDueAt) : '—'],
    ['Completed', record.sourceCompletedAt ? formatDateTime(record.sourceCompletedAt) : '—'], ['Last updated', record.sourceUpdatedAt ? formatDateTime(record.sourceUpdatedAt) : '—'],
  ];
  const notes = [['Description', record.description], ['Resolution', record.resolution], ['Closure', [record.closureCode, record.closureComments].filter(Boolean).join(': ') || undefined]];
  return <div><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#174f91] dark:text-blue-200">Legacy PCAR #{record.legacyRequestId}</p><h3 className="mt-1 text-lg font-semibold text-[#26334d] dark:text-white">{record.subject || 'Untitled record'}</h3></div><Button size="sm" variant="secondary" onClick={onClose}>Close details</Button></div><div className="mt-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{facts.map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">{label}</p><p className="mt-1 text-[#26334d] dark:text-white">{value}</p></div>)}</div>{notes.map(([label, value]) => value && <div key={label} className="mt-5 border-t border-[#e2e8f0] pt-4 dark:border-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">{label}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-[#44546b] dark:text-slate-200">{value}</p></div>)}</div>;
}

export function HistoricalPcarRegister({ canImport }: { canImport: boolean }) {
  const { showError, showSuccess } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<HistoricalPcar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [sortBy, setSortBy] = useState('created');
  const [sortDirection, setSortDirection] = useState('desc');
  const [ownerOptions, setOwnerOptions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingImport, setPendingImport] = useState<ImportRecord[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoricalPcar | null>(null);

  const load = async (targetPage = page) => {
    setIsLoading(true);
    try {
      const response = await apiClient.getHistoricalPcars({ search, owner, sortBy, sortDirection, page: targetPage, pageSize: 50 });
      setRecords(response.data ?? []);
      setOwnerOptions(response.ownerOptions ?? []);
      const count = response.totalCount ?? 0;
      setTotalCount(count);
      setTotalPages(response.totalPages ?? Math.max(1, Math.ceil(count / 50)));
    } catch (error: any) {
      showError(error.response?.data?.error ?? 'Could not load historical PCAR records.');
    } finally { setIsLoading(false); }
  };
  useEffect(() => { setPage(1); }, [search, owner, sortBy, sortDirection]);
  useEffect(() => { void load(page); }, [page, search, owner, sortBy, sortDirection]);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseLegacyWorkbook(file);
      if (!parsed.length) throw new Error('No PCAR rows were found in this file.');
      setPendingImport(parsed);
    } catch (error: any) { showError(error.message ?? 'Could not read the selected workbook.'); }
  };

  const importRecords = async () => {
    if (!pendingImport) return;
    setIsImporting(true);
    try {
      const response = await apiClient.importHistoricalPcars(pendingImport);
      const result = response.data;
      showSuccess(`${result.imported} historical PCAR records imported; ${result.skipped.length} duplicates skipped.`);
      setPendingImport(null);
      await load(1);
      setPage(1);
    } catch (error: any) { showError(error.response?.data?.error ?? 'The PCAR import failed.'); }
    finally { setIsImporting(false); }
  };

  return (
    <section className="mt-10" aria-labelledby="historical-pcar-heading">
      <div className="flex flex-col gap-3 border-b border-[#e2e8f0] pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-[#3f8bca]" /><h2 id="historical-pcar-heading" className="section-heading">Historical PCAR Register</h2></div>
          <p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Read-only records from the previous system. Original owners are preserved even when they no longer have a DMS account.</p>
        </div>
        {canImport && <><input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} /><Button variant="secondary" onClick={() => inputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>Import history</Button></>}
      </div>

      {pendingImport && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-[#b8d4f5] bg-[#f4f8fd] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950/30">
          <div><p className="font-semibold text-[#174f91] dark:text-blue-200">Ready to import {pendingImport.length} historical PCAR records</p><p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Existing Request IDs will be skipped. Original owners stay unchanged; only exact active-user matches are linked.</p></div>
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setPendingImport(null)}>Cancel</Button><Button onClick={() => void importRecords()} disabled={isImporting}>{isImporting ? 'Importing…' : 'Confirm import'}</Button></div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-[#718198]" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="field-control h-10 w-full pl-9" placeholder="Search ID, subject, owner, requester, or category" aria-label="Search historical PCAR records" /></div>
        <div className="flex flex-wrap items-center gap-2"><select value={owner} onChange={(event) => setOwner(event.target.value)} className="field-control h-10 min-w-[11rem] px-3" aria-label="Filter historical PCAR records by owner"><option value="">All visible owners</option>{ownerOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="field-control h-10 min-w-[9rem] px-3" aria-label="Sort historical PCAR records"><option value="created">Created date</option><option value="completed">Completed date</option><option value="status">Status</option><option value="priority">Priority</option></select><select value={sortDirection} onChange={(event) => setSortDirection(event.target.value)} className="field-control h-10 min-w-[7rem] px-3" aria-label="Sort direction"><option value="desc">Newest / Z–A</option><option value="asc">Oldest / A–Z</option></select></div>
        <p className="text-sm text-[#52627a] dark:text-slate-300">{totalCount} matching records · page {page} of {totalPages}</p>
      </div>

      <Card className="mt-4 overflow-hidden">
        {isLoading ? <SkeletonTable /> : <div className="overflow-x-auto"><table className="w-full min-w-[940px]"><thead className="border-b border-[#e2e8f0] bg-slate-50 dark:border-slate-800 dark:bg-slate-900"><tr>{['Legacy ID', 'Subject', 'Category', 'Historical owner', 'Status', 'Priority', 'Created', 'Completed'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#52627a] dark:text-slate-300">{heading}</th>)}</tr></thead><tbody>{records.length ? records.map((record) => <Fragment key={record.historicalPcarId}><tr onClick={() => setSelectedRecord(selectedRecord?.historicalPcarId === record.historicalPcarId ? null : record)} className={`cursor-pointer border-b border-[#eef2f7] hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60 ${selectedRecord?.historicalPcarId === record.historicalPcarId ? 'bg-[#f4f8fd] dark:bg-blue-950/25' : ''}`}><td className="px-4 py-3 text-sm font-semibold text-[#174f91] dark:text-blue-200">#{record.legacyRequestId}</td><td className="max-w-[24rem] px-4 py-3 text-sm text-[#26334d] dark:text-white">{record.subject || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.category || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.historicalOwnerName || 'Unassigned'}{record.linkedUserName && <span className="block text-xs text-[#3f8bca]">Linked: {record.linkedUserName}</span>}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceStatus || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.priority || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceCreatedAt ? formatDateTime(record.sourceCreatedAt) : '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceCompletedAt ? formatDateTime(record.sourceCompletedAt) : '—'}</td></tr>{selectedRecord?.historicalPcarId === record.historicalPcarId && <tr className="border-b border-[#dbe8f6] bg-[#f8fbff] dark:border-blue-950 dark:bg-slate-950"><td colSpan={8} className="p-5"><HistoricalPcarDetails record={record} onClose={() => setSelectedRecord(null)} /></td></tr>}</Fragment>) : <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[#52627a] dark:text-slate-300"><FileSpreadsheet className="mx-auto mb-2 h-6 w-6 text-[#94a3b8]" />No historical PCAR records match this view.</td></tr>}</tbody></table></div>}
      </Card>
      {totalPages > 1 && <div className="mt-4 flex justify-center"><div className="flex items-center gap-3 rounded-lg border border-[#dbe2ec] bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900"><Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)} leftIcon={<ChevronLeft className="h-4 w-4" />}>Previous page</Button><span className="min-w-[7rem] text-center text-sm font-semibold text-[#26334d] dark:text-white">Page {page} of {totalPages}</span><Button size="sm" variant="primary" disabled={page === totalPages} onClick={() => setPage(page + 1)} rightIcon={<ChevronRight className="h-4 w-4" />}>Next page</Button></div></div>}
    </section>
  );
}
