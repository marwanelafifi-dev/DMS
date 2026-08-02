import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useNavigate } from 'react-router-dom';
import { Bell, Settings } from 'lucide-react';
import { apiClient } from '../../utils/api';

interface NotificationItem {
  notificationId: string;
  title: string;
  body?: string | null;
  documentId?: string | null;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const POLL_INTERVAL_MS = 30_000;

export function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showingAll, setShowingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshUnreadCount = () => {
    apiClient.getUnreadNotificationCount()
      .then((res) => setUnreadCount(res.data ?? 0))
      .catch(() => {});
  };

  useEffect(() => {
    refreshUnreadCount();
    pollRef.current = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNotifications = (limit: number) => {
    setIsLoading(true);
    apiClient.getNotifications(limit)
      .then((res) => {
        setNotifications(res.data || []);
        setUnreadCount(res.unreadCount ?? 0);
      })
      .catch(() => setNotifications([]))
      .finally(() => setIsLoading(false));
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setShowingAll(false);
      loadNotifications(20);
    }
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    if (!item.isRead) {
      try {
        await apiClient.markNotificationRead(item.notificationId);
        setNotifications((prev) => prev.map((n) => n.notificationId === item.notificationId ? { ...n, isRead: true } : n));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch { /* non-fatal */ }
    }
    if (item.documentId) {
      setOpen(false);
      navigate(`/documents?preview=${encodeURIComponent(item.documentId)}`);
    }
  };

  const handleViewAll = () => {
    setShowingAll(true);
    loadNotifications(100);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-2 text-[#52627a] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e34d55] px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-[95] flex max-h-[520px] w-96 flex-col overflow-hidden rounded-[6px] border border-[#dbe2ec] bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3 dark:border-white/10">
            <h3 className="text-sm font-semibold text-[#283a7a] dark:text-white">Notifications</h3>
            <button
              onClick={() => { setOpen(false); navigate('/admin/notifications'); }}
              className="flex items-center gap-1.5 text-xs text-[#718198] hover:text-[#3f8bca] dark:text-slate-400 dark:hover:text-blue-300"
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-[#718198] dark:text-slate-400">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#718198] dark:text-slate-400">No notifications yet.</p>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.notificationId}
                  onClick={() => handleNotificationClick(item)}
                  className={`block w-full border-b border-[#f1f4f8] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#f8fafc] dark:border-white/5 dark:hover:bg-white/5 ${!item.isRead ? 'bg-[#eef4fb] dark:bg-blue-500/10' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[#26334d] dark:text-white">{item.title}</p>
                    {!item.isRead && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-[#3f8bca]" />}
                  </div>
                  {item.body && <p className="mt-0.5 text-xs text-[#718198] dark:text-slate-400">{item.body}</p>}
                  <p className="mt-1 text-[11px] text-[#94a3b8] dark:text-slate-500">{timeAgo(item.createdAt)}</p>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[#e2e8f0] px-4 py-2.5 text-center dark:border-white/10">
            {!showingAll ? (
              <button onClick={handleViewAll} className="text-sm font-medium text-[#3f8bca] hover:text-[#2f6f9f]">View all notifications</button>
            ) : (
              <span className="text-xs text-[#94a3b8] dark:text-slate-500">Showing the most recent {notifications.length}</span>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
