import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { GoogleCalendarMonthView } from './GoogleCalendarMonthView';

interface AuditCalendarCardProps {
  // Gates the "sync on login" toggle — a Full Access-only system-wide
  // behavior setting.
  isFullAccess: boolean;
}

interface GoogleCalendarStatus {
  connected: boolean;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  googleConfigured: boolean;
}

// Audit meetings are no longer manually published inside the DMS — they're
// scheduled directly in Google Calendar, with "ISO" in the meeting title so
// the reminder pipeline (GoogleMeetingReminderService) picks them up
// automatically. This card is now just the Google Calendar connection +
// browser for that same calendar, not a separate content store.
export function AuditCalendarCard({ isFullAccess }: AuditCalendarCardProps) {
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [myCalendarRefreshToken, setMyCalendarRefreshToken] = useState(0);
  const [syncOnLogin, setSyncOnLogin] = useState(false);
  const [isSavingSyncOnLogin, setIsSavingSyncOnLogin] = useState(false);

  const loadGoogleStatus = async () => {
    try {
      const res = await apiClient.getGoogleCalendarStatus();
      setGoogleStatus(res.data as GoogleCalendarStatus);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadGoogleStatus();
    if (isFullAccess) {
      apiClient.getAppSetting('sync_calendar_on_login')
        .then((res) => setSyncOnLogin((res.data as { value?: string } | undefined)?.value === 'true'))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullAccess]);

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
      showSuccess(failed > 0 ? `Synced ${pushed} event(s), ${failed} failed` : `Synced ${pushed} event(s) — calendar updated`);
      await loadGoogleStatus();
      setMyCalendarRefreshToken((v) => v + 1);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleSyncOnLogin = async () => {
    const next = !syncOnLogin;
    setIsSavingSyncOnLogin(true);
    try {
      await apiClient.updateAppSetting('sync_calendar_on_login', next ? 'true' : 'false');
      setSyncOnLogin(next);
      showSuccess(next ? 'Every connected user will now sync automatically on login' : 'Sync-on-login turned off');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update this setting');
    } finally {
      setIsSavingSyncOnLogin(false);
    }
  };

  if (isLoading) return <SkeletonCard />;

  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="section-heading flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#3f8bca]" />ISO Certification Journey &amp; Audit Calendar</h2>
            <p className="mt-1 text-xs text-[#718198] dark:text-slate-400">Audit meetings are scheduled directly in Google Calendar.</p>
            <p className="mt-0.5 text-xs text-[#718198] dark:text-slate-400">Connect your Google Calendar using your Si-Ware account.</p>
            <p className="mt-0.5 text-xs text-[#718198] dark:text-slate-400">Click Sync Now to get any new meetings or modifications from your Google Calendar.</p>
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

        {isFullAccess && (
          <label className="mt-3 flex items-center gap-2 text-xs font-medium text-[#52627a] dark:text-slate-400">
            <input
              type="checkbox"
              checked={syncOnLogin}
              disabled={isSavingSyncOnLogin}
              onChange={() => void handleToggleSyncOnLogin()}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
            />
            Automatically sync every connected user's Google Calendar on login
          </label>
        )}

        {googleStatus?.connected ? (
          <GoogleCalendarMonthView refreshToken={myCalendarRefreshToken} />
        ) : (
          <p className="mt-5 px-1 py-4 text-sm text-[#718198]">Connect your Google Calendar to see and be reminded about ISO audit meetings here.</p>
        )}
      </CardBody>
    </Card>
  );
}
