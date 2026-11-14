import { useEffect, useState } from 'react';
import { apiClient } from '../../utils/api';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { useToast } from '../../hooks/useToast';

export function AuditCycleManager() {
  const { showError, showSuccess } = useToast(); const [cycles, setCycles] = useState<any[]>([]); const [form, setForm] = useState({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' });
  const load = () => apiClient.getAuditCycles().then(r => setCycles(r.data ?? [])).catch(() => showError('Could not load audit cycles'));
  useEffect(() => { load(); }, []);
  const create = async () => { try { await apiClient.createAuditCycle(form); setForm({ name: '', standard: 'ISO 9001:2015', startDate: '', endDate: '' }); load(); showSuccess('Audit cycle created'); } catch (e: any) { showError(e.response?.data?.error || 'Could not create audit cycle'); } };
  const activate = async (id: string) => { try { await apiClient.activateAuditCycle(id); load(); showSuccess('Audit cycle activated'); } catch { showError('Could not activate audit cycle'); } };
  return <Card><CardBody className="space-y-4"><div><h2 className="section-heading">Audit Cycles</h2><p className="mt-1 text-sm text-[#64748b]">ISO 9001 cross-year cycles and ISO 27001 annual programmes.</p></div><div className="grid gap-2 md:grid-cols-4"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="field-control h-10 px-3" placeholder="Cycle name" /><select value={form.standard} onChange={e => setForm({ ...form, standard: e.target.value })} className="field-control h-10 px-3"><option>ISO 9001:2015</option><option>ISO 27001:2022</option></select><input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} className="field-control h-10 px-3" /><input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} className="field-control h-10 px-3" /></div><Button onClick={() => void create()} disabled={!form.name || !form.startDate || !form.endDate}>Create cycle</Button><div className="divide-y divide-[#e2e8f0] dark:divide-white/10">{cycles.map(c => <div key={c.auditCycleId} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium text-[#26334d] dark:text-white">{c.name}</p><p className="text-xs text-[#64748b]">{c.standard} · {c.startDate} to {c.endDate} · {c.status}</p></div>{c.status !== 'active' && <Button size="sm" variant="secondary" onClick={() => void activate(c.auditCycleId)}>Set Active</Button>}</div>)}</div></CardBody></Card>;
}
