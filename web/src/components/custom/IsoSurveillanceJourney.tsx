import { ArrowRight, BadgeCheck, ClipboardCheck, FileCheck2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';

interface IsoSurveillanceJourneyProps {
  openPcars: number;
  overduePcars: number;
  onOpenPcars: () => void;
  onOpenDocuments: () => void;
}

const phases = [
  {
    title: 'ISO 9001 preparation',
    detail: 'Confirm controlled evidence, competence records, quality objectives, risks, and supplier controls.',
    state: 'Current focus',
    tone: 'current',
  },
  {
    title: 'Internal Audit',
    detail: 'Test the management system, retain objective evidence, and raise findings where required.',
    state: 'Next',
    tone: 'next',
  },
  {
    title: 'Management Review',
    detail: 'Review audit outcomes, performance, risks, CAPA effectiveness, and resulting actions.',
    state: 'Planned',
    tone: 'next',
  },
  {
    title: 'External Surveillance Audit',
    detail: 'Present the evidence pack and demonstrate effective operation of the QMS.',
    state: 'Target: next 3 months',
    tone: 'target',
  },
] as const;

export function IsoSurveillanceJourney({ openPcars, overduePcars, onOpenPcars, onOpenDocuments }: IsoSurveillanceJourneyProps) {
  return (
    <Card className="overflow-hidden">
      <CardBody className="p-0">
        <div className="border-b border-[#dbe2ec] bg-[#f5f8fc] px-5 py-5 dark:border-white/10 dark:bg-[#142238]">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-[#174f91] dark:text-blue-200">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                <h2 className="text-lg font-semibold tracking-[-0.01em]">ISO 9001:2015 Surveillance Journey</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#52627a] dark:text-slate-300">
                The active surveillance cycle is structured around readiness evidence, internal assurance, management review, and the external audit.
              </p>
            </div>
            <div className="border-t border-[#cfdbe9] pt-3 text-sm lg:min-w-[15rem] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 dark:border-white/15">
              <p className="font-semibold text-[#26334d] dark:text-white">External audit date to be confirmed</p>
              <p className="mt-1 text-[#52627a] dark:text-slate-300">Preparation window: next 3 months</p>
            </div>
          </div>
        </div>

        <div className="grid border-b border-[#e2e8f0] sm:grid-cols-3 dark:border-white/10">
          <div className="px-5 py-4 sm:border-r sm:border-[#e2e8f0] dark:sm:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">Certificate</p>
            <p className="mt-1 font-medium text-[#26334d] dark:text-white">No. 00.12.1041 · EUROCERT S.A.</p>
          </div>
          <div className="border-t border-[#e2e8f0] px-5 py-4 sm:border-r sm:border-t-0 sm:border-[#e2e8f0] dark:border-white/10 dark:sm:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">Certificate cycle</p>
            <p className="mt-1 font-medium text-[#26334d] dark:text-white">25 Feb 2026 – 05 Feb 2029</p>
          </div>
          <div className="border-t border-[#e2e8f0] px-5 py-4 sm:border-t-0 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#718198] dark:text-slate-400">Certified scope</p>
            <p className="mt-1 font-medium leading-5 text-[#26334d] dark:text-white">Design, development &amp; supply of sensing solutions and sensor-management software</p>
          </div>
        </div>

        <div className="px-5 py-6">
          <ol className="grid gap-0 lg:grid-cols-4" aria-label="ISO 9001 surveillance workflow">
            {phases.map((phase, index) => (
              <li key={phase.title} className="relative flex gap-3 pb-5 last:pb-0 lg:block lg:pb-0 lg:pr-5">
                {index < phases.length - 1 && <div className="absolute left-[9px] top-5 h-[calc(100%-16px)] w-px bg-[#cbd8e6] lg:left-5 lg:top-[19px] lg:h-px lg:w-[calc(100%-24px)] dark:bg-white/20" aria-hidden="true" />}
                <div className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 lg:mb-4 ${phase.tone === 'current' ? 'border-[#1f6caf] bg-[#1f6caf] text-white' : phase.tone === 'target' ? 'border-[#c27a12] bg-[#fff7e6] text-[#a86100] dark:bg-amber-500/15 dark:text-amber-300' : 'border-[#98abc0] bg-white text-[#52627a] dark:border-slate-500 dark:bg-slate-900 dark:text-slate-300'}`}>
                  {phase.tone === 'current' ? <FileCheck2 className="h-3 w-3" /> : <span className="text-[10px] font-bold">{index + 1}</span>}
                </div>
                <div className="min-w-0 lg:pr-4">
                  <p className={`text-xs font-semibold ${phase.tone === 'current' ? 'text-[#1763a5] dark:text-blue-300' : phase.tone === 'target' ? 'text-[#a86100] dark:text-amber-300' : 'text-[#718198] dark:text-slate-400'}`}>{phase.state}</p>
                  <h3 className="mt-1 text-sm font-semibold text-[#26334d] dark:text-white">{phase.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-[#64748b] dark:text-slate-400">{phase.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-px border-t border-[#dbe2ec] bg-[#dbe2ec] sm:grid-cols-[1fr_1fr_auto] dark:border-white/10 dark:bg-white/10">
          <button onClick={onOpenPcars} className="group bg-white px-5 py-4 text-left transition-colors hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3f8bca] dark:bg-slate-900 dark:hover:bg-white/5">
            <div className="flex items-center gap-2 text-[#52627a] dark:text-slate-300"><ClipboardCheck className="h-4 w-4 text-[#3f8bca]" /><span className="text-sm font-medium">My open PCAR findings</span></div>
            <p className={`mt-1 text-sm ${overduePcars > 0 ? 'font-semibold text-[#c73c44] dark:text-red-300' : 'text-[#26334d] dark:text-white'}`}>{openPcars} open{overduePcars > 0 ? ` · ${overduePcars} overdue` : ' · review evidence and closure actions'}</p>
          </button>
          <button onClick={onOpenDocuments} className="group bg-white px-5 py-4 text-left transition-colors hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3f8bca] dark:bg-slate-900 dark:hover:bg-white/5">
            <div className="flex items-center gap-2 text-[#52627a] dark:text-slate-300"><BadgeCheck className="h-4 w-4 text-[#3f8bca]" /><span className="text-sm font-medium">Evidence preparation</span></div>
            <p className="mt-1 text-sm text-[#26334d] dark:text-white">Review released procedures, records, and audit evidence</p>
          </button>
          <div className="flex items-center justify-start bg-white px-5 py-4 sm:justify-end dark:bg-slate-900">
            <Button size="sm" variant="secondary" onClick={onOpenDocuments} rightIcon={<ArrowRight className="h-4 w-4" />}>Open documents</Button>
          </div>
        </div>
        {overduePcars > 0 && <div className="flex items-center gap-2 border-t border-[#f0c9cc] bg-[#fff6f6] px-5 py-3 text-sm text-[#9f3038] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"><TriangleAlert className="h-4 w-4 shrink-0" />Overdue PCAR findings may block surveillance readiness. Review and update their evidence before the internal audit.</div>}
      </CardBody>
    </Card>
  );
}
