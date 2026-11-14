import { useState } from 'react';
import { CalendarDays, Shield } from 'lucide-react';
import { AuditProgramme } from '../custom/AuditProgramme';
import { IsoReadiness } from './IsoReadiness';

export function Iso27001Workspace() {
  const [tab, setTab] = useState<'readiness' | 'plan'>('readiness');
  return <div className="space-y-5"><div><h1 className="page-heading">ISO 27001 Workspace</h1><p className="page-subtitle">Manage the IT-only ISMS readiness view and annual audit plan separately from ISO 9001.</p></div><div className="flex flex-wrap gap-2 border-b border-[#dbe2ec] pb-3 dark:border-white/10"><button onClick={() => setTab('readiness')} className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold ${tab === 'readiness' ? 'bg-[#1763a5] text-white' : 'bg-white text-[#52627a] hover:bg-[#eef4fb] dark:bg-slate-900 dark:text-slate-200'}`}><Shield className="h-4 w-4" />Readiness</button><button onClick={() => setTab('plan')} className={`inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-semibold ${tab === 'plan' ? 'bg-[#1763a5] text-white' : 'bg-white text-[#52627a] hover:bg-[#eef4fb] dark:bg-slate-900 dark:text-slate-200'}`}><CalendarDays className="h-4 w-4" />Audit plan</button></div>{tab === 'readiness' ? <IsoReadiness standard="ISO 27001:2022" /> : <AuditProgramme defaultStandard="ISO 27001:2022" lockStandard />}</div>;
}
