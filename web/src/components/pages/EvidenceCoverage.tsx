import { FolderCheck, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import { folderPathLabel } from '../../utils/folderPath';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { useToast } from '../../hooks/useToast';

type CoverageItem = {
  evidenceRequirementId: string;
  relatedDocumentId: string;
  documentTitle: string;
  folderId: string;
  folderName: string;
  hasEvidence: boolean;
};

export function EvidenceCoverage() {
  const { showError, showSuccess } = useToast();
  const [standard, setStandard] = useState('ISO 9001:2015');
  const [cycles, setCycles] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [items, setItems] = useState<CoverageItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const applicable = useMemo(() => cycles.filter(cycle => cycle.standard === standard), [cycles, standard]);
  const path = (folderId: string) => folderPathLabel(folderId, folders) ?? '';
  const documentCount = (folderId: string) => docs.filter(document => document.folderId === folderId && document.category !== 'Evidence').length;

  const eligibleFolders = useMemo(() => folders
    .map(folder => ({ ...folder, path: path(folder.folderId), documents: documentCount(folder.folderId) }))
    .filter(folder => {
      const parts: string[] = String(folder.path).split(' / ');
      const isProcedureFolder = parts[0] === 'Corporate' && parts[1] === 'QMS' && parts[2] === 'Procedures'
        && !parts.some(part => part.toLowerCase() === 'evidences' || part.toLowerCase() === 'old dms');
      const isIso27001 = parts.some(part => part.toLowerCase() === 'iso 27001');
      return isProcedureFolder && folder.documents > 0 && (standard === 'ISO 27001:2022' ? isIso27001 : !isIso27001);
    })
    .sort((left, right) => left.path.localeCompare(right.path)), [folders, docs, standard]);

  const matchingFolders = useMemo(() => {
    const term = query.trim().toLowerCase();
    return eligibleFolders.filter(folder => !term || folder.path.toLowerCase().includes(term));
  }, [eligibleFolders, query]);

  const groups = useMemo(() => Object.values(items.reduce<Record<string, { folderId: string; folderName: string; requirements: CoverageItem[] }>>((result, item) => {
    const existing = result[item.folderId] ?? { folderId: item.folderId, folderName: item.folderName, requirements: [] };
    existing.requirements.push(item); result[item.folderId] = existing; return result;
  }, {})).sort((left, right) => left.folderName.localeCompare(right.folderName)), [items]);

  useEffect(() => {
    Promise.all([apiClient.getAuditCycles(), apiClient.getFolders(), apiClient.getDocuments()])
      .then(([cycleResult, folderResult, documentResult]) => { setCycles(cycleResult.data ?? []); setFolders(folderResult.data ?? []); setDocs(documentResult.data ?? []); })
      .catch(() => showError('Could not load evidence coverage.'));
  }, []);

  useEffect(() => {
    const active = applicable.find(cycle => cycle.status === 'active');
    setCycleId(active?.auditCycleId ?? applicable[0]?.auditCycleId ?? '');
    setSelectedFolderIds([]); setQuery('');
  }, [standard, cycles]);

  const load = () => {
    if (!cycleId) { setItems([]); return; }
    apiClient.getEvidenceRequirements(cycleId).then(result => setItems(result.data ?? [])).catch(() => setItems([]));
  };
  useEffect(load, [cycleId]);

  const toggle = (folderId: string) => setSelectedFolderIds(current => current.includes(folderId) ? current.filter(id => id !== folderId) : [...current, folderId]);
  const add = async () => {
    if (!cycleId || selectedFolderIds.length === 0) return showError('Select at least one process folder.');
    setIsAdding(true);
    try {
      const result = await apiClient.createEvidenceRequirementsForFolders({ auditCycleId: cycleId, standard, folderIds: selectedFolderIds });
      const summary = result.data ?? {};
      setSelectedFolderIds([]); load();
      showSuccess(`${summary.added ?? 0} controlled document${summary.added === 1 ? '' : 's'} now require evidence.`);
    } catch (error: any) {
      showError(error.response?.data?.error || 'Could not create the folder coverage rules.');
    } finally { setIsAdding(false); }
  };
  const removeGroup = async (group: { requirements: CoverageItem[] }) => {
    if (!window.confirm('Remove this folder from evidence coverage? Its documents will no longer be checked for this cycle.')) return;
    try {
      await Promise.all(group.requirements.map(item => apiClient.deleteEvidenceRequirement(item.evidenceRequirementId)));
      load(); showSuccess('Folder coverage removed.');
    } catch { showError('Could not remove the folder coverage rule.'); }
  };

  return <div className="space-y-5">
    <div><h1 className="page-heading">Evidence Coverage</h1><p className="page-subtitle">Select process folders once. The DMS automatically requires evidence for controlled files directly inside each folder and checks linked evidence for the active cycle.</p></div>
    <Card><CardBody className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium text-[#34425b] dark:text-slate-200">ISO standard<select value={standard} onChange={event => setStandard(event.target.value)} className="field-control mt-1 h-10 w-full px-3"><option>ISO 9001:2015</option><option>ISO 27001:2022</option></select></label><label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Audit cycle<select value={cycleId} onChange={event => setCycleId(event.target.value)} className="field-control mt-1 h-10 w-full px-3"><option value="">Select cycle</option>{applicable.map(cycle => <option key={cycle.auditCycleId} value={cycle.auditCycleId}>{cycle.name}</option>)}</select></label></div>
      <div className="border-t border-[#e2e8f0] pt-4 dark:border-white/10"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h2 className="section-heading">Process folders</h2><p className="mt-1 text-sm text-[#64748b]">Select one or more process folders. Do not select an <strong>Evidences</strong> folder; it is detected automatically.</p></div><span className="text-sm font-medium text-[#1763a5]">{selectedFolderIds.length} selected</span></div><div className="relative mt-4"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#718198]" /><input value={query} onChange={event => setQuery(event.target.value)} className="field-control h-10 w-full pl-10 pr-3" placeholder="Search process folder, for example MEMS, Hiring, or ISO 9001" aria-label="Search process folders" /></div><div className="mt-3 max-h-72 overflow-y-auto rounded-[5px] border border-[#dbe2ec] bg-[#fbfdff] p-2 dark:border-white/10 dark:bg-slate-950/30">{matchingFolders.length ? matchingFolders.map(folder => <label key={folder.folderId} className="flex cursor-pointer items-center gap-3 rounded px-3 py-2.5 hover:bg-[#eef4fb] dark:hover:bg-slate-800"><input type="checkbox" checked={selectedFolderIds.includes(folder.folderId)} onChange={() => toggle(folder.folderId)} className="h-4 w-4 shrink-0 accent-[#2f6f9f]" /><span className="min-w-0"><span className="block truncate text-sm font-medium text-[#26334d] dark:text-white">{folder.path}</span><span className="text-xs text-[#718198]">{folder.documents} controlled document{folder.documents === 1 ? '' : 's'} detected</span></span></label>) : <p className="px-3 py-5 text-sm text-[#718198]">No eligible process folders match this search.</p>}</div><div className="mt-4 flex justify-end"><Button onClick={() => void add()} disabled={isAdding || !cycleId || selectedFolderIds.length === 0} leftIcon={<FolderCheck className="h-4 w-4" />}>{isAdding ? 'Adding folders...' : 'Require evidence for selected folders'}</Button></div></div>
    </CardBody></Card>
    <Card><CardBody className="p-0"><div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><h2 className="section-heading">Cycle coverage</h2><p className="mt-1 text-sm text-[#64748b]">Each folder is ready only when every required controlled document has linked evidence.</p></div>{groups.length ? <div className="divide-y divide-[#e8eef5] dark:divide-white/10">{groups.map(group => { const linked = group.requirements.filter(item => item.hasEvidence).length; const missing = group.requirements.length - linked; return <div key={group.folderId} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate font-medium text-[#26334d] dark:text-white">{path(group.folderId) || group.folderName}</p><p className="mt-1 text-sm text-[#64748b]">{group.requirements.length} controlled document{group.requirements.length === 1 ? '' : 's'} · {linked} linked</p><p className={`mt-1 text-xs font-semibold ${missing === 0 ? 'text-[#258456]' : 'text-[#b16a08]'}`}>{missing === 0 ? 'Evidence coverage complete' : `${missing} document${missing === 1 ? '' : 's'} still need evidence`}</p></div><button onClick={() => void removeGroup(group)} className="rounded p-2 text-[#b33a42] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label={`Remove ${group.folderName} coverage`} title="Remove folder coverage"><Trash2 className="h-4 w-4" /></button></div>; })}</div> : <p className="px-5 py-10 text-center text-sm text-[#718198]">No process folders have been added for this cycle.</p>}</CardBody></Card>
  </div>;
}
