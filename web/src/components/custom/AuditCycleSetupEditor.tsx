import { FolderCheck, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { Button } from '../ui/Button';

export type CycleSetup = { folderIds: string[]; departments: { departmentFolderId: string; userIds: string[] }[] };
type UserOption = { userId: string; fullName: string; email: string };
type FolderOption = {
  folderId: string;
  path: string;
  departmentFolderId: string;
  departmentFolderName: string;
  controlledDocumentCount: number;
  eligibleUsers: UserOption[];
};

export function AuditCycleSetupEditor({ standard, cycleId, saveLabel, disabled, onSave }: {
  standard: string;
  cycleId?: string;
  saveLabel: string;
  disabled?: boolean;
  onSave: (setup: CycleSetup) => Promise<void>;
}) {
  const { showError } = useToast();
  const [options, setOptions] = useState<FolderOption[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [folderQuery, setFolderQuery] = useState('');
  const [userQueries, setUserQueries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setFailed(false);
    Promise.all([apiClient.getAuditCycleSetupOptions(standard), cycleId ? apiClient.getAuditCycleSetup(cycleId) : Promise.resolve({ data: { folderIds: [], contacts: [] } })])
      .then(([optionsResponse, setupResponse]) => {
        if (cancelled) return;
        if (!Array.isArray(optionsResponse.data) || !Array.isArray(setupResponse.data?.folderIds) || !Array.isArray(setupResponse.data?.contacts))
          throw new Error('Incomplete cycle setup response');
        setOptions(optionsResponse.data);
        setFolderIds(setupResponse.data.folderIds);
        const next: Record<string, string[]> = {};
        for (const contact of setupResponse.data.contacts) (next[contact.departmentFolderId] ??= []).push(contact.userId);
        setAssignments(next);
        setFolderQuery(''); setUserQueries({});
      })
      .catch(() => { if (!cancelled) { setFailed(true); showError('Could not load cycle setup. Refresh and try again.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [standard, cycleId]);

  const selected = useMemo(() => options.filter(option => folderIds.includes(option.folderId)), [options, folderIds]);
  const departments = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; folders: FolderOption[]; users: UserOption[] }>();
    for (const folder of selected) {
      const group = byId.get(folder.departmentFolderId) ?? { id: folder.departmentFolderId, name: folder.departmentFolderName, folders: [], users: [] };
      group.folders.push(folder);
      for (const user of folder.eligibleUsers) if (!group.users.some(item => item.userId === user.userId)) group.users.push(user);
      byId.set(group.id, group);
    }
    return [...byId.values()].map(group => ({ ...group, users: group.users.sort((a, b) => a.fullName.localeCompare(b.fullName)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selected]);
  const matchingFolders = options.filter(option => option.path.toLowerCase().includes(folderQuery.trim().toLowerCase()));
  const unavailableCount = folderIds.filter(id => !options.some(option => option.folderId === id)).length;
  const ineligibleContactCount = Object.entries(assignments).reduce((count, [departmentId, ids]) => {
    const department = departments.find(item => item.id === departmentId);
    return count + ids.filter(id => !department?.users.some(user => user.userId === id)).length;
  }, 0);
  const ready = selected.length > 0 && unavailableCount === 0 && departments.every(department =>
    (assignments[department.id] ?? []).some(id => department.users.some(user => user.userId === id)));

  const toggleFolder = (id: string) => setFolderIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const toggleUser = (departmentId: string, userId: string) => setAssignments(current => {
    const chosen = current[departmentId] ?? [];
    return { ...current, [departmentId]: chosen.includes(userId) ? chosen.filter(id => id !== userId) : [...chosen, userId] };
  });
  const submit = async () => {
    if (!ready) return showError('Select process folders and at least one person with folder access for each department.');
    const setup: CycleSetup = { folderIds: selected.map(folder => folder.folderId), departments: departments.map(department => ({
      departmentFolderId: department.id,
      userIds: (assignments[department.id] ?? []).filter(id => department.users.some(user => user.userId === id)),
    })) };
    setSaving(true);
    try { await onSave(setup); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="py-5 text-sm text-[#52627a] dark:text-slate-300">Loading eligible process folders and owners…</p>;
  if (failed) return <p role="alert" className="py-5 text-sm text-[#9f3038] dark:text-red-200">Cycle setup could not be loaded. Refresh this page to try again.</p>;
  return <div className="space-y-5">
    <section aria-label="Covered process folders">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-[#26334d] dark:text-white">Process folders</h3><span className="text-xs font-medium text-[#1763a5]">{selected.length} selected</span></div>
      <p className="mt-1 text-xs leading-5 text-[#52627a] dark:text-slate-300">Select folders under Corporate / QMS / Procedures. Controlled documents directly inside each selected folder require cycle evidence. Evidences and OLD DMS folders are excluded.</p>
      <label className="relative mt-3 block max-w-xl"><span className="sr-only">Search process folders</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#52627a]" aria-hidden="true" /><input value={folderQuery} onChange={event => setFolderQuery(event.target.value)} placeholder="Search folder name or path" className="field-control h-10 w-full pl-10 pr-3" /></label>
      <div className="mt-2 max-h-64 overflow-y-auto rounded border border-[#dbe2ec] bg-[#fbfdff] dark:border-white/10 dark:bg-slate-950/30">{matchingFolders.length ? matchingFolders.map(folder => <label key={folder.folderId} className="flex cursor-pointer items-start gap-3 border-b border-[#edf1f6] px-3 py-2.5 last:border-b-0 hover:bg-[#eff5fb] dark:border-white/10 dark:hover:bg-slate-800"><input type="checkbox" checked={folderIds.includes(folder.folderId)} onChange={() => toggleFolder(folder.folderId)} className="mt-1 h-4 w-4 shrink-0 accent-[#1763a5]" /><span className="min-w-0"><span className="block text-sm font-medium text-[#26334d] dark:text-white">{folder.path}</span><span className="text-xs text-[#52627a] dark:text-slate-300">{folder.controlledDocumentCount} controlled document{folder.controlledDocumentCount === 1 ? '' : 's'} directly inside</span></span></label>) : <p className="px-3 py-4 text-sm text-[#52627a] dark:text-slate-300">No eligible folders match your search.</p>}</div>
      {unavailableCount > 0 && <p role="alert" className="mt-2 text-sm text-[#9f3038] dark:text-red-200">{unavailableCount} previously selected folder{unavailableCount === 1 ? ' is' : 's are'} no longer available. Review the cycle before saving.</p>}
      {ineligibleContactCount > 0 && <p role="status" className="mt-2 text-sm text-[#8a5411] dark:text-amber-300">{ineligibleContactCount} previously assigned contact{ineligibleContactCount === 1 ? ' is' : 's are'} no longer an eligible person with folder access and will be removed when you save.</p>}
    </section>
    {departments.length > 0 && <section aria-label="Department responsibility" className="border-t border-[#dbe2ec] pt-5 dark:border-white/10"><h3 className="text-sm font-semibold text-[#26334d] dark:text-white">Responsible people by department</h3><p className="mt-1 text-xs leading-5 text-[#52627a] dark:text-slate-300">Choose one or more people for each department. Active owners, managers, and members with access to a selected folder or its department parent are available. This mapping applies to this cycle only.</p><div className="mt-3 divide-y divide-[#e8eef5] rounded border border-[#dbe2ec] dark:divide-white/10 dark:border-white/10">{departments.map(department => {
      const term = (userQueries[department.id] ?? '').trim().toLowerCase();
      const visible = department.users.filter(user => `${user.fullName} ${user.email}`.toLowerCase().includes(term));
      const selectedIds = (assignments[department.id] ?? []).filter(id => department.users.some(user => user.userId === id));
      return <div key={department.id} className="px-4 py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-semibold text-[#26334d] dark:text-white">{department.name}</h4><span className="text-xs text-[#52627a] dark:text-slate-300">{selectedIds.length} responsible · {department.folders.length} folder{department.folders.length === 1 ? '' : 's'}</span></div>{department.users.length ? <><label className="relative mt-3 block max-w-md"><span className="sr-only">Search owners and managers for {department.name}</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#52627a]" aria-hidden="true" /><input value={userQueries[department.id] ?? ''} onChange={event => setUserQueries(current => ({ ...current, [department.id]: event.target.value }))} placeholder="Search eligible owner or manager" className="field-control h-10 w-full pl-10 pr-3" /></label><div className="mt-2 grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">{visible.length ? visible.map(user => <label key={user.userId} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm text-[#26334d] hover:bg-[#eff5fb] dark:text-white dark:hover:bg-slate-800"><input type="checkbox" checked={selectedIds.includes(user.userId)} onChange={() => toggleUser(department.id, user.userId)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#1763a5]" /><span className="min-w-0"><span className="block font-medium">{user.fullName}</span><span className="block truncate text-xs text-[#52627a] dark:text-slate-300">{user.email}</span></span></label>) : <p className="px-2 py-3 text-sm text-[#52627a] dark:text-slate-300">No owner or manager matches.</p>}</div></> : <p className="mt-2 text-sm text-[#9f3038] dark:text-red-200">Assign an active Owner or Manager to this folder in Document Library before saving the cycle.</p>}</div>;
    })}</div></section>}
    <div className="flex items-center justify-end gap-3 border-t border-[#dbe2ec] pt-4 dark:border-white/10"><span className="mr-auto text-xs text-[#52627a] dark:text-slate-300">{ready ? 'Ready to save.' : 'Select folders and map every department.'}</span><Button onClick={() => void submit()} disabled={disabled || saving || !ready} leftIcon={<FolderCheck className="h-4 w-4" />}>{saving ? 'Saving…' : saveLabel}</Button></div>
  </div>;
}
