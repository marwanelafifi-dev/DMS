import { useEffect, useState } from 'react';
import { apiClient } from '../../utils/api';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { useToast } from '../../hooks/useToast';

export function AuditCycleManager() {
  const { showError, showSuccess } = useToast();
  const [cycles, setCycles] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' });
  const [startingId, setStartingId] = useState('');
  const [preparationStatus, setPreparationStatus] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const [cycleResponse, calendarResponse] = await Promise.all([apiClient.getAuditCycles(), apiClient.getAuditCalendarEvents()]);
      setCycles(cycleResponse.data ?? []);
      setPreparationStatus((calendarResponse.data ?? []).filter((event: any) => event.stageKey === 'preparation').reduce((result: Record<string, string>, event: any) => ({ ...result, [event.auditCycleId]: event.status }), {}));
    } catch { showError('Could not load audit cycles'); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    try {
      await apiClient.createAuditCycle(form);
      setForm({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' });
      load();
      showSuccess('Audit cycle created');
    } catch (error: any) { showError(error.response?.data?.error || 'Could not create audit cycle'); }
  };

  const activate = async (id: string) => {
    try { await apiClient.activateAuditCycle(id); load(); showSuccess('Audit cycle activated'); }
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

  return <Card><CardBody className="space-y-4">
    <div>
      <h2 className="section-heading">Audit Cycles</h2>
      <p className="mt-1 text-sm text-[#64748b]">Create the cycle once. For ISO 9001, use <strong>Start journey</strong> to make it active and begin Preparation. Audit records then update their own journey stage automatically.</p>
    </div>
    <div className="grid gap-2 md:grid-cols-4">
      <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="field-control h-10 px-3" placeholder="Cycle name" />
      <select value={form.standard} onChange={event => setForm({ ...form, standard: event.target.value })} className="field-control h-10 px-3"><option>ISO 9001:2015</option><option>ISO 27001:2022</option></select>
      <input type="date" value={form.startDate} onChange={event => setForm({ ...form, startDate: event.target.value })} className="field-control h-10 px-3" />
      <input type="date" value={form.endDate} onChange={event => setForm({ ...form, endDate: event.target.value })} className="field-control h-10 px-3" />
    </div>
    <Button onClick={() => void create()} disabled={!form.name || !form.startDate || !form.endDate}>Create cycle</Button>
    <div className="divide-y divide-[#e2e8f0] dark:divide-white/10">
      {cycles.map(cycle => <div key={cycle.auditCycleId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-medium text-[#26334d] dark:text-white">{cycle.name}</p><p className="text-xs text-[#64748b]">{cycle.standard} · {cycle.startDate} to {cycle.endDate} · {cycle.status}</p></div>
        <div className="flex flex-wrap gap-2">
          {cycle.standard === 'ISO 9001:2015' && cycle.status !== 'historical' && preparationStatus[cycle.auditCycleId] !== 'completed' && <Button size="sm" onClick={() => void start(cycle.auditCycleId)} disabled={startingId === cycle.auditCycleId}>{startingId === cycle.auditCycleId ? 'Starting…' : cycle.status === 'active' ? 'Start preparation' : 'Start journey'}</Button>}
          {cycle.status !== 'active' && <Button size="sm" variant="secondary" onClick={() => void activate(cycle.auditCycleId)}>Set active only</Button>}
        </div>
      </div>)}
    </div>
  </CardBody></Card>;
}
