import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, History, Search, Upload } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
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

export function HistoricalPcarRegister({ canManage }: { canManage: boolean }) {
  const { showError, showSuccess } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<HistoricalPcar[]>([]);
  const [isLoading, setIsLoading] = useState(canManage);
  const [search, setSearch] = useState('');
  const [pendingImport, setPendingImport] = useState<ImportRecord[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<HistoricalPcar | null>(null);

  const load = async () => {
    if (!canManage) return;
    setIsLoading(true);
    try {
      const response = await apiClient.getHistoricalPcars();
      setRecords(response.data ?? []);
    } catch (error: any) {
      showError(error.response?.data?.error ?? 'Could not load historical PCAR records.');
    } finally { setIsLoading(false); }
  };
  useEffect(() => { void load(); }, [canManage]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return records;
    return records.filter((record) => [record.legacyRequestId, record.subject, record.historicalOwnerName, record.requesterName, record.category]
      .some((value) => value?.toLowerCase().includes(term)));
  }, [records, search]);

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
      await load();
    } catch (error: any) { showError(error.response?.data?.error ?? 'The PCAR import failed.'); }
    finally { setIsImporting(false); }
  };

  if (!canManage) return null;
  return (
    <section className="mt-10" aria-labelledby="historical-pcar-heading">
      <div className="flex flex-col gap-3 border-b border-[#e2e8f0] pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-[#3f8bca]" /><h2 id="historical-pcar-heading" className="section-heading">Historical PCAR Register</h2></div>
          <p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Read-only records from the previous system. Original owners are preserved even when they no longer have a DMS account.</p>
        </div>
        <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>Import history</Button>
      </div>

      {pendingImport && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-[#b8d4f5] bg-[#f4f8fd] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-blue-900 dark:bg-blue-950/30">
          <div><p className="font-semibold text-[#174f91] dark:text-blue-200">Ready to import {pendingImport.length} historical PCAR records</p><p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Existing Request IDs will be skipped. Original owners stay unchanged; only exact active-user matches are linked.</p></div>
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setPendingImport(null)}>Cancel</Button><Button onClick={() => void importRecords()} disabled={isImporting}>{isImporting ? 'Importing…' : 'Confirm import'}</Button></div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-[#718198]" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="field-control h-10 w-full pl-9" placeholder="Search ID, subject, owner, requester, or category" aria-label="Search historical PCAR records" /></div>
        <p className="text-sm text-[#52627a] dark:text-slate-300">{filtered.length} of {records.length} records</p>
      </div>

      <Card className="mt-4 overflow-hidden">
        {isLoading ? <SkeletonTable /> : <div className="overflow-x-auto"><table className="w-full min-w-[940px]"><thead className="border-b border-[#e2e8f0] bg-slate-50 dark:border-slate-800 dark:bg-slate-900"><tr>{['Legacy ID', 'Subject', 'Category', 'Historical owner', 'Status', 'Priority', 'Created', 'Completed'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#52627a] dark:text-slate-300">{heading}</th>)}</tr></thead><tbody>{filtered.length ? filtered.map((record) => <tr key={record.historicalPcarId} onClick={() => setSelectedRecord(record)} className={`cursor-pointer border-b border-[#eef2f7] last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60 ${selectedRecord?.historicalPcarId === record.historicalPcarId ? 'bg-[#f4f8fd] dark:bg-blue-950/25' : ''}`}><td className="px-4 py-3 text-sm font-semibold text-[#174f91] dark:text-blue-200">#{record.legacyRequestId}</td><td className="max-w-[24rem] px-4 py-3 text-sm text-[#26334d] dark:text-white">{record.subject || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.category || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.historicalOwnerName || 'Unassigned'}{record.linkedUserName && <span className="block text-xs text-[#3f8bca]">Linked: {record.linkedUserName}</span>}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceStatus || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.priority || '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceCreatedAt ? formatDateTime(record.sourceCreatedAt) : '—'}</td><td className="px-4 py-3 text-sm text-[#52627a] dark:text-slate-300">{record.sourceCompletedAt ? formatDateTime(record.sourceCompletedAt) : '—'}</td></tr>) : <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[#52627a] dark:text-slate-300"><FileSpreadsheet className="mx-auto mb-2 h-6 w-6 text-[#94a3b8]" />No historical PCAR records match this view.</td></tr>}</tbody></table></div>}
      </Card>

      {selectedRecord && <Card className="mt-4"><CardBody className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#174f91] dark:text-blue-200">Legacy PCAR #{selectedRecord.legacyRequestId}</p><h3 className="mt-1 text-lg font-semibold text-[#26334d] dark:text-white">{selectedRecord.subject || 'Untitled record'}</h3></div><Button size="sm" variant="secondary" onClick={() => setSelectedRecord(null)}>Close details</Button></div><div className="mt-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Historical owner', selectedRecord.historicalOwnerName || 'Unassigned'], ['Requester', selectedRecord.requesterName || '—'], ['Department / group', [selectedRecord.department, selectedRecord.groupName].filter(Boolean).join(' / ') || '—'], ['Category / severity', [selectedRecord.category, selectedRecord.severity].filter(Boolean).join(' / ') || '—'], ['Created', selectedRecord.sourceCreatedAt ? formatDateTime(selectedRecord.sourceCreatedAt) : '—'], ['Due', selectedRecord.sourceDueAt ? formatDateTime(selectedRecord.sourceDueAt) : '—'], ['Completed', selectedRecord.sourceCompletedAt ? formatDateTime(selectedRecord.sourceCompletedAt) : '—'], ['Last updated', selectedRecord.sourceUpdatedAt ? formatDateTime(selectedRecord.sourceUpdatedAt) : '—']].map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">{label}</p><p className="mt-1 text-[#26334d] dark:text-white">{value}</p></div>)}</div>{[['Description', selectedRecord.description], ['Resolution', selectedRecord.resolution], ['Closure', [selectedRecord.closureCode, selectedRecord.closureComments].filter(Boolean).join(': ') || undefined]].map(([label, value]) => value && <div key={label} className="mt-5 border-t border-[#e2e8f0] pt-4 dark:border-slate-800"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">{label}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-[#44546b] dark:text-slate-200">{value}</p></div>)}</CardBody></Card>}
    </section>
  );
}
