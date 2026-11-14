import { useEffect, useState } from 'react';
import { apiClient } from '../../utils/api';
import { Button } from '../ui/Button';
import { useToast } from '../../hooks/useToast';

export function ActiveAuditProgramme() {
  const { showError, showSuccess } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => { apiClient.getAppSetting('active_iso_9001_programme_year').then(r => setActive(Number((r.data as any)?.value) || null)).catch(() => {}); }, []);
  const save = async () => { try { await apiClient.updateAppSetting('active_iso_9001_programme_year', String(year)); setActive(year); showSuccess(`${year} is now the active ISO 9001 programme`); } catch { showError('Could not set the active programme'); } };
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[5px] border border-[#dbe2ec] bg-[#f8fbff] px-4 py-3 dark:border-white/10 dark:bg-blue-950/20"><div><p className="text-sm font-semibold text-[#26334d] dark:text-white">Active ISO 9001 programme</p><p className="text-xs text-[#64748b]">{active ? `${active} currently controls new evidence and audit reporting.` : 'No programme selected.'}</p></div><div className="flex gap-2"><input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="field-control h-9 w-28 px-2" aria-label="Active programme year" /><Button size="sm" onClick={() => void save()}>Set Active</Button></div></div>;
}
