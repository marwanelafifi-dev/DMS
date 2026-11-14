import { ArrowRight, BadgeCheck, CalendarDays, Check, ClipboardCheck, FileCheck2, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';

interface IsoSurveillanceJourneyProps {
  openPcars: number;
  overduePcars: number;
  onOpenPcars: () => void;
  onOpenDocuments: () => void;
  onOpenAudits: () => void;
}

const stages = [
  { key: 'preparation', title: 'Preparation', summary: 'Collect controlled evidence and confirm readiness.' },
  { key: 'internal_audit', title: 'Internal Audit', summary: 'Test the QMS and record findings.' },
  { key: 'management_review', title: 'Management Review', summary: 'Review outcomes, risks, and actions.' },
  { key: 'surveillance_audit', title: 'Surveillance Audit', summary: 'Present the QMS to the external auditor.' },
] as const;

const displayDate = (value?: string) => {
  if (!value) return 'Date not set';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const statusLabel = (status?: string) => ({ completed: 'Completed', in_progress: 'In progress', planned: 'Planned' }[status ?? ''] ?? 'Not scheduled');
const auditTypeForStage: Record<string, string> = { preparation: 'preparation', internal_audit: 'internal', management_review: 'management_review', surveillance_audit: 'external' };

export function IsoSurveillanceJourney({ openPcars, overduePcars, onOpenPcars, onOpenDocuments, onOpenAudits }: IsoSurveillanceJourneyProps) {
  const [cycle, setCycle] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiClient.getAuditCycles(), apiClient.getAuditCalendarEvents()])
      .then(async ([cycles, calendar]) => {
        if (cancelled) return;
        const active = (cycles.data ?? []).find((item: any) => item.standard === 'ISO 9001:2015' && item.status === 'active');
        const audits = active ? await apiClient.getAuditRecords({ auditCycleId: active.auditCycleId }) : { data: [] };
        if (cancelled) return;
        setCycle(active ?? null);
        setEvents((calendar.data ?? []).filter((item: any) => item.auditCycleId === active?.auditCycleId));
        setRecords(audits.data ?? []);
      })
      .catch(() => { if (!cancelled) { setCycle(null); setEvents([]); setRecords([]); } });
    return () => { cancelled = true; };
  }, []);

  const journey = useMemo(() => {
    const eventFor = (key: string) => events.find(event => event.stageKey === key);
    const recordFor = (key: string) => records.find(record => record.auditType === auditTypeForStage[key]);
    const statusFor = (key: string) => recordFor(key)?.status ?? (eventFor(key) ? 'planned' : undefined);
    const currentKey = stages.find(stage => statusFor(stage.key) === 'in_progress')?.key
      ?? stages.find(stage => statusFor(stage.key) !== 'completed')?.key
      ?? stages[stages.length - 1].key;
    const currentIndex = stages.findIndex(stage => stage.key === currentKey);

    return stages.map((stage, index) => {
      const event = eventFor(stage.key);
      const status = statusFor(stage.key);
      const complete = status === 'completed';
      const current = stage.key === currentKey;
      return {
        ...stage,
        event,
        complete,
        current,
        next: !complete && !current && index > currentIndex,
        status: statusLabel(status),
      };
    });
  }, [events, records]);

  const current = journey.find(stage => stage.current) ?? journey[0];
  const actionIsAudit = current?.key === 'internal_audit' || current?.key === 'surveillance_audit';
  const currentAction = actionIsAudit ? onOpenAudits : onOpenDocuments;
  const currentActionLabel = actionIsAudit ? `Open ${current.title}` : 'Open evidence library';
  const completedCount = journey.filter(stage => stage.complete).length;

  return <Card className="overflow-hidden">
    <CardBody className="p-0">
      <div className="border-b border-[#dbe2ec] bg-[#f8fafc] px-5 py-5 dark:border-white/10 dark:bg-slate-900/70 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#174f91] dark:text-blue-200"><ShieldCheck className="h-5 w-5" aria-hidden="true" /><h2 className="text-lg font-semibold tracking-[-0.01em]">ISO 9001 Surveillance</h2></div>
            <p className="mt-1.5 text-sm text-[#52627a] dark:text-slate-300">{cycle?.name ?? 'No active ISO 9001 cycle'}</p>
          </div>
          <div className="text-sm lg:text-right">
            <p className="font-semibold text-[#26334d] dark:text-white">{cycle ? `${displayDate(cycle.startDate)} – ${displayDate(cycle.endDate)}` : 'Configure a cycle in Admin Panel'}</p>
            <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">{completedCount} of {journey.length} major stages complete</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,.7fr)]">
        <section className="px-5 py-6 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#1763a5] dark:text-blue-300">Current focus</p>
          <div className="mt-2 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <h3 className="text-2xl font-semibold tracking-[-0.025em] text-[#26334d] dark:text-white">{current.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#52627a] dark:text-slate-300">{current.summary}</p>
            </div>
            <Button onClick={currentAction} rightIcon={<ArrowRight className="h-4 w-4" />}>{currentActionLabel}</Button>
          </div>
          <div className="mt-6 grid gap-3 border-t border-[#e2e8f0] pt-4 sm:grid-cols-3 dark:border-white/10">
            <div className="flex items-start gap-2.5"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#3f8bca]" /><div><p className="text-xs text-[#718198]">Target date</p><p className="mt-0.5 text-sm font-medium text-[#26334d] dark:text-white">{displayDate(current.event?.eventDate)}</p></div></div>
            <div className="flex items-start gap-2.5"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#3f8bca]" /><div><p className="text-xs text-[#718198]">Accountable owner</p><p className="mt-0.5 text-sm font-medium text-[#26334d] dark:text-white">{current.event?.ownerName ?? 'Not assigned'}</p></div></div>
            <div className="flex items-start gap-2.5"><FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3f8bca]" /><div><p className="text-xs text-[#718198]">Stage status</p><p className="mt-0.5 text-sm font-medium text-[#26334d] dark:text-white">{current.status}</p></div></div>
          </div>
        </section>

        <aside className="border-t border-[#e2e8f0] bg-[#fbfdff] px-5 py-6 dark:border-white/10 dark:bg-slate-950/20 lg:border-l lg:border-t-0 sm:px-6">
          <h3 className="text-sm font-semibold text-[#26334d] dark:text-white">Readiness checks</h3>
          <p className="mt-1 text-xs leading-5 text-[#718198]">Resolve these before the surveillance audit.</p>
          <div className="mt-4 divide-y divide-[#e2e8f0] border-y border-[#e2e8f0] dark:divide-white/10 dark:border-white/10">
            <button onClick={onOpenPcars} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:text-[#1763a5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]">
              <span className="flex items-center gap-2 text-sm font-medium text-[#26334d] dark:text-white"><ClipboardCheck className="h-4 w-4 text-[#3f8bca]" />Open PCARs</span>
              <span className={overduePcars > 0 ? 'text-sm font-semibold text-[#c73c44]' : 'text-sm font-semibold text-[#26334d] dark:text-white'}>{openPcars}{overduePcars > 0 ? ` · ${overduePcars} overdue` : ''}</span>
            </button>
            <button onClick={onOpenDocuments} className="flex w-full items-center justify-between gap-4 py-3 text-left hover:text-[#1763a5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]">
              <span className="flex items-center gap-2 text-sm font-medium text-[#26334d] dark:text-white"><BadgeCheck className="h-4 w-4 text-[#3f8bca]" />Evidence library</span>
              <span className="text-xs font-semibold text-[#1763a5]">Review</span>
            </button>
          </div>
        </aside>
      </div>

      <section className="border-t border-[#dbe2ec] px-5 py-5 sm:px-6 dark:border-white/10">
        <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold text-[#26334d] dark:text-white">Journey timeline</h3><p className="text-xs text-[#718198]">Live status from the active cycle</p></div>
        <ol className="mt-4 grid gap-3 md:grid-cols-4" aria-label="ISO 9001 surveillance workflow">
          {journey.map((stage, index) => <li key={stage.key} className={`min-w-0 border-t-2 pt-3 ${stage.current ? 'border-[#1f6caf]' : stage.complete ? 'border-[#57a87b]' : 'border-[#d7e0eb] dark:border-slate-700'}`}>
            <div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${stage.complete ? 'bg-[#e8f6ee] text-[#24734a] dark:bg-emerald-500/15 dark:text-emerald-300' : stage.current ? 'bg-[#1763a5] text-white' : 'bg-[#eef2f6] text-[#64748b] dark:bg-slate-800 dark:text-slate-300'}`}>{stage.complete ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className={`text-xs font-semibold ${stage.current ? 'text-[#1763a5] dark:text-blue-300' : 'text-[#718198]'}`}>{stage.status}</span></div>
            <p className="mt-2 text-sm font-semibold text-[#26334d] dark:text-white">{stage.title}</p>
            <p className="mt-1 text-xs text-[#718198]">{stage.event?.eventDate ? displayDate(stage.event.eventDate) : 'Date not set'}</p>
          </li>)}
        </ol>
      </section>
      {overduePcars > 0 && <div className="flex items-center gap-2 border-t border-[#f0c9cc] bg-[#fff6f6] px-5 py-3 text-sm text-[#9f3038] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"><TriangleAlert className="h-4 w-4 shrink-0" />{overduePcars} overdue PCAR finding{overduePcars === 1 ? '' : 's'} may block surveillance readiness.</div>}
    </CardBody>
  </Card>;
}
