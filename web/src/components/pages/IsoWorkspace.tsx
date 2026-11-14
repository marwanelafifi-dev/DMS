import { useState } from 'react';
import { ClipboardCheck, FileCheck2, ListChecks, Shield } from 'lucide-react';
import { AuditRegister } from './AuditRegister';
import { EvidenceCoverage } from './EvidenceCoverage';
import { ManagementReview } from './ManagementReview';
import { IsoReadiness } from './IsoReadiness';

const tabs = [
  { id: 'readiness', label: 'Readiness', icon: Shield },
  { id: 'audits', label: 'Audits', icon: ClipboardCheck },
  { id: 'evidence', label: 'Evidence coverage', icon: FileCheck2 },
  { id: 'review', label: 'Management Review', icon: ListChecks },
] as const;

export function IsoWorkspace() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('readiness');
  return <div className="space-y-5"><div><h1 className="page-heading">ISO 9001 Workspace</h1><p className="page-subtitle">One Quality workspace for readiness, audit management, evidence coverage, and Management Review.</p></div><div className="flex flex-wrap gap-2 border-b border-[#dbe2ec] pb-3 dark:border-white/10">{tabs.map(item => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold ${active ? 'bg-[#1763a5] text-white' : 'bg-white text-[#52627a] hover:bg-[#eef4fb] dark:bg-slate-900 dark:text-slate-200'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div>{tab === 'readiness' && <IsoReadiness />}{tab === 'audits' && <AuditRegister />}{tab === 'evidence' && <EvidenceCoverage />}{tab === 'review' && <ManagementReview />}</div>;
}
