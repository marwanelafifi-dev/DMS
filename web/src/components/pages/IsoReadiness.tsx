import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, FileCheck2, Printer, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { apiClient } from '../../utils/api';
import type { Document, Task } from '../../types';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';

const isClosed = (task: Task) => task.status === 'done' || task.status === 'completed';
const isIsoEvidenceCandidate = (document: Document) => document.category === 'Evidence' || document.tags?.some((tag) => tag.toLowerCase() === 'evidence');
const isOverdue = (task: Task) => {
  if (!task.dueDate) return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
};
const formatDueDate = (dueDate: string) => new Date(dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function loadVisibleTasks(): Promise<Task[]> {
  const firstPage = await apiClient.getTasks({ page: 1, pageSize: 200 });
  const pages = Math.max(1, Number(firstPage.totalPages) || 1);
  const remaining = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => apiClient.getTasks({ page: index + 2, pageSize: 200 })));
  return [firstPage, ...remaining].flatMap((page) => Array.isArray(page.data) ? page.data as Task[] : []);
}

export function IsoReadiness({ standard = 'ISO 9001:2015' }: { standard?: 'ISO 9001:2015' | 'ISO 27001:2022' }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [coverageItems, setCoverageItems] = useState<any[]>([]);
  const [reviewEntries, setReviewEntries] = useState<any[]>([]);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [cycleLoadError, setCycleLoadError] = useState(false);
  const [tasksLoadError, setTasksLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadVisibleTasks(), apiClient.getIsoEvidence({ standard }), apiClient.getAuditCycles()])
      .then(async ([taskResult, documentResult, cycleResult]) => {
        if (cancelled) return;
        setTasks(taskResult.status === 'fulfilled' ? taskResult.value : []);
        setTasksLoadError(taskResult.status === 'rejected');
        setCycleLoadError(cycleResult.status === 'rejected');
        setDocuments(documentResult.status === 'fulfilled' && Array.isArray(documentResult.value.data) ? documentResult.value.data as Document[] : []);
        const activeCycle = cycleResult.status === 'fulfilled' ? (cycleResult.value.data ?? []).find((cycle: any) => cycle.standard === standard && cycle.status === 'active') : null;
        setActiveCycleId(activeCycle?.auditCycleId ?? null);
        if (activeCycle) {
          const [coverageResult, reviewResult] = await Promise.all([apiClient.getEvidenceRequirements(activeCycle.auditCycleId).catch(() => ({ data: [] })), apiClient.getManagementReviewEntries({ auditCycleId: activeCycle.auditCycleId }).catch(() => ({ data: [] }))]);
          if (!cancelled) { setCoverageItems(coverageResult.data ?? []); setReviewEntries(reviewResult.data ?? []); }
        } else { setCoverageItems([]); setReviewEntries([]); }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [standard]);

  const pcars = useMemo(() => tasks.filter((task) => task.taskType === 'pcar' && task.auditStandard === standard && task.auditCycleId === activeCycleId), [tasks, standard, activeCycleId]);
  const openPcars = pcars.filter((task) => !isClosed(task));
  const overduePcars = openPcars.filter(isOverdue);
  const openTasks = tasks.filter((task) => task.taskType !== 'pcar' && !isClosed(task));
  const overdueTasks = openTasks.filter(isOverdue);
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
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Open cycle PCARs</p><p className="mt-1 text-2xl font-semibold text-[#26334d] dark:text-white">{tasksLoadError || !activeCycleId ? '—' : openPcars.length}</p><button onClick={() => navigate('/pcars')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Open PCAR register</button></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Unfinished DMS tasks</p><p className={`mt-1 text-2xl font-semibold ${overdueTasks.length ? 'text-[#c73c44]' : 'text-[#26334d] dark:text-white'}`}>{tasksLoadError ? '—' : openTasks.length}</p><button onClick={() => navigate('/tasks')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Open task list</button></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Active-cycle evidence</p><p className="mt-1 text-2xl font-semibold text-[#26334d] dark:text-white">{activeEvidence.length}</p><button onClick={() => navigate('/documents')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Open controlled documents</button></div>
            <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">Processes without evidence</p><p className={`mt-1 text-2xl font-semibold ${missingCoverage.length ? 'text-[#c27a12]' : 'text-[#319d68]'}`}>{missingCoverage.length}</p><button onClick={() => navigate('/evidence-coverage')} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">Review coverage rules</button></div>
          </div>
        </CardBody>
      </Card>

      {overduePcars.length > 0 && <div className="flex items-start gap-3 border border-[#f0c9cc] bg-[#fff6f6] px-4 py-3 text-sm text-[#9f3038] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{overduePcars.length} overdue PCAR{overduePcars.length === 1 ? '' : 's'} may affect surveillance readiness. Review the corrective-action evidence and effectiveness decision.</div>}

      <Card>
        <CardBody className="p-0">
          <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10">
            <h2 className="section-heading">Outstanding work</h2>
            <p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Visible unfinished DMS tasks and PCAR findings for the active {standard} cycle.</p>
          </div>
          {tasksLoadError ? (
            <p role="alert" className="px-5 py-5 text-sm text-[#9f3038] dark:text-red-200">Tasks and PCARs could not be loaded. Refresh this page to try again.</p>
          ) : (
            <div className="grid divide-y divide-[#dbe2ec] lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-white/10">
              <WorkList title="Unfinished tasks" items={openTasks} overdueCount={overdueTasks.length} route="/tasks" emptyText="No unfinished tasks visible to you." onNavigate={navigate} />
              {cycleLoadError ? (
                <p role="alert" className="px-5 py-5 text-sm text-[#9f3038] dark:text-red-200">The active audit cycle could not be loaded. Refresh this page to see its PCARs.</p>
              ) : (
                <WorkList title="Open cycle PCARs" items={openPcars} overdueCount={overduePcars.length} route="/pcars" emptyText={activeCycleId ? 'No open PCARs linked to the active cycle.' : 'No active audit cycle is selected.'} onNavigate={navigate} />
              )}
            </div>
          )}
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

function WorkList({ title, items, overdueCount, route, emptyText, onNavigate }: {
  title: string;
  items: Task[];
  overdueCount: number;
  route: '/tasks' | '/pcars';
  emptyText: string;
  onNavigate: NavigateFunction;
}) {
  const nextItems = [...items].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5);

  return (
    <section className="min-w-0 px-5 py-5" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[#26334d] dark:text-white">{title} <span className="ml-1 text-sm font-medium text-[#52627a] dark:text-slate-300">{items.length}</span></h3>
        {overdueCount > 0 && <span className="text-xs font-semibold text-[#a12e37] dark:text-red-200">{overdueCount} overdue</span>}
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[#52627a] dark:text-slate-300">{emptyText}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#e8eef5] dark:divide-white/10">
          {nextItems.map((item) => (
            <li key={item.taskId}>
              <button
                type="button"
                onClick={() => onNavigate(`${route}?highlight=${encodeURIComponent(item.taskId)}`)}
                className="group flex w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#26334d] group-hover:text-[#1763a5] dark:text-white">{item.title}</span>
                  <span className="mt-1 block text-xs text-[#52627a] dark:text-slate-300">{item.status.replace('_', ' ')} · Due {item.dueDate ? formatDueDate(item.dueDate) : 'date not set'}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[#1763a5]" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => onNavigate(route)} className="mt-4 text-sm font-semibold text-[#1763a5] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]">View all {route === '/pcars' ? 'PCARs' : 'tasks'}</button>
    </section>
  );
}

function PackSection({ title, detail, ready }: { title: string; detail: string; ready: boolean }) {
  return <div className="bg-white px-5 py-4 dark:bg-slate-900"><div className="flex items-center gap-2"><FileCheck2 className={`h-4 w-4 ${ready ? 'text-[#319d68]' : 'text-[#c27a12]'}`} /><h3 className="text-sm font-semibold text-[#26334d] dark:text-white">{title}</h3></div><p className="mt-2 text-sm leading-5 text-[#64748b] dark:text-slate-400">{detail}</p></div>;
}
