import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Shield } from 'lucide-react';
import { AuditProgramme } from '../custom/AuditProgramme';
import { IsoReadiness } from './IsoReadiness';
import { usePageAccess } from '../../hooks/usePageAccess';

const tabs = [{ id: 'readiness', label: 'Readiness', icon: Shield }, { id: 'plan', label: 'Audit plan & register', icon: CalendarDays }] as const;

export function IsoWorkspace() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('readiness');
  const access = usePageAccess();
  const availableTabs = useMemo(() => tabs.filter((item) => item.id !== 'plan' || access?.canViewIso9001AuditPlan === true), [access?.canViewIso9001AuditPlan]);

  useEffect(() => {
    if (tab === 'plan' && !access?.canViewIso9001AuditPlan) setTab('readiness');
  }, [access?.canViewIso9001AuditPlan, tab]);

  return <div className="space-y-5"><div><h1 className="page-heading">ISO 9001 Workspace</h1><p className="page-subtitle">{access?.canViewIso9001AuditPlan ? 'Manage ISO 9001 readiness, the audit plan, and journey records in one Quality workspace.' : 'Review ISO 9001 readiness, evidence gaps, tasks, and PCAR blockers.'}</p></div>{availableTabs.length > 1 && <div className="flex flex-wrap gap-2 border-b border-[#dbe2ec] pb-3 dark:border-white/10">{availableTabs.map(item => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold ${active ? 'bg-[#1763a5] text-white' : 'bg-white text-[#52627a] hover:bg-[#eef4fb] dark:bg-slate-900 dark:text-slate-200'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div>}{tab === 'readiness' && <IsoReadiness />}{tab === 'plan' && access?.canViewIso9001AuditPlan && <AuditProgramme defaultStandard="ISO 9001:2015" lockStandard />}</div>;
}
