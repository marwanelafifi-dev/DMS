import { useState } from 'react';
import { CalendarDays, CalendarPlus, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';

export interface AuditEvent {
  id: string;
  title: string;
  phase: 'Internal Audit' | 'Stage 1 Audit' | 'Stage 2 Audit' | 'Surveillance Audit' | 'Recertification Audit' | 'Management Review';
  standard: 'ISO 9001:2015' | 'ISO 27001:2022' | 'Both';
  date: string; // ISO date, yyyy-mm-dd
  notes?: string;
  postedBy: string;
}

interface AuditCalendarCardProps {
  canManage: boolean;
  currentUserName: string;
}

const phaseStyles: Record<AuditEvent['phase'], string> = {
  'Internal Audit': 'bg-[#edf1f5] text-[#52627a] dark:bg-white/10 dark:text-slate-300',
  'Stage 1 Audit': 'bg-[#dbeafe] text-[#2f6f9f] dark:bg-blue-500/15 dark:text-blue-300',
  'Stage 2 Audit': 'bg-[#dbeafe] text-[#2f6f9f] dark:bg-blue-500/15 dark:text-blue-300',
  'Surveillance Audit': 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300',
  'Recertification Audit': 'bg-[#fde1e2] text-[#c73c44] dark:bg-red-500/15 dark:text-red-300',
  'Management Review': 'bg-[#d8f5e4] text-[#27885a] dark:bg-emerald-500/15 dark:text-emerald-300',
};

const seedEvents: AuditEvent[] = [
  { id: '1', title: 'ISO 9001 Internal Audit', phase: 'Internal Audit', standard: 'ISO 9001:2015', date: '2026-06-10', notes: 'Completed — no major nonconformities.', postedBy: 'Mona Saleh' },
  { id: '2', title: 'Combined Stage 1 Audit', phase: 'Stage 1 Audit', standard: 'Both', date: '2026-07-05', notes: 'Documentation review completed.', postedBy: 'Mona Saleh' },
  { id: '3', title: 'Combined Stage 2 Audit', phase: 'Stage 2 Audit', standard: 'Both', date: '2026-08-18', notes: 'On-site certification audit — all departments to be available.', postedBy: 'System Admin' },
  { id: '4', title: 'ISMS Management Review', phase: 'Management Review', standard: 'ISO 27001:2022', date: '2026-09-02', notes: 'Leadership review of ISMS performance.', postedBy: 'System Admin' },
  { id: '5', title: 'First Surveillance Audit', phase: 'Surveillance Audit', standard: 'ISO 9001:2015', date: '2027-01-15', notes: 'Year 1 surveillance visit.', postedBy: 'Mona Saleh' },
];

function toGoogleCalendarUrl(event: AuditEvent) {
  const start = event.date.replace(/-/g, '');
  const startDate = new Date(`${event.date}T00:00:00`);
  const end = new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: `${event.notes ?? ''}\n\nStandard: ${event.standard} · Phase: ${event.phase}`.trim(),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function statusOf(event: AuditEvent): 'completed' | 'next' | 'upcoming' {
  const today = new Date().toISOString().slice(0, 10);
  if (event.date < today) return 'completed';
  return 'upcoming';
}

export function AuditCalendarCard({ canManage, currentUserName }: AuditCalendarCardProps) {
  const [events, setEvents] = useState<AuditEvent[]>(seedEvents);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', phase: 'Stage 2 Audit' as AuditEvent['phase'], standard: 'Both' as AuditEvent['standard'], date: '', notes: '' });

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const nextUpcomingId = sorted.find((event) => statusOf(event) === 'upcoming')?.id;

  const submit = () => {
    if (!form.title.trim() || !form.date) return;
    setEvents((prev) => [...prev, { id: crypto.randomUUID(), ...form, postedBy: currentUserName }]);
    setForm({ title: '', phase: 'Stage 2 Audit', standard: 'Both', date: '', notes: '' });
    setShowForm(false);
  };

  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="section-heading flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#3f8bca]" />ISO Certification Journey &amp; Audit Calendar</h2>
            <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">Published by Admin / QA · visible to all users</p>
          </div>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)} leftIcon={<CalendarPlus className="h-4 w-4" />}>
              New Audit Event
            </Button>
          )}
        </div>

        {showForm && canManage && (
          <div className="mt-4 rounded-[4px] border border-[#dbe2ec] bg-[#f8fafc] p-4 dark:border-white/10 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#26334d] dark:text-white">Publish a new audit event</h3>
              <button onClick={() => setShowForm(false)} className="rounded p-1 text-[#718198] hover:bg-[#eef2f7] dark:text-slate-400 dark:hover:bg-white/10" aria-label="Close form"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-[#52627a] dark:text-slate-400">
                Title
                <input className="field-control mt-1 w-full" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Combined Stage 2 Audit" />
              </label>
              <label className="block text-xs font-medium text-[#52627a] dark:text-slate-400">
                Date
                <input type="date" className="field-control mt-1 w-full" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
              <label className="block text-xs font-medium text-[#52627a] dark:text-slate-400">
                Phase
                <select className="field-control mt-1 w-full" value={form.phase} onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value as AuditEvent['phase'] }))}>
                  {Object.keys(phaseStyles).map((phase) => <option key={phase} value={phase}>{phase}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-[#52627a] dark:text-slate-400">
                Standard
                <select className="field-control mt-1 w-full" value={form.standard} onChange={(e) => setForm((f) => ({ ...f, standard: e.target.value as AuditEvent['standard'] }))}>
                  <option value="ISO 9001:2015">ISO 9001:2015</option>
                  <option value="ISO 27001:2022">ISO 27001:2022</option>
                  <option value="Both">Both</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-[#52627a] dark:text-slate-400 sm:col-span-2">
                Notes
                <textarea className="field-control mt-1 w-full" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Details all users should know" />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={submit}>Publish to all users</Button>
            </div>
          </div>
        )}

        <ol className="mt-5 space-y-0">
          {sorted.map((event, index) => {
            const status = statusOf(event);
            const isNext = event.id === nextUpcomingId;
            return (
              <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                {index !== sorted.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-[#dbe2ec] dark:bg-white/10" />}
                <span className={`relative mt-1 flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full border-2 ${status === 'completed' ? 'border-[#319d68] bg-[#319d68]' : isNext ? 'border-[#3f8bca] bg-white dark:bg-slate-900' : 'border-[#cbd5e3] bg-white dark:border-white/20 dark:bg-slate-900'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#26334d] dark:text-white">{event.title}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${phaseStyles[event.phase]}`}>{event.phase}</span>
                    {isNext && <span className="rounded bg-[#3f8bca] px-2 py-0.5 text-[11px] font-medium text-white">Next</span>}
                    {status === 'completed' && <span className="rounded bg-[#d8f5e4] px-2 py-0.5 text-[11px] font-medium text-[#27885a] dark:bg-emerald-500/15 dark:text-emerald-300">Completed</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#718198] dark:text-slate-400">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{new Date(`${event.date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    <span>{event.standard}</span>
                    <span>Posted by {event.postedBy}</span>
                  </div>
                  {event.notes && <p className="mt-1.5 text-xs text-[#52627a] dark:text-slate-300">{event.notes}</p>}
                  <a
                    href={toGoogleCalendarUrl(event)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-[4px] border border-[#dbe2ec] px-2.5 py-1 text-xs font-medium text-[#3f8bca] hover:bg-[#eef2f7] dark:border-white/10 dark:text-[#7ab8e6] dark:hover:bg-white/5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />Add to Google Calendar
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
