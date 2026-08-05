import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { apiClient } from '../../utils/api';

const POLL_INTERVAL_MS = 5 * 60_000;

export function ScheduledNoticeBanner() {
  const [notice, setNotice] = useState<{ message: string; startAt: string; endAt: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const load = () => {
      apiClient.getSystemNotice()
        .then((res) => { if (res.success) setNotice(res.data?.scheduledNotice ?? null); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (!notice || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-[#fff1c9] px-4 py-2 text-sm text-[#8a6116] dark:bg-amber-900/30 dark:text-amber-200">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 flex-shrink-0" />
        <span>
          <strong className="font-semibold">Scheduled maintenance:</strong> {notice.message}{' '}
          <span className="opacity-80">
            ({new Date(notice.startAt).toLocaleString()} – {new Date(notice.endAt).toLocaleString()})
          </span>
        </span>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="flex-shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
