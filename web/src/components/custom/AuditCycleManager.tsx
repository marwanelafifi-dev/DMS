import { CalendarDays, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { AuditCycleSetupEditor, type CycleSetup } from './AuditCycleSetupEditor';

type Cycle = { auditCycleId: string; name: string; standard: string; startDate: string; endDate: string; status: string };

export function AuditCycleManager() {
  const { showError, showSuccess } = useToast();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [form, setForm] = useState({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' });
  const [creationVersion, setCreationVersion] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState('');
  const [preparationStatus, setPreparationStatus] = useState<Record<string, string>>({});
  const invalid27001Dates = form.standard === 'ISO 27001:2022' && !!form.startDate && !!form.endDate
    && (form.startDate.slice(0, 4) !== form.endDate.slice(0, 4) || form.startDate.slice(5) !== '01-01' || form.endDate.slice(5) !== '12-31');

  const load = async () => {
    try {
      const [cycleResponse, calendarResponse] = await Promise.all([apiClient.getAuditCycles(), apiClient.getAuditCalendarEvents()]);
      setCycles(cycleResponse.data ?? []);
      setPreparationStatus((calendarResponse.data ?? []).filter((event: any) => event.stageKey === 'preparation').reduce((result: Record<string, string>, event: any) => ({ ...result, [event.auditCycleId]: event.status }), {}));
    } catch { showError('Could not load audit cycles'); }
  };
  useEffect(() => { void load(); }, []);

  const create = async (setup: CycleSetup) => {
    try {
      await apiClient.createAuditCycle({ ...form, setup });
      setForm({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' });
      setCreationVersion(current => current + 1);
      await load();
      showSuccess('Audit cycle, covered folders, and department responsibility saved.');
    } catch (error: any) { showError(error.response?.data?.error || 'Could not create audit cycle'); }
  };

  const saveExisting = async (cycle: Cycle, setup: CycleSetup) => {
    try {
      await apiClient.updateAuditCycleSetup(cycle.auditCycleId, setup);
      setEditingId(null);
      showSuccess(`${cycle.name} coverage and responsible users saved.`);
    } catch (error: any) { showError(error.response?.data?.error || 'Could not save the cycle setup'); }
  };

  const activate = async (id: string) => {
    try { await apiClient.activateAuditCycle(id); await load(); showSuccess('Audit cycle activated'); }
    catch { showError('Could not activate audit cycle'); }
  };

  const start = async (id: string) => {
    setStartingId(id);
    try {
      await apiClient.startAuditCycle(id);
      await load();
      showSuccess('Journey started: Preparation is now in progress');
    } catch (error: any) { showError(error.response?.data?.error || 'Could not start the journey'); }
    finally { setStartingId(''); }
  };

  return <div className="space-y-5">
    <Card><CardBody className="space-y-5">
      <div><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-[#1763a5]" aria-hidden="true" /><h2 className="section-heading">Create audit cycle</h2></div><p className="mt-1 text-sm leading-6 text-[#52627a] dark:text-slate-300">Set the cycle, select the process folders it covers, then map each department to its responsible folder owners or managers. Save the setup once; Evidence Coverage and Readiness use it automatically.</p></div>
      <div className="grid gap-3 border-b border-[#dbe2ec] pb-5 md:grid-cols-2 xl:grid-cols-4 dark:border-white/10">
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Cycle name<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="field-control mt-1 h-10 w-full px-3" placeholder="ISO 9001 Surveillance 2026–2027" /></label>
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Standard<select value={form.standard} onChange={event => setForm(current => ({ ...current, standard: event.target.value }))} className="field-control mt-1 h-10 w-full px-3"><option>ISO 9001:2015</option><option>ISO 27001:2022</option></select></label>
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">Start date<input type="date" value={form.startDate} onChange={event => setForm(current => ({ ...current, startDate: event.target.value }))} className="field-control mt-1 h-10 w-full px-3" /></label>
        <label className="text-sm font-medium text-[#34425b] dark:text-slate-200">End date<input type="date" value={form.endDate} onChange={event => setForm(current => ({ ...current, endDate: event.target.value }))} className="field-control mt-1 h-10 w-full px-3" /></label>
      </div>
      {invalid27001Dates && <p role="alert" className="text-sm text-[#9f3038] dark:text-red-200">ISO 27001 programmes must run from 1 January through 31 December of one year.</p>}
      <AuditCycleSetupEditor key={`create:${creationVersion}`} standard={form.standard} saveLabel="Create cycle with setup" disabled={!form.name.trim() || !form.startDate || !form.endDate || form.endDate < form.startDate || invalid27001Dates} onSave={create} />
    </CardBody></Card>
    <Card><CardBody className="p-0">
      <div className="border-b border-[#dbe2ec] px-5 py-4 dark:border-white/10"><h2 className="section-heading">Existing cycles</h2><p className="mt-1 text-sm text-[#52627a] dark:text-slate-300">Update covered folders and responsible users here. Historical cycles remain read-only.</p></div>
      {cycles.length ? <div className="divide-y divide-[#e8eef5] dark:divide-white/10">{cycles.map(cycle => <section key={cycle.auditCycleId} className="px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-[#26334d] dark:text-white">{cycle.name}</h3><p className="mt-1 text-xs text-[#52627a] dark:text-slate-300">{cycle.standard} · {cycle.startDate} to {cycle.endDate} · {cycle.status}</p></div><div className="flex flex-wrap gap-2">{cycle.status !== 'historical' && <Button size="sm" variant="secondary" onClick={() => setEditingId(current => current === cycle.auditCycleId ? null : cycle.auditCycleId)} leftIcon={<ChevronDown className={`h-4 w-4 transition-transform ${editingId === cycle.auditCycleId ? 'rotate-180' : ''}`} />}>{editingId === cycle.auditCycleId ? 'Close setup' : 'Manage folders & owners'}</Button>}{cycle.standard === 'ISO 9001:2015' && cycle.status !== 'historical' && preparationStatus[cycle.auditCycleId] !== 'completed' && <Button size="sm" onClick={() => void start(cycle.auditCycleId)} disabled={startingId === cycle.auditCycleId}>{startingId === cycle.auditCycleId ? 'Starting…' : cycle.status === 'active' ? 'Start preparation' : 'Start journey'}</Button>}{cycle.status !== 'active' && cycle.status !== 'historical' && <Button size="sm" variant="secondary" onClick={() => void activate(cycle.auditCycleId)}>Set active only</Button>}</div></div>{editingId === cycle.auditCycleId && <div className="mt-5 border-t border-[#dbe2ec] pt-5 dark:border-white/10"><AuditCycleSetupEditor key={cycle.auditCycleId} standard={cycle.standard} cycleId={cycle.auditCycleId} saveLabel="Save cycle setup" onSave={setup => saveExisting(cycle, setup)} /></div>}</section>)}</div> : <p className="px-5 py-6 text-sm text-[#52627a] dark:text-slate-300">No audit cycles have been created yet.</p>}
    </CardBody></Card>
  </div>;
}
