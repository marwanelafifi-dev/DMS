import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { apiClient } from '../../utils/api';
import type { Task, User } from '../../types';
import type { ReadinessContact, ReadinessCoveredFolder, ReadinessEvidence, ReadinessRequirement } from '../../utils/isoDepartmentReadiness';
import { Card, CardBody } from '../ui/Card';
import { SkeletonCard } from '../ui/Skeleton';
import { DepartmentReadinessPanel } from './DepartmentReadinessPanel';

const isClosed = (task: Task) => task.status === 'done' || task.status === 'completed';
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
  const [users, setUsers] = useState<User[]>([]);
  const [documents, setDocuments] = useState<ReadinessEvidence[]>([]);
  const [coverageItems, setCoverageItems] = useState<ReadinessRequirement[]>([]);
  const [readinessContacts, setReadinessContacts] = useState<ReadinessContact[]>([]);
  const [coveredFolders, setCoveredFolders] = useState<ReadinessCoveredFolder[]>([]);
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);
  const [cycleLoadError, setCycleLoadError] = useState(false);
  const [tasksLoadError, setTasksLoadError] = useState(false);
  const [usersLoadError, setUsersLoadError] = useState(false);
  const [evidenceLoadError, setEvidenceLoadError] = useState(false);
  const [coverageLoadError, setCoverageLoadError] = useState(false);
  const [contactsLoadError, setContactsLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.allSettled([loadVisibleTasks(), apiClient.getAuditCycles(), apiClient.getUsers({ activeOnly: false })])
      .then(async ([taskResult, cycleResult, userResult]) => {
        if (cancelled) return;
        setTasks(taskResult.status === 'fulfilled' ? taskResult.value : []);
        setTasksLoadError(taskResult.status === 'rejected');
        const cycles = cycleResult.status === 'fulfilled' && Array.isArray(cycleResult.value.data) ? cycleResult.value.data : null;
        setCycleLoadError(cycles === null);
        setUsers(userResult.status === 'fulfilled' && Array.isArray(userResult.value.data) ? userResult.value.data as User[] : []);
        setUsersLoadError(userResult.status === 'rejected' || !Array.isArray(userResult.value.data));
        const activeCycle = cycles?.find((cycle: any) => cycle.standard === standard && cycle.status === 'active');
        setActiveCycleId(activeCycle?.auditCycleId ?? null);
        const [documentResult, coverageResult, contactResult, setupResult] = await Promise.allSettled([
          apiClient.getIsoEvidence({ standard, auditCycleId: activeCycle?.auditCycleId }),
          activeCycle ? apiClient.getEvidenceRequirements(activeCycle.auditCycleId) : Promise.resolve({ data: [] }),
          activeCycle ? apiClient.getIsoReadinessContacts(activeCycle.auditCycleId) : Promise.resolve({ data: [] }),
          activeCycle ? apiClient.getAuditCycleSetup(activeCycle.auditCycleId) : Promise.resolve({ data: { folders: [] } }),
        ]);
        if (cancelled) return;
        setDocuments(documentResult.status === 'fulfilled' && Array.isArray(documentResult.value.data) ? documentResult.value.data as ReadinessEvidence[] : []);
        setEvidenceLoadError(documentResult.status === 'rejected' || !Array.isArray(documentResult.value.data));
        setCoverageItems(coverageResult.status === 'fulfilled' && Array.isArray(coverageResult.value.data) ? coverageResult.value.data as ReadinessRequirement[] : []);
        setCoverageLoadError(coverageResult.status === 'rejected' || !Array.isArray(coverageResult.value.data));
        setReadinessContacts(contactResult.status === 'fulfilled' && Array.isArray(contactResult.value.data) ? contactResult.value.data as ReadinessContact[] : []);
        setCoveredFolders(setupResult.status === 'fulfilled' && Array.isArray(setupResult.value.data?.folders) ? setupResult.value.data.folders as ReadinessCoveredFolder[] : []);
        setContactsLoadError(contactResult.status === 'rejected' || !Array.isArray(contactResult.value.data) || setupResult.status === 'rejected' || !Array.isArray(setupResult.value.data?.folders));
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [standard]);

  const pcars = useMemo(() => tasks.filter((task) => task.taskType === 'pcar' && task.auditStandard === standard && task.auditCycleId === activeCycleId), [tasks, standard, activeCycleId]);
  const openPcars = pcars.filter((task) => !isClosed(task));
  const overduePcars = openPcars.filter(isOverdue);
  const openTasks = tasks.filter((task) => task.taskType !== 'pcar' && !isClosed(task));
  const overdueTasks = openTasks.filter(isOverdue);
  const activeEvidence = documents.filter((document) => document.isAssignedToSelectedCycle === true);
  const missingCoverage = coverageItems.filter(item => !item.hasEvidence);

  if (isLoading) return <div className="space-y-5"><SkeletonCard /><SkeletonCard /></div>;

  return <div className="space-y-6">
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-[#174f91] dark:text-blue-200"><ShieldCheck className="h-5 w-5" /><h1 className="page-heading">{standard} Readiness</h1></div>
      <p className="page-subtitle mt-2">{standard === 'ISO 9001:2015' ? 'Company-wide surveillance-cycle evidence, audit findings, and readiness work. Certificate No. 00.12.1041 is valid through 05 February 2029.' : 'IT-only ISMS evidence, audit findings, and readiness work for the active calendar-year programme.'}</p>
    </div>

    <Card><CardBody className="p-0"><div className="grid divide-y divide-[#dbe2ec] sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-white/10">
      <Metric label="Open cycle PCARs" value={tasksLoadError || !activeCycleId ? '-' : openPcars.length} action="Open PCAR register" onClick={() => navigate('/pcars')} />
      <Metric label="Unfinished DMS tasks" value={tasksLoadError ? '-' : openTasks.length} action="Open task list" onClick={() => navigate('/tasks')} danger={overdueTasks.length > 0} />
      <Metric label="Active-cycle evidence" value={evidenceLoadError || !activeCycleId ? '-' : activeEvidence.length} action="Open controlled documents" onClick={() => navigate('/documents')} />
      <Metric label="Processes without evidence" value={coverageLoadError || !activeCycleId || coverageItems.length === 0 ? '-' : missingCoverage.length} action="Open evidence library" onClick={() => navigate('/documents')} warning={missingCoverage.length > 0} />
    </div></CardBody></Card>

    {overduePcars.length > 0 && <div className="flex items-start gap-3 border border-[#f0c9cc] bg-[#fff6f6] px-4 py-3 text-sm text-[#9f3038] dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{overduePcars.length} overdue PCAR{overduePcars.length === 1 ? '' : 's'} may affect surveillance readiness. Review the corrective-action evidence and effectiveness decision.</div>}

    <Card><CardBody className="p-0"><div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><h2 className="section-heading">Outstanding work</h2><p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Visible unfinished DMS tasks and PCAR findings for the active {standard} cycle.</p></div>
      {tasksLoadError ? <p role="alert" className="px-5 py-5 text-sm text-[#9f3038] dark:text-red-200">Tasks and PCARs could not be loaded. Refresh this page to try again.</p> : <div className="grid divide-y divide-[#dbe2ec] lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-white/10"><WorkList title="Unfinished tasks" items={openTasks} overdueCount={overdueTasks.length} route="/tasks" emptyText="No unfinished tasks visible to you." onNavigate={navigate} />{cycleLoadError ? <p role="alert" className="px-5 py-5 text-sm text-[#9f3038] dark:text-red-200">The active audit cycle could not be loaded. Refresh this page to see its PCARs.</p> : <WorkList title="Open cycle PCARs" items={openPcars} overdueCount={overduePcars.length} route="/pcars" emptyText={activeCycleId ? 'No open PCARs linked to the active cycle.' : 'No active audit cycle is selected.'} onNavigate={navigate} />}</div>}
    </CardBody></Card>

    <DepartmentReadinessPanel users={users} tasks={tasks} evidence={documents} requirements={coverageItems} contacts={readinessContacts} coveredFolders={coveredFolders} standard={standard} activeCycleId={activeCycleId} loadError={cycleLoadError || tasksLoadError || usersLoadError || evidenceLoadError || coverageLoadError || contactsLoadError} />
  </div>;
}

function Metric({ label, value, action, onClick, danger = false, warning = false }: { label: string; value: number | string; action: string; onClick: () => void; danger?: boolean; warning?: boolean }) {
  const valueClass = danger ? 'text-[#c73c44]' : warning ? 'text-[#c27a12]' : 'text-[#26334d] dark:text-white';
  return <div className="px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#718198]">{label}</p><p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p><button onClick={onClick} className="mt-2 text-xs font-medium text-[#1763a5] hover:underline">{action}</button></div>;
}

function WorkList({ title, items, overdueCount, route, emptyText, onNavigate }: { title: string; items: Task[]; overdueCount: number; route: '/tasks' | '/pcars'; emptyText: string; onNavigate: NavigateFunction }) {
  const nextItems = [...items].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5);
  return <section className="min-w-0 px-5 py-5" aria-label={title}><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold text-[#26334d] dark:text-white">{title} <span className="ml-1 text-sm font-medium text-[#52627a] dark:text-slate-300">{items.length}</span></h3>{overdueCount > 0 && <span className="text-xs font-semibold text-[#a12e37] dark:text-red-200">{overdueCount} overdue</span>}</div>{items.length === 0 ? <p className="mt-4 text-sm text-[#52627a] dark:text-slate-300">{emptyText}</p> : <ul className="mt-3 divide-y divide-[#e8eef5] dark:divide-white/10">{nextItems.map((item) => <li key={item.taskId}><button type="button" onClick={() => onNavigate(`${route}?highlight=${encodeURIComponent(item.taskId)}`)} className="group flex w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]"><span className="min-w-0"><span className="block truncate text-sm font-medium text-[#26334d] group-hover:text-[#1763a5] dark:text-white">{item.title}</span><span className="mt-1 block text-xs text-[#52627a] dark:text-slate-300">{item.status.replace('_', ' ')} - Due {item.dueDate ? formatDueDate(item.dueDate) : 'date not set'}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[#1763a5]" aria-hidden="true" /></button></li>)}</ul>}<button type="button" onClick={() => onNavigate(route)} className="mt-4 text-sm font-semibold text-[#1763a5] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]">View all {route === '/pcars' ? 'PCARs' : 'tasks'}</button></section>;
}
