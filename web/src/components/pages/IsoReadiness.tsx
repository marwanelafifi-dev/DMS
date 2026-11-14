import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, FileCheck2, Printer, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../utils/api';
import type { Document, Task } from '../../types';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';

const clauses = [
  ['4', 'Context of the organization'], ['5', 'Leadership'], ['6', 'Planning'], ['7', 'Support'],
  ['8', 'Operation'], ['9', 'Performance evaluation'], ['10', 'Improvement'],
] as const;

const isClosed = (task: Task) => task.status === 'done' || task.status === 'completed';
const isIsoEvidenceCandidate = (document: Document) => document.category === 'Evidence' || document.tags?.some((tag) => tag.toLowerCase() === 'evidence');

export function IsoReadiness({ standard = 'ISO 9001:2015' }: { standard?: 'ISO 9001:2015' | 'ISO 27001:2022' }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [coverageItems, setCoverageItems] = useState<any[]>([]);
  const [reviewEntries, setReviewEntries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([apiClient.getTasks({ pageSize: 200 }), apiClient.getIsoEvidence({ standard }), apiClient.getAuditCycles()])
      .then(async ([taskResult, documentResult, cycleResult]) => {
        if (cancelled) return;
        setTasks(taskResult.status === 'fulfilled' && Array.isArray(taskResult.value.data) ? taskResult.value.data as Task[] : []);
        setDocuments(documentResult.status === 'fulfilled' && Array.isArray(documentResult.value.data) ? documentResult.value.data as Document[] : []);
        const activeCycle = cycleResult.status === 'fulfilled' ? (cycleResult.value.data ?? []).find((cycle: any) => cycle.standard === standard && cycle.status === 'active') : null;
        if (activeCycle) {
          const [coverageResult, reviewResult] = await Promise.all([apiClient.getEvidenceRequirements(activeCycle.auditCycleId).catch(() => ({ data: [] })), apiClient.getManagementReviewEntries({ auditCycleId: activeCycle.auditCycleId }).catch(() => ({ data: [] }))]);
          if (!cancelled) { setCoverageItems(coverageResult.data ?? []); setReviewEntries(reviewResult.data ?? []); }
        } else { setCoverageItems([]); setReviewEntries([]); }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [standard]);

  const pcars = useMemo(() => tasks.filter((task) => task.taskType === 'pcar' && task.auditStandard === standard), [tasks, standard]);
  const openPcars = pcars.filter((task) => !isClosed(task));
  const overduePcars = openPcars.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now());
  const evidenceCandidates = documents.filter(isIsoEvidenceCandidate);
  const activeEvidence = evidenceCandidates.filter((document) => (document as Document & { isAssignedToSelectedCycle?: boolean }).isAssignedToSelectedCycle === true);
  const missingCoverage = coverageItems.filter(item => !item.hasEvidence);
  const reviewCount = (category: string) => reviewEntries.filter(entry => entry.category === category).length;

  if (isLoading) return <div className="space-y-5"><SkeletonCard /><SkeletonCard /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-[#174f91] dark:text-blue-200"><ShieldCheck className="h-5 w-5" /><h1 className="page-heading">{standard} Readiness</h1></div>
          <p className="page-subtitle mt-2">{standard === 'ISO 9001:2015' ? 'Company-wide surveillance cycle evidence, audit findings, and Management Review inputs. Certificate No. 00.12.1041 is valid through 05 February 2029.' : 'IT-only ISMS evidence, audit findings, and review inputs for the active calendar-year programme.'}</p>
        </div>
        <Button variant="secondary" onClick={() => window.print()} leftIcon={<Printer className="h-4 w-4" />}>Print Management Review pack</Button>
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="grid divide-y divide-[#dbe2ec] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-white/10">
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Open PCARs</p><p className="mt-1 text-2xl font-semibold text-[#26334d] dark:text-white">{openPcars.length}</p><button onClick={() => navigate('/pcars')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Open PCAR register</button></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Overdue PCARs</p><p className={`mt-1 text-2xl font-semibold ${overduePcars.length ? 'text-[#c73c44]' : 'text-[#319d68]'}`}>{overduePcars.length}</p><p className="mt-2 text-xs text-[#64748b]">Requires closure evidence before audit.</p></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Active-cycle evidence</p><p className="mt-1 text-2xl font-semibold text-[#26334d] dark:text-white">{activeEvidence.length}</p><button onClick={() => navigate('/documents')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Open controlled documents</button></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Processes without evidence</p><p className={`mt-1 text-2xl font-semibold ${missingCoverage.length ? 'text-[#c27a12]' : 'text-[#319d68]'}`}>{missingCoverage.length}</p><button onClick={() => navigate('/evidence-coverage')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Review coverage rules</button></div>
          </div>
        </CardBody>
      </Card>

      {overduePcars.length > 0 && <div className="flex items-start gap-3 border border-[#f0c9cc] bg-[#fff6f6] px-4 py-3 text-sm text-[#9f3038] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{overduePcars.length} overdue PCAR{overduePcars.length === 1 ? '' : 's'} may affect surveillance readiness. Review the corrective-action evidence and effectiveness decision.</div>}

      <Card>
        <CardBody className="p-0">
          <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><h2 className="section-heading">Clause &amp; evidence matrix</h2><p className="mt-1 text-sm text-[#64748b] dark:text-slate-400">Evidence is collected only from {standard === 'ISO 9001:2015' ? 'Corporate/QMS/Procedures/**/Evidences (excluding IT/ISO 27001)' : 'Corporate/QMS/Procedures/IT/ISO 27001/Evidences'}. OLD DMS content is excluded. A blank evidence state is a recorded gap, not an assumed pass.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead className="bg-[#f8fafc] text-left dark:bg-slate-950/40"><tr className="text-xs font-semibold uppercase tracking-wide text-[#718198]"><th className="px-5 py-3">Clause</th><th className="px-5 py-3">Area</th><th className="px-5 py-3">Open findings</th><th className="px-5 py-3">Evidence status</th><th className="px-5 py-3">Action</th></tr></thead><tbody>{clauses.map(([clause, title]) => { const findings = openPcars.filter((task) => task.standardClause?.trim().startsWith(clause)); const hasCandidate = activeEvidence.length > 0; return <tr key={clause} className="border-t border-[#e8eef5] dark:border-white/10"><td className="px-5 py-4 font-semibold text-[#174f91] dark:text-blue-200">{clause}</td><td className="px-5 py-4 text-sm font-medium text-[#26334d] dark:text-white">{title}</td><td className={`px-5 py-4 text-sm ${findings.length ? 'font-semibold text-[#c73c44]' : 'text-[#52627a] dark:text-slate-300'}`}>{findings.length ? `${findings.length} open PCAR${findings.length > 1 ? 's' : ''}` : 'None recorded'}</td><td className="px-5 py-4 text-sm text-[#52627a] dark:text-slate-300">{hasCandidate ? 'Active-cycle evidence available — confirm applicability' : 'No active-cycle evidence mapped'}</td><td className="px-5 py-4"><button onClick={() => navigate(findings.length ? `/pcars?clause=${encodeURIComponent(clause)}` : '/documents')} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1763a5] hover:underline">{findings.length ? 'Review PCARs' : 'Review evidence'} <ArrowRight className="h-3.5 w-3.5" /></button></td></tr>; })}</tbody></table></div>
        </CardBody>
      </Card>

      <Card className="print:break-before-page">
        <CardBody className="p-0">
          <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-[#3f8bca]" /><h2 className="section-heading">Management Review pack</h2></div><p className="mt-1 text-sm text-[#64748b] dark:text-slate-400">Generated from records currently available to your account. Unconfigured sources are deliberately shown as gaps.</p></div>
          <div className="grid gap-px bg-[#dbe2ec] md:grid-cols-2 dark:bg-white/10">
            <PackSection title="Audit & CAPA performance" detail={`${pcars.length} PCAR findings · ${openPcars.length} open · ${overduePcars.length} overdue`} ready={pcars.length > 0} />
            <PackSection title="Controlled documented information" detail={`${activeEvidence.length} active-cycle evidence files visible`} ready={activeEvidence.length > 0} />
            <PackSection title="Quality objectives & KPI performance" detail={`${reviewCount('kpi')} structured KPI input${reviewCount('kpi') === 1 ? '' : 's'} recorded`} ready={reviewCount('kpi') > 0} />
            <PackSection title="Risks & opportunities" detail={`${reviewCount('risk')} structured risk input${reviewCount('risk') === 1 ? '' : 's'} recorded`} ready={reviewCount('risk') > 0} />
            <PackSection title="Customer feedback & satisfaction" detail={`${reviewCount('customer_feedback')} feedback input${reviewCount('customer_feedback') === 1 ? '' : 's'} recorded`} ready={reviewCount('customer_feedback') > 0} />
            <PackSection title="Supplier performance" detail={`${reviewCount('supplier_performance')} supplier-performance input${reviewCount('supplier_performance') === 1 ? '' : 's'} recorded`} ready={reviewCount('supplier_performance') > 0} />
            <PackSection title="Actions from previous review" detail={`${reviewCount('action')} review action${reviewCount('action') === 1 ? '' : 's'} recorded · ${openPcars.length} open PCAR${openPcars.length === 1 ? '' : 's'}`} ready={reviewCount('action') > 0 && openPcars.length === 0} />
            <PackSection title="Surveillance readiness" detail="Preparation → Internal Audit → Management Review → External Surveillance Audit" ready={overduePcars.length === 0} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function PackSection({ title, detail, ready }: { title: string; detail: string; ready: boolean }) {
  return <div className="bg-white px-5 py-4 dark:bg-slate-900"><div className="flex items-center gap-2"><FileCheck2 className={`h-4 w-4 ${ready ? 'text-[#319d68]' : 'text-[#c27a12]'}`} /><h3 className="text-sm font-semibold text-[#26334d] dark:text-white">{title}</h3></div><p className="mt-2 text-sm leading-5 text-[#64748b] dark:text-slate-400">{detail}</p></div>;
}
