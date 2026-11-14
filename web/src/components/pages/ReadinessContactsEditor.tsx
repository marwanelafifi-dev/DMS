import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import type { ReadinessContact, ReadinessRequirement } from '../../utils/isoDepartmentReadiness';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { usePageAccess } from '../../hooks/usePageAccess';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';

type Department = { id: string; name: string; requirements: ReadinessRequirement[] };

export function ReadinessContactsEditor({ cycleId, requirements, historical }: { cycleId: string; requirements: ReadinessRequirement[]; historical: boolean }) {
  const { showError, showSuccess } = useToast();
  const access = usePageAccess();
  const canEdit = !historical && access?.canCreatePcars === true;
  const [users, setUsers] = useState<User[]>([]);
  const [contacts, setContacts] = useState<ReadinessContact[]>([]);
  const [globalRoles, setGlobalRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const departments = useMemo(() => {
    const byId = new Map<string, Department>();
    for (const item of requirements) {
      if (!item.departmentFolderId || !item.departmentFolderName) continue;
      const department = byId.get(item.departmentFolderId) ?? { id: item.departmentFolderId, name: item.departmentFolderName, requirements: [] };
      department.requirements.push(item);
      byId.set(department.id, department);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [requirements]);

  useEffect(() => {
    if (!cycleId) { setLoading(false); setContacts([]); return; }
    let cancelled = false;
    setLoading(true); setFailed(false);
    Promise.all([apiClient.getUsers({ activeOnly: false }), apiClient.getIsoReadinessContacts(cycleId)])
      .then(([userResult, contactResult]) => {
        if (cancelled) return;
        if (!Array.isArray(userResult.data) || !Array.isArray(contactResult.data) || !Array.isArray(contactResult.globalAccessRoles))
          throw new Error('Incomplete readiness contact response');
        setUsers(userResult.data as User[]);
        setContacts(contactResult.data);
        setGlobalRoles(contactResult.globalAccessRoles);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cycleId]);

  const save = async (departmentId: string, userIds: string[]) => {
    try {
      await apiClient.setIsoReadinessContacts(departmentId, { auditCycleId: cycleId, userIds });
      setContacts(current => [...current.filter(item => item.departmentFolderId !== departmentId), ...userIds.map(userId => ({ departmentFolderId: departmentId, userId }))]);
      showSuccess('Readiness contacts saved for this audit cycle.');
    } catch (error: any) {
      showError(error.response?.data?.error || 'Could not save readiness contacts.');
    }
  };

  return <Card><CardBody className="p-0">
    <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10">
      <h2 className="section-heading">Department readiness contacts</h2>
      <p className="mt-1 text-sm leading-6 text-[#52627a] dark:text-slate-300">Local folder owners, managers, and process document owners appear automatically. People with global folder access appear only when assigned here. These contacts belong to this audit cycle and do not change folder permissions.{historical && ' Historical cycle contacts are read-only.'}</p>
    </div>
    {loading ? <p className="px-5 py-5 text-sm text-[#52627a] dark:text-slate-300">Loading readiness contacts…</p>
      : failed ? <p role="alert" className="px-5 py-5 text-sm text-[#9f3038] dark:text-red-200">Could not load readiness contacts. Refresh this page to try again.</p>
      : departments.length ? <div className="divide-y divide-[#e8eef5] dark:divide-white/10">{departments.map(department => <ContactRow key={`${cycleId}:${department.id}`} department={department} users={users} globalRoles={globalRoles} assignedUserIds={contacts.filter(item => item.departmentFolderId === department.id).map(item => item.userId)} canEdit={canEdit} onSave={save} />)}</div>
      : <p className="px-5 py-5 text-sm text-[#52627a] dark:text-slate-300">Add process folders to Evidence Coverage before assigning readiness contacts.</p>}
  </CardBody></Card>;
}

function ContactRow({ department, users, globalRoles, assignedUserIds, canEdit, onSave }: {
  department: Department;
  users: User[];
  globalRoles: string[];
  assignedUserIds: string[];
  canEdit: boolean;
  onSave: (departmentId: string, userIds: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(assignedUserIds);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(assignedUserIds), [assignedUserIds.join('|')]);
  const userById = new Map(users.map(user => [user.userId, user]));
  const roleSet = new Set(globalRoles.map(role => role.toLowerCase()));
  const automaticIds = new Set(department.requirements.flatMap(item => [item.documentOwnerId, ...(item.folderOwnerUserIds ?? []), ...(item.folderManagerUserIds ?? [])]).filter((id): id is string => !!id));
  const automatic = [...automaticIds].map(id => userById.get(id)).filter((user): user is User => !!user && !roleSet.has((user.role ?? '').toLowerCase()));
  const matches = query.trim() ? users.filter(user => user.isActive && !draft.includes(user.userId) && `${user.fullName} ${user.email} ${user.department ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : [];
  const changed = draft.length !== assignedUserIds.length || draft.some(id => !assignedUserIds.includes(id));

  return <section className="px-5 py-5" aria-label={`${department.name} readiness contacts`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-[#26334d] dark:text-white">{department.name}</h3><span className="text-xs text-[#52627a] dark:text-slate-300">{department.requirements.length} covered process document{department.requirements.length === 1 ? '' : 's'}</span></div>
    <p className="mt-1 text-xs leading-5 text-[#52627a] dark:text-slate-300">Automatically shown: {automatic.length ? automatic.map(user => user.fullName).sort().join(', ') : 'No local owner, manager, or document owner found.'}</p>
    <div className="mt-3 flex flex-wrap gap-2">{draft.length ? draft.map(id => { const user = userById.get(id); return <span key={id} className="inline-flex items-center gap-2 rounded border border-[#c9d9ea] bg-[#eff5fb] px-2 py-1 text-sm text-[#26334d] dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-white">{user?.fullName ?? 'Unknown user'}{canEdit && <button type="button" onClick={() => setDraft(current => current.filter(value => value !== id))} aria-label={`Remove ${user?.fullName ?? 'user'} from ${department.name}`} className="rounded p-0.5 hover:bg-[#dbe8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1763a5]"><X className="h-3.5 w-3.5" /></button>}</span>; }) : <span className="text-sm text-[#52627a] dark:text-slate-300">No additional contacts assigned.</span>}</div>
    {canEdit && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start"><div className="relative w-full max-w-md"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#52627a]" aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user name, email, or department" aria-label={`Search users for ${department.name}`} className="field-control h-10 w-full pl-10 pr-3" />{query.trim() && <div className="mt-1 max-h-48 overflow-y-auto rounded border border-[#dbe2ec] bg-white p-1 dark:border-white/10 dark:bg-slate-900">{matches.length ? matches.map(user => <button key={user.userId} type="button" onClick={() => { setDraft(current => [...current, user.userId]); setQuery(''); }} className="block w-full rounded px-2 py-2 text-left text-sm text-[#26334d] hover:bg-[#eff5fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1763a5] dark:text-white dark:hover:bg-slate-800">{user.fullName}<span className="ml-2 text-xs text-[#52627a] dark:text-slate-300">{user.email}</span></button>) : <p className="px-2 py-3 text-sm text-[#52627a] dark:text-slate-300">No active users match.</p>}</div>}</div><Button onClick={() => { setSaving(true); void onSave(department.id, draft).finally(() => setSaving(false)); }} disabled={!changed || saving}>{saving ? 'Saving…' : 'Save contacts'}</Button></div>}
  </section>;
}
