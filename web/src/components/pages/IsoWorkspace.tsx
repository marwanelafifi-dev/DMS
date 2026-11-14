import { useState } from 'react';
import { CalendarDays, FileCheck2, ListChecks, Shield } from 'lucide-react';
import { AuditProgramme } from '../custom/AuditProgramme';
import { EvidenceCoverage } from './EvidenceCoverage';
import { ManagementReview } from './ManagementReview';
import { IsoReadiness } from './IsoReadiness';

const tabs = [{ id: 'readiness', label: 'Readiness', icon: Shield }, { id: 'plan', label: 'Audit plan & register', icon: CalendarDays }, { id: 'evidence', label: 'Evidence coverage', icon: FileCheck2 }, { id: 'review', label: 'Management Review', icon: ListChecks }] as const;

export function IsoWorkspace() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('readiness');
  return <div className="space-y-5"><div><h1 className="page-heading">ISO 9001 Workspace</h1><p className="page-subtitle">Manage the ISO 9001 plan, journey records, evidence, and Management Review in one Quality workspace.</p></div><div className="flex flex-wrap gap-2 border-b border-[#dbe2ec] pb-3 dark:border-white/10">{tabs.map(item => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold ${active ? 'bg-[#1763a5] text-white' : 'bg-white text-[#52627a] hover:bg-[#eef4fb] dark:bg-slate-900 dark:text-slate-200'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div>{tab === 'readiness' && <IsoReadiness />}{tab === 'plan' && <AuditProgramme defaultStandard="ISO 9001:2015" lockStandard />}{tab === 'evidence' && <EvidenceCoverage />}{tab === 'review' && <ManagementReview />}</div>;
}
