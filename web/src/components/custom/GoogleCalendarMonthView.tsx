import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Paperclip, Users, Video, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ModalOverlay } from '../ui/ModalOverlay';

interface GoogleCalendarAttachment {
  title: string;
  fileUrl: string;
  iconLink?: string | null;
  mimeType?: string | null;
}

interface GoogleCalendarAttendee {
  email?: string | null;
  displayName?: string | null;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction' | string;
  isOrganizer: boolean;
}

interface GoogleEventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  description?: string | null;
  location?: string | null;
  conferenceLink?: string | null;
  conferenceLabel?: string | null;
  attachments?: GoogleCalendarAttachment[] | null;
  attendees?: GoogleCalendarAttendee[] | null;
}

const RESPONSE_LABELS: Record<string, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
  needsAction: 'Awaiting response',
};
const RESPONSE_COLORS: Record<string, string> = {
  accepted: 'text-[#188038]',
  declined: 'text-[#d93025]',
  tentative: 'text-[#e37400]',
  needsAction: 'text-[#5f6368] dark:text-slate-400',
};

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

// Google's own event popup renders description URLs (Zoom links, agenda docs,
// dial-in numbers, etc.) as clickable text — plain text here would leave a
// pasted Zoom invite completely unusable.
function linkifyText(text: string) {
  // split() with a capturing group returns [text, match, text, match, ...] —
  // odd indices are always the captured URLs, so no need to re-test each
  // part against the (stateful, global) regex.
  return text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="text-[#1a73e8] hover:underline break-all">{part}</a>
      : <span key={i}>{part}</span>
  );
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_PER_DAY = 3;

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Google's all-day events use an exclusive end date, so a single all-day
// event's "days" are [start, end). Timed events are placed on their start day.
function eventDateKeys(event: GoogleEventSummary): string[] {
  const start = new Date(event.start);
  if (!event.isAllDay) return [toDateKey(start)];

  const end = new Date(event.end);
  const keys: string[] = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    keys.push(toDateKey(d));
    if (keys.length > 62) break; // safety cap against a malformed multi-year event
  }
  return keys;
}

// Google-style rotating event-chip palette (deterministic by event id, so a
// given event keeps the same color across re-renders/month navigation).
const CHIP_COLORS = [
  'bg-[#1a73e8]', 'bg-[#188038]', 'bg-[#e37400]', 'bg-[#8e24aa]', 'bg-[#d50000]', 'bg-[#009688]',
];
function chipColorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

interface GoogleCalendarMonthViewProps {
  // Bumped by the parent's "Sync Now" button to force a re-fetch of whatever
  // month is currently showing, so one click both pushes DMS events out and
  // pulls the latest from Google back into this view.
  refreshToken?: number;
}

export function GoogleCalendarMonthView({ refreshToken = 0 }: GoogleCalendarMonthViewProps) {
  const { showError } = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [events, setEvents] = useState<GoogleEventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<GoogleEventSummary | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-indexed

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiClient.getGoogleCalendarEvents(year, month + 1)
      .then((res) => {
        if (cancelled) return;
        const list = (res.data as { events?: GoogleEventSummary[] } | undefined)?.events ?? [];
        setEvents(list);
      })
      .catch((err) => {
        if (cancelled) return;
        showError(err.response?.data?.error || 'Failed to load your Google Calendar events');
        setEvents([]);
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, refreshToken]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, GoogleEventSummary[]>();
    for (const event of events) {
      for (const key of eventDateKeys(event)) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(event);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.isAllDay === b.isAllDay ? a.start.localeCompare(b.start) : a.isAllDay ? -1 : 1));
    }
    return map;
  }, [events]);

  // Build a 6x7 grid starting from the Sunday on/before the 1st of the month.
  const gridStart = new Date(year, month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const days: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const todayKey = toDateKey(new Date());
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const goToMonth = (offset: number) => setCursor((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + offset); return d; });
  const goToToday = () => { const d = new Date(); d.setDate(1); setCursor(d); setSelectedDayKey(null); };

  const selectedEvents = selectedDayKey ? eventsByDay.get(selectedDayKey) ?? [] : [];

  return (
    <div className="mt-3 rounded-[4px] border border-[#dadce0] bg-white dark:border-white/10 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-[#dadce0] px-3 py-2 dark:border-white/10">
        <div className="flex items-center gap-1">
          <button onClick={() => goToMonth(-1)} className="rounded-full p-1.5 text-[#5f6368] hover:bg-[#f1f3f4] dark:text-slate-400 dark:hover:bg-white/10" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => goToMonth(1)} className="rounded-full p-1.5 text-[#5f6368] hover:bg-[#f1f3f4] dark:text-slate-400 dark:hover:bg-white/10" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-1 text-sm font-medium text-[#3c4043] dark:text-white">{monthLabel}</span>
        </div>
        <button onClick={goToToday} className="rounded-[4px] border border-[#dadce0] px-3 py-1 text-xs font-medium text-[#3c4043] hover:bg-[#f1f3f4] dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10">
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-[#dadce0] dark:border-white/10">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-[#70757a] dark:text-slate-500">
            {label}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${isLoading ? 'opacity-50' : ''}`}>
        {days.map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getMonth() === month;
          const isToday = key === todayKey;
          const dayEvents = eventsByDay.get(key) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedDayKey(key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDayKey(key); }}
              className={`min-h-[76px] cursor-pointer border-b border-r border-[#f1f3f4] p-1 text-left align-top last:border-r-0 dark:border-white/5 ${
                inMonth ? 'bg-white dark:bg-slate-900' : 'bg-[#fafafa] dark:bg-slate-950/40'
              } ${selectedDayKey === key ? 'ring-2 ring-inset ring-[#1a73e8]' : ''} hover:bg-[#f8f9fa] dark:hover:bg-white/5`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? 'bg-[#1a73e8] font-semibold text-white'
                    : inMonth
                      ? 'text-[#3c4043] dark:text-slate-200'
                      : 'text-[#bdc1c6] dark:text-slate-600'
                }`}
              >
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {visible.map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); setOpenEvent(event); }}
                    className={`block w-full truncate rounded-sm px-1 py-0.5 text-left text-[10px] font-medium text-white hover:brightness-110 ${chipColorFor(event.id)}`}
                    title={event.title}
                  >
                    {event.title}
                  </button>
                ))}
                {overflow > 0 && <div className="px-1 text-[10px] font-medium text-[#5f6368] dark:text-slate-400">+{overflow} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDayKey && (
        <div className="border-t border-[#dadce0] px-3 py-2.5 dark:border-white/10">
          <p className="text-xs font-semibold text-[#3c4043] dark:text-white">
            {new Date(`${selectedDayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {selectedEvents.length === 0 ? (
            <p className="mt-1 text-xs text-[#70757a] dark:text-slate-400">No events.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {selectedEvents.map((event) => (
                <li key={event.id}>
                  <button onClick={() => setOpenEvent(event)} className="flex w-full items-start gap-2 rounded p-1 text-left text-xs hover:bg-[#f1f3f4] dark:hover:bg-white/5">
                    <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${chipColorFor(event.id)}`} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[#70757a] dark:text-slate-400">
                          {event.isAllDay
                            ? 'All day'
                            : `${new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                        </span>
                        <span className="text-[#3c4043] dark:text-white">{event.title}</span>
                        {event.conferenceLink && <Video className="h-3 w-3 flex-shrink-0 text-[#188038]" />}
                        {event.attachments && event.attachments.length > 0 && <Paperclip className="h-3 w-3 flex-shrink-0 text-[#5f6368] dark:text-slate-400" />}
                      </div>
                      {event.description && <p className="mt-0.5 truncate text-[#70757a] dark:text-slate-400">{event.description}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openEvent && (
        <ModalOverlay onClose={() => setOpenEvent(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-2xl dark:bg-slate-800"
          >
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-3 w-3 flex-shrink-0 rounded-sm ${chipColorFor(openEvent.id)}`} />
                <div>
                  <h3 className="text-base font-medium text-[#3c4043] dark:text-white">{openEvent.title}</h3>
                  <p className="mt-0.5 text-sm text-[#5f6368] dark:text-slate-400">
                    {new Date(openEvent.start).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                    {' · '}
                    {openEvent.isAllDay
                      ? 'All day'
                      : `${new Date(openEvent.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${new Date(openEvent.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpenEvent(null)} className="flex-shrink-0 rounded p-1 text-[#5f6368] hover:bg-[#f1f3f4] dark:text-slate-400 dark:hover:bg-white/10" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {(openEvent.conferenceLink || openEvent.location || openEvent.description || (openEvent.attachments && openEvent.attachments.length > 0) || (openEvent.attendees && openEvent.attendees.length > 0)) && (
              <div className="space-y-3 border-t border-[#e8eaed] px-4 py-3 dark:border-white/10">
                {openEvent.conferenceLink && (
                  <a
                    href={openEvent.conferenceLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-[4px] bg-[#1a73e8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1765cc]"
                  >
                    <Video className="h-4 w-4" />
                    Join {openEvent.conferenceLabel || 'video meeting'}
                  </a>
                )}
                {openEvent.location && (
                  <p className="flex items-start gap-2 text-sm text-[#3c4043] dark:text-slate-200">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#5f6368] dark:text-slate-400" />
                    {openEvent.location}
                  </p>
                )}
                {openEvent.attendees && openEvent.attendees.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#5f6368] dark:text-slate-400" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-[#5f6368] dark:text-slate-400">{openEvent.attendees.length} guest{openEvent.attendees.length === 1 ? '' : 's'}</p>
                      {[...openEvent.attendees].sort((a, b) => (b.isOrganizer ? 1 : 0) - (a.isOrganizer ? 1 : 0)).map((attendee, i) => (
                        <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[#3c4043] dark:text-slate-200">{attendee.displayName || attendee.email}</span>
                          {attendee.isOrganizer && <span className="text-xs text-[#5f6368] dark:text-slate-400">Organizer</span>}
                          <span className={`text-xs ${RESPONSE_COLORS[attendee.responseStatus] || RESPONSE_COLORS.needsAction}`}>
                            {RESPONSE_LABELS[attendee.responseStatus] || attendee.responseStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {openEvent.description && (
                  <p className="whitespace-pre-wrap break-words text-sm text-[#3c4043] dark:text-slate-200">
                    {linkifyText(openEvent.description)}
                  </p>
                )}
                {openEvent.attachments && openEvent.attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {openEvent.attachments.map((attachment, i) => (
                      <a
                        key={i}
                        href={attachment.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-[4px] border border-[#dadce0] px-3 py-2 text-sm text-[#3c4043] hover:bg-[#f1f3f4] dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
                      >
                        {attachment.iconLink
                          ? <img src={attachment.iconLink} alt="" className="h-4 w-4 flex-shrink-0" />
                          : <Paperclip className="h-4 w-4 flex-shrink-0 text-[#5f6368] dark:text-slate-400" />}
                        <span className="truncate">{attachment.title}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
