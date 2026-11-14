import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Task, User } from '../../types';
import {
  buildDepartmentReadiness,
  type DepartmentReadiness,
  type PersonReadiness,
  type ReadinessEvidence,
  type ReadinessRequirement,
} from '../../utils/isoDepartmentReadiness';
import { Card, CardBody } from '../ui/Card';

type Standard = 'ISO 9001:2015' | 'ISO 27001:2022';

export function DepartmentReadinessPanel({ users, tasks, evidence, requirements, standard, activeCycleId, loadError }: {
  users: User[];
  tasks: Task[];
  evidence: ReadinessEvidence[];
  requirements: ReadinessRequirement[];
  standard: Standard;
  activeCycleId: string | null;
  loadError: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const rollup = useMemo(() => buildDepartmentReadiness(users, tasks, evidence, requirements, standard, activeCycleId), [users, tasks, evidence, requirements, standard, activeCycleId]);
  const usersWithoutDepartment = users.filter(user => !user.department?.trim()).length;
  const term = query.trim().toLocaleLowerCase();
  const departments = rollup.departments.filter(department => !term || department.name.toLocaleLowerCase().includes(term) || department.people.some(person =>
    person.user.fullName.toLocaleLowerCase().includes(term) || person.user.email.toLocaleLowerCase().includes(term),
  ));

  return (
    <Card>
      <CardBody className="p-0">
        <div className="flex flex-col gap-4 border-b border-[#dbe2ec] px-5 py-5 lg:flex-row lg:items-end lg:justify-between dark:border-white/10">
          <div className="max-w-3xl">
            <h2 className="section-heading">Department readiness</h2>
            <p className="mt-1 text-sm leading-6 text-[#52627a] dark:text-slate-300">Departments come from user profiles. Tasks are visible DMS work; PCARs and evidence belong to the active {standard} cycle.</p>
          </div>
          <label className="relative block w-full shrink-0 lg:w-72">
            <span className="sr-only">Search departments or users</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#52627a]" aria-hidden="true" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search department or user" className="field-control h-10 w-full pl-10 pr-3" />
          </label>
        </div>
        {loadError ? (
          <p role="alert" className="px-5 py-6 text-sm text-[#9f3038] dark:text-red-200">Department readiness could not be loaded completely. Refresh this page to try again.</p>
        ) : !activeCycleId ? (
          <p className="px-5 py-6 text-sm text-[#52627a] dark:text-slate-300">Activate a {standard} audit cycle to see department evidence and PCAR status.</p>
        ) : (
          <>
            <p className="border-b border-[#e8eef5] px-5 py-3 text-xs leading-5 text-[#52627a] dark:border-white/10 dark:text-slate-300">
              A missing evidence item is a required process document owned by that user with no linked evidence for this cycle. An upload count of zero alone is not a missing item. Shared or unassigned work is listed separately below.
            </p>
            {usersWithoutDepartment > 0 && <p className="border-b border-[#e8eef5] bg-[#fffaf0] px-5 py-3 text-sm text-[#8a5411] dark:border-white/10 dark:bg-amber-500/10 dark:text-amber-200">{usersWithoutDepartment} user{usersWithoutDepartment === 1 ? '' : 's'} have no Department in their profile. Assign or sync their department in Admin → Users to group their work correctly.</p>}
            {departments.length ? (
              <div className="divide-y divide-[#dbe2ec] dark:divide-white/10">
                {departments.map((department, index) => <DepartmentGroup key={department.name.toLocaleLowerCase()} department={department} defaultOpen={index === 0 && !term} onNavigate={navigate} />)}
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-[#52627a] dark:text-slate-300">{term ? 'No department or user matches your search.' : 'No users are available for department readiness.'}</p>
            )}
            {(rollup.unassignedTasks.length > 0 || rollup.unassignedPcars.length > 0 || rollup.unassignedRequirements.length > 0 || rollup.unattributedEvidenceCount > 0) && (
              <div className="border-t border-[#dbe2ec] bg-[#f8fafc] px-5 py-4 text-sm text-[#34425b] dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-200">
                <p className="font-semibold">Work without a matching user department</p>
                <p className="mt-1">{rollup.unassignedTasks.length} shared or unassigned task{rollup.unassignedTasks.length === 1 ? '' : 's'} · {rollup.unassignedPcars.length} PCAR{rollup.unassignedPcars.length === 1 ? '' : 's'} · {rollup.unassignedRequirements.length} missing evidence item{rollup.unassignedRequirements.length === 1 ? '' : 's'} · {rollup.unattributedEvidenceCount} cycle upload{rollup.unattributedEvidenceCount === 1 ? '' : 's'} without a matching uploader.</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {rollup.unassignedTasks.length > 0 && <button type="button" onClick={() => navigate('/tasks')} className="font-medium text-[#1763a5] underline-offset-4 hover:underline">Review tasks</button>}
                  {rollup.unassignedPcars.length > 0 && <button type="button" onClick={() => navigate('/pcars')} className="font-medium text-[#1763a5] underline-offset-4 hover:underline">Review PCARs</button>}
                  {rollup.unassignedRequirements.length > 0 && <button type="button" onClick={() => navigate('/evidence-coverage')} className="font-medium text-[#1763a5] underline-offset-4 hover:underline">Review evidence coverage</button>}
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function DepartmentGroup({ department, defaultOpen, onNavigate }: { department: DepartmentReadiness; defaultOpen: boolean; onNavigate: ReturnType<typeof useNavigate> }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const peopleWithActivity = department.people.filter(person => person.tasks.length || person.pcars.length || person.missingRequirements.length || person.uploadedEvidence.length);
  const otherMembers = department.people.length - peopleWithActivity.length;

  return (
    <details className="group" open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1763a5] dark:hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 font-semibold text-[#26334d] dark:text-white"><ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-[#1763a5] transition-transform group-open:rotate-0" aria-hidden="true" /><span className="truncate">{department.name}</span><span className="shrink-0 text-xs font-normal text-[#52627a] dark:text-slate-300">{department.people.length} users</span></span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-[#34425b] dark:text-slate-200">
          <span>{department.taskCount} tasks</span><span>{department.pcarCount} PCARs</span><span className={department.missingEvidenceCount ? 'text-[#a65f08] dark:text-amber-300' : ''}>{department.missingEvidenceCount} evidence gaps</span><span>{department.evidenceUploadCount} uploads</span>
        </span>
      </summary>
      <div className="border-t border-[#e8eef5] px-5 pb-5 dark:border-white/10">
        {department.requirementCount === 0 && <p className="py-3 text-xs text-[#8a5411] dark:text-amber-300">No evidence coverage rules are linked to process documents owned by users in this department.</p>}
        {peopleWithActivity.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-[#e8eef5] text-xs font-semibold uppercase tracking-wide text-[#52627a] dark:border-white/10 dark:text-slate-300"><th className="py-3 pr-3">User</th><th className="px-3 py-3">Open tasks</th><th className="px-3 py-3">Open PCARs</th><th className="px-3 py-3">Evidence gaps</th><th className="px-3 py-3">Cycle uploads</th></tr></thead>
              <tbody>
                {peopleWithActivity.map(person => (
                  <PersonRow key={person.user.userId} person={person} expanded={expandedUserId === person.user.userId} onToggle={() => setExpandedUserId(current => current === person.user.userId ? null : person.user.userId)} onNavigate={onNavigate} />
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="py-4 text-sm text-[#52627a] dark:text-slate-300">No open work or evidence uploads are recorded for users in this department.</p>}
        {otherMembers > 0 && <p className="pt-3 text-xs text-[#52627a] dark:text-slate-300">{otherMembers} other user{otherMembers === 1 ? '' : 's'} with no assigned open work or cycle uploads.</p>}
      </div>
    </details>
  );
}

function PersonRow({ person, expanded, onToggle, onNavigate }: { person: PersonReadiness; expanded: boolean; onToggle: () => void; onNavigate: ReturnType<typeof useNavigate> }) {
  const hasDetails = person.tasks.length > 0 || person.pcars.length > 0 || person.missingRequirements.length > 0;
  return (
    <>
      <tr className="border-b border-[#edf1f6] text-[#34425b] dark:border-white/10 dark:text-slate-200">
        <td className="py-3 pr-3"><span className="block font-medium text-[#26334d] dark:text-white">{person.user.fullName}{!person.user.isActive && <span className="ml-2 text-xs font-normal text-[#52627a] dark:text-slate-300">Inactive</span>}</span><span className="block text-xs text-[#52627a] dark:text-slate-300">{person.user.email}</span>{hasDetails && <button type="button" onClick={onToggle} aria-label={`${expanded ? 'Hide' : 'View'} work for ${person.user.fullName}`} aria-expanded={expanded} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#1763a5] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1763a5]">{expanded ? 'Hide work' : 'View work'} <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" /></button>}</td>
        <td className="px-3 py-3 tabular-nums">{person.tasks.length}</td>
        <td className="px-3 py-3 tabular-nums">{person.pcars.length}</td>
        <td className={`px-3 py-3 tabular-nums ${person.missingRequirements.length ? 'font-semibold text-[#a65f08] dark:text-amber-300' : ''}`}>{person.missingRequirements.length}</td>
        <td className="px-3 py-3 tabular-nums">{person.uploadedEvidence.length}</td>
      </tr>
      {expanded && <tr><td colSpan={5} className="bg-[#f8fafc] px-4 py-4 dark:bg-slate-950/30"><div className="grid gap-5 md:grid-cols-3">
        <WorkDetails title="Open tasks" tasks={person.tasks} route="/tasks" onNavigate={onNavigate} />
        <WorkDetails title="Open PCARs" tasks={person.pcars} route="/pcars" onNavigate={onNavigate} />
        <div><h4 className="text-xs font-semibold uppercase tracking-wide text-[#52627a] dark:text-slate-300">Process documents awaiting evidence</h4>{person.missingRequirements.length ? <ul className="mt-2 space-y-2">{person.missingRequirements.map(item => <li key={item.evidenceRequirementId} className="text-sm text-[#34425b] dark:text-slate-200">{item.documentTitle}</li>)}</ul> : <p className="mt-2 text-sm text-[#52627a] dark:text-slate-300">None</p>}{person.missingRequirements.length > 0 && <button type="button" onClick={() => onNavigate('/evidence-coverage')} className="mt-3 text-xs font-semibold text-[#1763a5] underline-offset-4 hover:underline">Open evidence coverage</button>}</div>
      </div></td></tr>}
    </>
  );
}

function WorkDetails({ title, tasks, route, onNavigate }: { title: string; tasks: Task[]; route: '/tasks' | '/pcars'; onNavigate: ReturnType<typeof useNavigate> }) {
  return <div><h4 className="text-xs font-semibold uppercase tracking-wide text-[#52627a] dark:text-slate-300">{title}</h4>{tasks.length ? <ul className="mt-2 space-y-2">{tasks.map(task => <li key={task.taskId}><button type="button" onClick={() => onNavigate(`${route}?highlight=${encodeURIComponent(task.taskId)}`)} className="inline-flex items-start gap-1 text-left text-sm font-medium text-[#1763a5] underline-offset-4 hover:underline"><span>{task.title}<span className="ml-1 text-xs font-normal text-[#52627a] dark:text-slate-300">({task.status.replace('_', ' ')})</span></span><ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /></button></li>)}</ul> : <p className="mt-2 text-sm text-[#52627a] dark:text-slate-300">None</p>}</div>;
}
