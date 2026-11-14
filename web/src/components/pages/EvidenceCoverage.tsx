import { ArrowRight, FolderCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../../types';
import { apiClient } from '../../utils/api';
import { usePageAccess } from '../../hooks/usePageAccess';
import { Card, CardBody } from '../ui/Card';
import type { ReadinessRequirement } from '../../utils/isoDepartmentReadiness';

type Cycle = { auditCycleId: string; name: string; standard: string; status: string };
type CoveredFolder = { folderId: string; path: string; departmentFolderId: string; departmentFolderName: string };
type Contact = { departmentFolderId: string; userId: string };

export function EvidenceCoverage({ defaultStandard = 'ISO 9001:2015', lockStandard = false }: { defaultStandard?: string; lockStandard?: boolean }) {
  const navigate = useNavigate();
  const canManage = usePageAccess()?.canViewAdminPanel === true;
  const [standard, setStandard] = useState(defaultStandard);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [folders, setFolders] = useState<CoveredFolder[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [requirements, setRequirements] = useState<ReadinessRequirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { apiClient.getAuditCycles().then(response => setCycles(response.data ?? [])).catch(() => setError(true)); }, []);
  useEffect(() => { setStandard(defaultStandard); }, [defaultStandard]);
  const applicable = useMemo(() => cycles.filter(cycle => cycle.standard === standard), [cycles, standard]);
  useEffect(() => { const active = applicable.find(cycle => cycle.status === 'active'); setCycleId(active?.auditCycleId ?? applicable[0]?.auditCycleId ?? ''); }, [applicable]);
  useEffect(() => {
    if (!cycleId) { setFolders([]); setContacts([]); setRequirements([]); return; }
    let cancelled = false;
    setLoading(true); setError(false);
    Promise.all([apiClient.getAuditCycleSetup(cycleId), apiClient.getEvidenceRequirements(cycleId), apiClient.getUsers({ activeOnly: false })])
      .then(([setupResult, requirementResult, userResult]) => {
        if (cancelled) return;
        if (!Array.isArray(setupResult.data?.folders) || !Array.isArray(setupResult.data?.contacts) || !Array.isArray(requirementResult.data) || !Array.isArray(userResult.data))
          throw new Error('Incomplete evidence coverage response');
        setFolders(setupResult.data.folders);
        setContacts(setupResult.data.contacts);
        setRequirements(requirementResult.data);
        setUsers(userResult.data);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cycleId]);

  const userById = new Map(users.map(user => [user.userId, user]));
  const selectedCycle = cycles.find(cycle => cycle.auditCycleId === cycleId);
  const totals = folders.reduce((result, folder) => {
    const docs = requirements.filter(item => item.folderId === folder.folderId);
    result.documents += docs.length;
    result.missing += docs.filter(item => !item.hasEvidence).length;
    return result;
  }, { documents: 0, missing: 0 });

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="page-heading">Evidence Coverage</h1><p className="page-subtitle">Covered process folders and responsible people come from the Admin audit cycle setup. Evidence status updates from linked files in the selected cycle.</p></div>{canManage && <button type="button" onClick={() => navigate('/admin/audit-programme')} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1763a5] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]">Manage cycle setup <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}</div>
    <Card><CardBody className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium text-[#34425b] dark:text-slate-200">ISO standard<select value={standard} onChange={event => setStandard(event.target.value)} disabled={lockStandard} className="field-control mt-1 h-10 w-full px-3 disabled:cursor-not-allowed disabled:bg-[#f1f5f9]"><option>ISO 9001:2015</option>{!lockStandard && <option>ISO 27001:2022</option>}</select></label><label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Audit cycle<select value={cycleId} onChange={event => setCycleId(event.target.value)} className="field-control mt-1 h-10 w-full px-3"><option value="">Select a cycle</option>{applicable.map(cycle => <option key={cycle.auditCycleId} value={cycle.auditCycleId}>{cycle.name}{cycle.status === 'active' ? ' — Active' : ''}</option>)}</select></label></div>{selectedCycle && <p className="text-xs text-[#52627a] dark:text-slate-300">{selectedCycle.status === 'historical' ? 'Historical cycle · read-only' : `${folders.length} selected folder${folders.length === 1 ? '' : 's'} · ${totals.documents} controlled documents · ${totals.missing} without linked evidence`}</p>}</CardBody></Card>
    <Card><CardBody className="p-0"><div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><div className="flex items-center gap-2"><FolderCheck className="h-5 w-5 text-[#1763a5]" aria-hidden="true" /><h2 className="section-heading">Covered process folders</h2></div><p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Every controlled document directly inside a selected folder needs linked evidence for this cycle. The folder selection and responsibility map are maintained in Admin.</p></div>
      {loading ? <p className="px-5 py-8 text-sm text-[#52627a] dark:text-slate-300">Loading cycle coverage…</p>
        : error ? <p role="alert" className="px-5 py-8 text-sm text-[#9f3038] dark:text-red-200">Could not load cycle coverage. Refresh this page to try again.</p>
        : !cycleId ? <p className="px-5 py-8 text-sm text-[#52627a] dark:text-slate-300">Select or create an audit cycle first.</p>
        : folders.length ? <div className="divide-y divide-[#e8eef5] dark:divide-white/10">{folders.map(folder => {
          const docs = requirements.filter(item => item.folderId === folder.folderId);
          const missing = docs.filter(item => !item.hasEvidence);
          const names = contacts.filter(contact => contact.departmentFolderId === folder.departmentFolderId)
            .map(contact => userById.get(contact.userId)?.fullName).filter((name): name is string => !!name);
          return <section key={folder.folderId} className="px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold text-[#26334d] dark:text-white">{folder.path}</h3><p className="mt-1 text-xs text-[#52627a] dark:text-slate-300">{folder.departmentFolderName} · Responsible: {names.length ? names.join(', ') : 'Not assigned'}</p></div><span className={`shrink-0 text-sm font-semibold ${missing.length ? 'text-[#a65f08] dark:text-amber-300' : 'text-[#258456] dark:text-green-300'}`}>{docs.length === 0 ? 'No controlled documents' : missing.length ? `${missing.length} awaiting evidence` : 'Coverage complete'}</span></div>{docs.length > 0 && <p className="mt-2 text-xs text-[#52627a] dark:text-slate-300">{docs.length - missing.length} of {docs.length} documents have linked evidence</p>}{missing.length > 0 && <details className="mt-2 text-sm text-[#34425b] dark:text-slate-200"><summary className="cursor-pointer font-medium text-[#1763a5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]">Show documents awaiting evidence</summary><ul className="mt-2 list-disc space-y-1 pl-5">{missing.map(item => <li key={item.evidenceRequirementId}>{item.documentTitle}</li>)}</ul></details>}</section>;
        })}</div>
        : <p className="px-5 py-8 text-sm text-[#52627a] dark:text-slate-300">No process folders have been selected for this cycle. {canManage ? 'Choose them in Admin → Audit Programme.' : 'Ask an administrator to configure the cycle.'}</p>}
    </CardBody></Card>
  </div>;
}
