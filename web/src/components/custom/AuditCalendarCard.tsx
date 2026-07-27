import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ExternalLink, Link2, RefreshCw, ShieldCheck, Unlink, X } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

export interface AuditEvent {
  eventId: string;
  title: string;
  phase: 'Internal Audit' | 'Stage 1 Audit' | 'Stage 2 Audit' | 'Surveillance Audit' | 'Recertification Audit' | 'Management Review';
  standard: 'ISO 9001:2015' | 'ISO 27001:2022' | 'Both';
  eventDate: string; // ISO date, yyyy-mm-dd
  notes?: string;
  postedByName?: string;
}

interface AuditCalendarCardProps {
  canManage: boolean;
}

const phaseStyles: Record<AuditEvent['phase'], string> = {
  'Internal Audit': 'bg-[#edf1f5] text-[#52627a] dark:bg-white/10 dark:text-slate-300',
  'Stage 1 Audit': 'bg-[#dbeafe] text-[#2f6f9f] dark:bg-blue-500/15 dark:text-blue-300',
  'Stage 2 Audit': 'bg-[#dbeafe] text-[#2f6f9f] dark:bg-blue-500/15 dark:text-blue-300',
  'Surveillance Audit': 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-500/15 dark:text-amber-300',
  'Recertification Audit': 'bg-[#fde1e2] text-[#c73c44] dark:bg-red-500/15 dark:text-red-300',
  'Management Review': 'bg-[#d8f5e4] text-[#27885a] dark:bg-emerald-500/15 dark:text-emerald-300',
};

function toGoogleCalendarUrl(event: AuditEvent) {
  const start = event.eventDate.replace(/-/g, '');
  const startDate = new Date(`${event.eventDate}T00:00:00`);
  const end = new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: `${event.notes ?? ''}\n\nStandard: ${event.standard} · Phase: ${event.phase}`.trim(),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function statusOf(event: AuditEvent): 'completed' | 'upcoming' {
  const today = new Date().toISOString().slice(0, 10);
  return event.eventDate < today ? 'completed' : 'upcoming';
}

interface GoogleCalendarStatus {
  connected: boolean;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  googleConfigured: boolean;
}

export function AuditCalendarCard({ canManage }: AuditCalendarCardProps) {
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', phase: 'Stage 2 Audit' as AuditEvent['phase'], standard: 'Both' as AuditEvent['standard'], date: '', notes: '' });
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getAuditCalendarEvents();
      setEvents(Array.isArray(res.data) ? (res.data as AuditEvent[]) : []);
    } catch {
      showError('Failed to load the audit calendar');
    } finally {
      setIsLoading(false);
    }
  };

  const loadGoogleStatus = async () => {
    try {
      const res = await apiClient.getGoogleCalendarStatus();
      setGoogleStatus(res.data as GoogleCalendarStatus);
    } catch {
      // Non-fatal: the calendar list itself still works without this.
    }
  };

  useEffect(() => {
    void loadEvents();
    void loadGoogleStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Google redirects back here (see GoogleCalendarController.Callback) with
  // ?calendarConnected=true or ?calendarError=... — surface it once, then strip
  // the params so a refresh doesn't re-show the same toast.
  useEffect(() => {
    if (searchParams.get('calendarConnected')) {
      showSuccess('Google Calendar connected');
      void loadGoogleStatus();
      setSearchParams((params) => { params.delete('calendarConnected'); return params; }, { replace: true });
    } else if (searchParams.get('calendarError')) {
      showError('Could not connect Google Calendar — please try again');
      setSearchParams((params) => { params.delete('calendarError'); return params; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleConnect = async () => {
    try {
      const res = await apiClient.getGoogleCalendarAuthUrl();
      const authUrl = (res.data as { authUrl?: string } | undefined)?.authUrl;
      if (authUrl) window.location.href = authUrl;
    } catch (err: any) {
      showError(err.response?.data?.error || 'Google Calendar sync is not configured yet');
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiClient.disconnectGoogleCalendar();
      showSuccess('Google Calendar disconnected');
      await loadGoogleStatus();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to disconnect Google Calendar');
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const res = await apiClient.syncGoogleCalendarNow();
      const { pushed, failed } = (res.data as { pushed: number; failed: number }) ?? { pushed: 0, failed: 0 };
      showSuccess(failed > 0 ? `Synced ${pushed} event(s), ${failed} failed` : `Synced ${pushed} event(s) to your Google Calendar`);
      await loadGoogleStatus();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const sorted = [...events].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const nextUpcomingId = sorted.find((event) => statusOf(event) === 'upcoming')?.eventId;

  const submit = async () => {
    if (!form.title.trim() || !form.date) {
      showError('Title and date are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient.createAuditCalendarEvent({
        title: form.title.trim(),
        phase: form.phase,
        standard: form.standard,
        eventDate: form.date,
        notes: form.notes.trim() || undefined,
      });
      showSuccess('Audit event published');
      setForm({ title: '', phase: 'Stage 2 Audit', standard: 'Both', date: '', notes: '' });
      setShowForm(false);
      await loadEvents();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to publish audit event');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <SkeletonCard />;

  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="section-heading flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#3f8bca]" />ISO Certification Journey &amp; Audit Calendar</h2>
            <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">Published by Admin / QA · visible to all users</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {googleStatus?.connected ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => void handleSyncNow()} disabled={isSyncing} leftIcon={<RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />}>
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleDisconnect()} leftIcon={<Unlink className="h-4 w-4" />}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void handleConnect()} leftIcon={<Link2 className="h-4 w-4" />}>
                Connect Google Calendar
              </Button>
            )}
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)} leftIcon={<CalendarPlus className="h-4 w-4" />}>
                New Audit Event
              </Button>
            )}
          </div>
        </div>

        {googleStatus?.connected && (
          <p className="mt-2 text-xs text-[#718198] dark:text-slate-400">
            {googleStatus.lastSyncedAt
              ? `Last synced ${new Date(googleStatus.lastSyncedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · syncs automatically every day at 6:00 AM`
              : 'Not synced yet · syncs automatically every day at 6:00 AM'}
            {googleStatus.lastSyncError && <span className="ml-2 text-[#c73c44]">Last sync had errors: {googleStatus.lastSyncError}</span>}
          </p>
        )}

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
              <Button size="sm" onClick={submit} disabled={isSubmitting}>{isSubmitting ? 'Publishing...' : 'Publish to all users'}</Button>
            </div>
          </div>
        )}

        {sorted.length === 0 ? (
          <p className="mt-5 px-1 py-4 text-sm text-[#718198]">No audit events published yet.</p>
        ) : (
          <ol className="mt-5 space-y-0">
            {sorted.map((event, index) => {
              const status = statusOf(event);
              const isNext = event.eventId === nextUpcomingId;
              return (
                <li key={event.eventId} className="relative flex gap-4 pb-6 last:pb-0">
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
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      <span>{event.standard}</span>
                      {event.postedByName && <span>Posted by {event.postedByName}</span>}
                    </div>
                    {event.notes && <p className="mt-1.5 text-xs text-[#52627a] dark:text-slate-300">{event.notes}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <a
                        href={toGoogleCalendarUrl(event)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#dbe2ec] px-2.5 py-1 text-xs font-medium text-[#3f8bca] hover:bg-[#eef2f7] dark:border-white/10 dark:text-[#7ab8e6] dark:hover:bg-white/5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />Add to Google Calendar
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
