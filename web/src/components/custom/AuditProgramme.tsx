import { CalendarDays, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { useToast } from '../../hooks/useToast';

const stagesByStandard = {
  'ISO 9001:2015': [['Preparation', 'Preparation', 'preparation'], ['Evidence deadline', 'Evidence Deadline', 'evidence_deadline'], ['Internal audit', 'Internal Audit', 'internal_audit'], ['PCAR closure', 'PCAR Closure Deadline', 'pcar_closure'], ['Management review', 'Management Review', 'management_review'], ['Surveillance audit', 'Surveillance Audit', 'surveillance_audit'], ['External response', 'External Finding Response', 'external_response'], ['Cycle closure', 'Cycle Closure', 'cycle_closure']],
  'ISO 27001:2022': [['Preparation', 'Preparation', 'preparation'], ['Evidence deadline', 'Evidence Deadline', 'evidence_deadline'], ['Internal ISMS audit', 'Internal Audit', 'internal_audit'], ['ISMS management review', 'Management Review', 'management_review'], ['External audit', 'Surveillance Audit', 'surveillance_audit'], ['Findings closure', 'PCAR Closure Deadline', 'pcar_closure'], ['Year-end closure', 'Cycle Closure', 'cycle_closure']],
} as const;

type Standard = keyof typeof stagesByStandard;
type StageValue = { date: string; dueDate: string; ownerId: string; status: string; notes: string };
const optionalStageKeys = new Set(['evidence_deadline', 'pcar_closure', 'external_response', 'cycle_closure']);
const emptyStage = (): StageValue => ({ date: '', dueDate: '', ownerId: '', status: 'planned', notes: '' });

export function AuditProgramme() {
  const { showError, showSuccess } = useToast();
  const [cycles, setCycles] = useState<any[]>([]);
  const [standard, setStandard] = useState<Standard>('ISO 9001:2015');
  const [cycleId, setCycleId] = useState('');
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [values, setValues] = useState<Record<string, StageValue>>({});
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [changingStageKey, setChangingStageKey] = useState('');

  const loadCycles = () => apiClient.getAuditCycles().then(response => setCycles(response.data ?? [])).catch(() => showError('Could not load audit cycles'));
  useEffect(() => { void loadCycles(); apiClient.getUsers().then(response => setUsers((response.data ?? []).filter((user: any) => user.isActive))).catch(() => {}); }, []);

  const standardCycles = useMemo(() => cycles.filter(cycle => cycle.standard === standard), [cycles, standard]);
  useEffect(() => { const active = standardCycles.find(cycle => cycle.status === 'active'); setCycleId(active?.auditCycleId ?? standardCycles[0]?.auditCycleId ?? ''); }, [standard, cycles]);

  useEffect(() => {
    if (!cycleId) { setValues({}); setRemovedKeys([]); return; }
    Promise.all([apiClient.getAuditCalendarEvents(), apiClient.getRemovedAuditProgrammeStages(cycleId)])
      .then(([calendarResponse, excludedResponse]) => {
        const next: Record<string, StageValue> = {};
        (calendarResponse.data ?? []).filter((event: any) => event.auditCycleId === cycleId && event.stageKey).forEach((event: any) => {
          next[event.stageKey] = { date: String(event.eventDate).slice(0, 10), dueDate: event.dueDate ? String(event.dueDate).slice(0, 10) : '', ownerId: event.ownerId ?? '', status: event.status ?? 'planned', notes: event.notes ?? '' };
        });
        setValues(next);
        setRemovedKeys((excludedResponse.data ?? []).map((stage: any) => stage.stageKey));
      })
      .catch(() => { setValues({}); setRemovedKeys([]); showError('Could not load programme stages'); });
  }, [cycleId]);

  const cycle = cycles.find(item => item.auditCycleId === cycleId);
  const allStages = stagesByStandard[standard];
  const stages = allStages.filter(([, , key]) => !removedKeys.includes(key));
  const removedStages = allStages.filter(([, , key]) => removedKeys.includes(key));
  const update = (key: string, field: keyof StageValue, value: string) => setValues(current => ({ ...current, [key]: { ...(current[key] ?? emptyStage()), [field]: value } }));

  const save = async () => {
    if (!cycle) return showError('Create and select an audit cycle first');
    const configured = stages.filter(([, , key]) => values[key]?.date);
    if (!configured.length) return showError('Enter at least one stage date');
    setSaving(true);
    try {
      await Promise.all(configured.map(([label, phase, key]) => {
        const item = values[key];
        return apiClient.createAuditCalendarEvent({ title: `${cycle.name} — ${label}`, phase, standard, eventDate: item.date, dueDate: item.dueDate || undefined, ownerId: item.ownerId || undefined, status: item.status, notes: item.notes || undefined, programmeYear: new Date(cycle.startDate).getFullYear(), stageKey: key, auditCycleId: cycle.auditCycleId });
      }));
      showSuccess(`${cycle.name} stages saved`);
    } catch (error: any) { showError(error.response?.data?.error || 'Could not save audit stages'); }
    finally { setSaving(false); }
  };

  const removeStage = async (label: string, key: string) => {
    if (!cycle || !window.confirm(`Remove ${label} from this cycle? Its saved dates and notes will be retained and can be restored later.`)) return;
    setChangingStageKey(key);
    try {
      await apiClient.removeAuditProgrammeStage(cycle.auditCycleId, key);
      setRemovedKeys(current => [...current, key]);
      showSuccess(`${label} removed from this cycle`);
    } catch (error: any) { showError(error.response?.data?.error || `Could not remove ${label}`); }
    finally { setChangingStageKey(''); }
  };

  const restoreStage = async (label: string, key: string) => {
    if (!cycle) return;
    setChangingStageKey(key);
    try {
      await apiClient.restoreAuditProgrammeStage(cycle.auditCycleId, key);
      setRemovedKeys(current => current.filter(item => item !== key));
      showSuccess(`${label} restored to this cycle`);
    } catch (error: any) { showError(error.response?.data?.error || `Could not restore ${label}`); }
    finally { setChangingStageKey(''); }
  };

  return <Card><CardBody className="p-0">
    <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10">
      <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-[#3f8bca]" /><h2 className="section-heading">Cycle stage plan</h2></div>
      <p className="mt-1 text-sm text-[#64748b]">Set the dates and accountable owners for this cycle. Optional stages can be removed without deleting their saved information.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Standard<select value={standard} onChange={event => setStandard(event.target.value as Standard)} className="field-control mt-1 h-10 w-full px-3"><option value="ISO 9001:2015">ISO 9001:2015</option><option value="ISO 27001:2022">ISO 27001:2022</option></select></label>
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Audit cycle<select value={cycleId} onChange={event => setCycleId(event.target.value)} className="field-control mt-1 h-10 w-full px-3"><option value="">Select a cycle</option>{standardCycles.map(item => <option key={item.auditCycleId} value={item.auditCycleId}>{item.name}{item.status === 'active' ? ' — Active' : ` — ${item.status}`}</option>)}</select></label>
      </div>
      {cycle && <p className="mt-3 text-xs text-[#64748b]">{cycle.startDate} to {cycle.endDate} · {cycle.status}</p>}
      {removedStages.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#e2e8f0] pt-3 dark:border-white/10"><span className="text-xs font-medium text-[#718198]">Removed optional stages</span>{removedStages.map(([label, , key]) => <Button key={key} size="sm" variant="ghost" disabled={changingStageKey === key} leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void restoreStage(label, key)}>Restore {label}</Button>)}</div>}
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[960px]"><thead className="bg-[#f8fafc] text-left text-xs uppercase tracking-wide text-[#718198] dark:bg-slate-950/40"><tr><th className="px-5 py-3">Stage</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Due date</th><th className="px-5 py-3">Owner</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Notes</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody>{stages.map(([label, , key]) => { const item = values[key] ?? emptyStage(); const optional = optionalStageKeys.has(key); return <tr key={key} className="border-t border-[#e8eef5] dark:border-white/10"><td className="px-5 py-3 text-sm font-medium text-[#26334d] dark:text-white">{label}</td><td className="px-5 py-3"><input type="date" value={item.date} onChange={event => update(key, 'date', event.target.value)} className="field-control h-9 px-2" /></td><td className="px-5 py-3"><input type="date" value={item.dueDate} onChange={event => update(key, 'dueDate', event.target.value)} className="field-control h-9 px-2" /></td><td className="px-5 py-3"><select value={item.ownerId} onChange={event => update(key, 'ownerId', event.target.value)} className="field-control h-9 min-w-36 px-2"><option value="">Unassigned</option>{users.map(user => <option key={user.userId} value={user.userId}>{user.fullName}</option>)}</select></td><td className="px-5 py-3"><select value={item.status} onChange={event => update(key, 'status', event.target.value)} className="field-control h-9 px-2"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></td><td className="px-5 py-3"><input value={item.notes} onChange={event => update(key, 'notes', event.target.value)} className="field-control h-9 min-w-44 px-2" placeholder="Optional notes" /></td><td className="px-5 py-3 text-right">{optional ? <Button size="sm" variant="ghost" disabled={changingStageKey === key} onClick={() => void removeStage(label, key)} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>{changingStageKey === key ? 'Removing…' : 'Remove'}</Button> : <span className="text-xs text-[#718198]">Required</span>}</td></tr>; })}</tbody></table></div>
    <div className="flex justify-end border-t border-[#dbe2ec] px-5 py-4 dark:border-white/10"><Button onClick={() => void save()} disabled={saving || !cycleId} leftIcon={<Save className="h-4 w-4" />}>{saving ? 'Saving…' : 'Save stages'}</Button></div>
  </CardBody></Card>;
}
