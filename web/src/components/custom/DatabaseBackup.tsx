import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, BellRing, Building2, Calendar, CalendarClock, Check, ClipboardCheck, Clock,
  Download, FileWarning, Folder, Info, LogOut, Megaphone, Power, Save, ScrollText,
  Settings as SettingsIcon, Trash2, Upload, UsersRound,
} from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { ScheduledBackups } from './ScheduledBackups';
import { ModalOverlay } from '../ui/ModalOverlay';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? 'justify-end bg-[#3f66c9]' : 'justify-start bg-[#cbd5e3] dark:bg-slate-700'
      }`}
    >
      <span className="h-5 w-5 flex-shrink-0 rounded-full bg-white shadow" />
    </button>
  );
}

// Replaces the browser's native window.confirm() for destructive actions —
// that dialog is too easy to click through on reflex without reading it,
// which is exactly how a real "Clear All Data" got run by mistake against
// live production data in an earlier session. Requiring the exact word to be
// typed forces a deliberate, read-it-first action instead of a reflex click.
function TypedConfirmModal({
  title, message, warning, confirmWord, confirmLabel, onConfirm, onCancel, isBusy,
}: {
  title: string;
  message: string;
  warning?: string;
  confirmWord: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isBusy?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === confirmWord;

  return (
    <ModalOverlay onClose={onCancel} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-800">
        <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4">
          <h3 className="font-serif text-lg font-bold text-white">{title}</h3>
        </div>
        <div className="space-y-3 px-6 py-4">
          <p className="text-gray-700 dark:text-gray-300">{message}</p>
          {warning && <p className="text-sm font-medium text-red-700 dark:text-red-400">{warning}</p>}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Type <span className="font-mono font-bold text-red-600 dark:text-red-400">{confirmWord}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && matches && !isBusy) onConfirm(); }}
              autoFocus
              disabled={isBusy}
              placeholder={confirmWord}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-50 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-navy-700 dark:bg-navy-900">
          <button
            onClick={onCancel}
            disabled={isBusy}
            className="flex-1 rounded-lg bg-gray-300 px-4 py-2 font-semibold text-gray-900 transition-colors hover:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600 dark:text-white dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || isBusy}
            className="flex-1 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-4 py-2 font-semibold text-white transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
          >
            {isBusy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ClearOption {
  key: string;
  label: string;
  description: string;
  recordCount: number;
}

const CLEAR_GROUP_ICONS: Record<string, typeof Folder> = {
  document_library: Folder,
  approvals: ClipboardCheck,
  tasks: FileWarning,
  reminders: BellRing,
  notifications: Bell,
  announcements: Megaphone,
  groups: UsersRound,
  company_data: Building2,
  audit_trail: ScrollText,
  platform_settings: SettingsIcon,
  google_calendar: Calendar,
};

const BACKUP_CONTENTS: { title: string; description: string }[] = [
  { title: 'Users & Roles', description: 'Accounts, Page Access Roles, folder-role grants' },
  { title: 'Groups', description: 'Groups, members, and subgroup nesting' },
  { title: 'Folders & Documents', description: 'Folder tree and document metadata (titles, Doc IDs, tags, versions)' },
  { title: 'File / Folder Permissions', description: 'Per-user and per-group Access Overrides' },
  { title: 'Tasks / PCARs', description: 'Task records, attachments metadata, and completion history' },
  { title: 'C-Doc Approvals', description: 'Approval batches and per-document stage history' },
  { title: 'Notifications & Reminders', description: 'In-app notification log and scheduled reminders' },
  { title: 'Audit Trail', description: 'Full activity log (WORM-protected, included for restore continuity)' },
  { title: 'Company Data', description: 'Department, Category, and Tag dropdown lists' },
  { title: 'Platform Settings', description: 'General, Login Page, Header, Security, and Notification Configuration' },
  { title: 'Announcements', description: 'Sent announcements and recipient read-state' },
  { title: 'Google Calendar Links', description: 'Per-user calendar connection state (not the Google credentials themselves)' },
];

export function DatabaseBackup() {
  const { showSuccess, showError } = useToast();
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We're doing maintenance — we'll be right back.");
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);

  const [noticeEnabled, setNoticeEnabled] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState('');
  const [noticeStartAt, setNoticeStartAt] = useState('');
  const [noticeEndAt, setNoticeEndAt] = useState('');
  const [isSavingNotice, setIsSavingNotice] = useState(false);
  const [isForcingSignOut, setIsForcingSignOut] = useState(false);

  const loadSystemControls = () => {
    apiClient.getSystemControls()
      .then((res) => {
        if (!res.success || !res.data) return;
        setMaintenanceEnabled(res.data.maintenanceMode.enabled);
        setMaintenanceMessage(res.data.maintenanceMode.message);
        setNoticeEnabled(res.data.scheduledNotice.enabled);
        setNoticeMessage(res.data.scheduledNotice.message ?? '');
        setNoticeStartAt(toDatetimeLocal(res.data.scheduledNotice.startAt));
        setNoticeEndAt(toDatetimeLocal(res.data.scheduledNotice.endAt));
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadSystemControls();
  }, []);

  const handleToggleMaintenance = async (nextEnabled: boolean) => {
    setIsSavingMaintenance(true);
    try {
      const res = await apiClient.updateMaintenanceMode({ enabled: nextEnabled, message: maintenanceMessage });
      if (!res.success) { showError(res.error || 'Failed to update maintenance mode'); return; }
      setMaintenanceEnabled(nextEnabled);
      showSuccess(nextEnabled ? 'Maintenance Mode turned ON' : 'Maintenance Mode turned OFF');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update maintenance mode');
    } finally {
      setIsSavingMaintenance(false);
    }
  };

  const handleSaveMaintenanceMessage = async () => {
    setIsSavingMaintenance(true);
    try {
      const res = await apiClient.updateMaintenanceMode({ enabled: maintenanceEnabled, message: maintenanceMessage });
      if (!res.success) { showError(res.error || 'Failed to save message'); return; }
      showSuccess('Maintenance message saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save message');
    } finally {
      setIsSavingMaintenance(false);
    }
  };

  const handleToggleScheduledNotice = async (nextEnabled: boolean) => {
    if (nextEnabled && (!noticeStartAt || !noticeEndAt)) {
      showError('Set a start and end date/time before enabling the notice');
      return;
    }
    setNoticeEnabled(nextEnabled);
    if (!nextEnabled) {
      try {
        await apiClient.updateScheduledNotice({
          enabled: false,
          message: noticeMessage,
          startAt: noticeStartAt ? new Date(noticeStartAt).toISOString() : null,
          endAt: noticeEndAt ? new Date(noticeEndAt).toISOString() : null,
        });
      } catch {
        // handled below on the next explicit save
      }
    }
  };

  const handleScheduleNotice = async () => {
    if (!noticeStartAt || !noticeEndAt) {
      showError('Start and end date/time are required');
      return;
    }
    setIsSavingNotice(true);
    try {
      const res = await apiClient.updateScheduledNotice({
        enabled: true,
        message: noticeMessage,
        startAt: new Date(noticeStartAt).toISOString(),
        endAt: new Date(noticeEndAt).toISOString(),
      });
      if (!res.success) { showError(res.error || 'Failed to schedule notice'); return; }
      setNoticeEnabled(true);
      showSuccess('Maintenance notice scheduled');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to schedule notice');
    } finally {
      setIsSavingNotice(false);
    }
  };

  const handleCancelNotice = async () => {
    setIsSavingNotice(true);
    try {
      const res = await apiClient.updateScheduledNotice({ enabled: false, message: '', startAt: null, endAt: null });
      if (!res.success) { showError(res.error || 'Failed to cancel notice'); return; }
      setNoticeEnabled(false);
      setNoticeMessage('');
      setNoticeStartAt('');
      setNoticeEndAt('');
      showSuccess('Scheduled notice cancelled');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to cancel notice');
    } finally {
      setIsSavingNotice(false);
    }
  };

  const handleForceSignOut = async () => {
    if (!window.confirm('Sign out every user, including yourself? Everyone will need to log in again.')) return;
    setIsForcingSignOut(true);
    try {
      const res = await apiClient.forceSignOutAll();
      if (!res.success) { showError(res.error || 'Failed to force sign-out'); return; }
      showSuccess(res.message || 'Everyone has been signed out');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to force sign-out');
    } finally {
      setIsForcingSignOut(false);
    }
  };
  const [clearOptions, setClearOptions] = useState<ClearOption[]>([]);
  const [isLoadingClearOptions, setIsLoadingClearOptions] = useState(true);
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [clearGroupConfirm, setClearGroupConfirm] = useState<ClearOption | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  const loadClearOptions = () => {
    setIsLoadingClearOptions(true);
    apiClient.getClearDataOptions()
      .then((res) => { if (res.success) setClearOptions(res.data || []); })
      .catch(() => showError('Failed to load clear-data options'))
      .finally(() => setIsLoadingClearOptions(false));
  };

  useEffect(() => {
    loadClearOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearGroup = async () => {
    const option = clearGroupConfirm;
    if (!option) return;
    setClearingKey(option.key);
    try {
      const res = await apiClient.clearDataGroup(option.key);
      if (!res.success) { showError(res.error || 'Failed to clear data'); return; }
      showSuccess(res.message || `${option.label} data cleared`);
      loadClearOptions();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to clear data');
    } finally {
      setClearingKey(null);
      setClearGroupConfirm(null);
    }
  };

  const handleClearAll = async () => {
    setIsClearingAll(true);
    try {
      const res = await apiClient.clearAllData();
      if (!res.success) { showError(res.error || 'Failed to clear data'); return; }
      showSuccess(res.message || 'All data cleared');
      loadClearOptions();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to clear data');
    } finally {
      setIsClearingAll(false);
      setShowClearAllConfirm(false);
    }
  };

  const loadStatus = () => {
    apiClient.getDatabaseBackupStatus()
      .then((res) => { if (res.success) setLastBackupAt(res.data?.lastBackupAt ?? null); })
      .catch(() => {});
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await apiClient.downloadDatabaseBackup();
      showSuccess('Backup downloaded');
      loadStatus();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to export backup');
    } finally {
      setIsExporting(false);
    }
  };

  const handleChooseFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.sql')) {
      showError('Only .sql backup files (from Download Backup) are supported');
      return;
    }
    setSelectedFile(file);
  };

  const handleRestore = async () => {
    if (!selectedFile) return;
    if (!window.confirm(`This will overwrite ALL current data with "${selectedFile.name}". This cannot be undone. Continue?`)) return;

    setIsRestoring(true);
    try {
      const res = await apiClient.restoreDatabaseBackup(selectedFile);
      if (!res.success) { showError(res.error || 'Failed to restore backup'); return; }
      showSuccess(res.message || 'Database restored successfully');
      setSelectedFile(null);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to restore backup');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#122344] dark:text-white">Database</h2>
        <p className="mt-1 text-sm text-[#718198]">Backup, restore, and manage all system data</p>
      </div>

      <div className="flex gap-3 rounded-[6px] border border-[#bcd6ef] bg-[#eef4fb] p-4 dark:border-blue-900 dark:bg-blue-900/15">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#3f66c9] dark:text-blue-400" />
        <div className="text-sm text-[#2f4a7a] dark:text-blue-200">
          <p className="font-semibold">What&apos;s included in a backup?</p>
          <p className="mt-1">
            Everything this app stores in the database — accounts, folders, document <em>metadata</em>, tasks, approvals, notifications, and every admin setting. Backups download as a single <code className="rounded bg-white/60 px-1 dark:bg-black/20">.sql</code> file.
          </p>
          <p className="mt-1 font-medium">
            Not included: the actual file contents of uploaded documents, attachments, and logos — those live in object storage (MinIO), not the database. A restore brings back every document&apos;s record (title, folder, version history, owner) but not the underlying file bytes.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
            <div className="rounded bg-[#e3f6ee] p-2 text-[#2f8a5e] dark:bg-green-900/30 dark:text-green-300"><Download className="h-4 w-4" /></div>
            <div>
              <h3 className="font-semibold text-[#26334d] dark:text-white">Database Backup</h3>
              <p className="text-sm text-[#718198] dark:text-slate-400">Export a full snapshot of all system data</p>
            </div>
          </div>
          <CardBody className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {BACKUP_CONTENTS.map((item) => (
                <div key={item.title} className="flex items-start gap-2 rounded bg-[#f8fafc] px-3 py-2 dark:bg-slate-800/60">
                  <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#2f8a5e] dark:text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-[#26334d] dark:text-white">{item.title}</p>
                    <p className="text-xs text-[#94a3b8]">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#718198]">
              <Clock className="h-3.5 w-3.5" />
              Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'Never'}
            </div>
            <Button variant="primary" className="w-full" onClick={handleExport} disabled={isExporting} leftIcon={<Download className="h-4 w-4" />}>
              {isExporting ? 'Preparing backup…' : 'Download Backup'}
            </Button>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
            <div className="rounded bg-[#fff1c9] p-2 text-[#b96a08] dark:bg-amber-900/30 dark:text-amber-300"><Upload className="h-4 w-4" /></div>
            <div>
              <h3 className="font-semibold text-[#26334d] dark:text-white">Restore from Backup</h3>
              <p className="text-sm text-[#718198] dark:text-slate-400">Upload a backup file to restore all data</p>
            </div>
          </div>
          <CardBody className="space-y-4">
            <div className="flex gap-3 rounded-[6px] border border-[#f4dd9a] bg-[#fff8e6] p-3 text-sm text-[#8a6116] dark:border-amber-900 dark:bg-amber-900/15 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>Restoring will overwrite all current data with the backup. This action cannot be undone. Download a fresh backup before restoring.</p>
            </div>

            <input ref={fileInputRef} type="file" accept=".sql" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChooseFile(f); e.target.value = ''; }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-[6px] border-2 border-dashed border-[#cbd5e3] bg-[#f8fafc] px-4 py-10 text-center transition-colors hover:bg-[#f1f5f9] dark:border-white/10 dark:bg-slate-800/40 dark:hover:bg-slate-800"
            >
              <Upload className="h-6 w-6 text-[#94a3b8]" />
              <p className="text-sm font-medium text-[#26334d] dark:text-white">{selectedFile ? selectedFile.name : 'Click to upload backup file'}</p>
              <p className="text-xs text-[#94a3b8]">SQL files only (.sql)</p>
            </button>

            <Button
              variant="primary"
              className="w-full !bg-[#c2670c] hover:!bg-[#a5580a]"
              onClick={handleRestore}
              disabled={!selectedFile || isRestoring}
              leftIcon={<Upload className="h-4 w-4" />}
            >
              {isRestoring ? 'Restoring…' : selectedFile ? 'Restore from Backup' : 'Select a backup file above'}
            </Button>
          </CardBody>
        </Card>
      </div>

      <ScheduledBackups />

      {/* Clear Data */}
      <div className="pt-2">
        <h2 className="text-lg font-serif font-bold text-[#c0392b] dark:text-red-400">Clear Data</h2>
        <p className="mt-1 text-sm text-[#718198]">Permanently remove data by module — user accounts and roles are never affected</p>
      </div>

      <div className="flex gap-3 rounded-[6px] border border-[#f5c2c2] bg-[#fdecec] p-4 dark:border-red-900 dark:bg-red-900/15">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#c0392b] dark:text-red-400" />
        <p className="text-sm text-[#8a2a24] dark:text-red-200">
          All clear operations are permanent and cannot be undone. <strong>Download a backup first.</strong> Clearing a module may also remove related records in other modules (e.g. tasks linked to cleared documents), to keep the data consistent. User accounts and roles are never affected by any clear action.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          {isLoadingClearOptions ? (
            <p className="p-8 text-center text-sm text-[#718198]">Loading…</p>
          ) : (
            <div className="divide-y divide-[#e2e8f0] dark:divide-white/10">
              {clearOptions.map((option) => {
                const Icon = CLEAR_GROUP_ICONS[option.key] ?? Folder;
                return (
                  <div key={option.key} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded bg-[#f8fafc] p-2 text-[#52627a] dark:bg-slate-800 dark:text-slate-300"><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <p className="font-medium text-[#26334d] dark:text-white">{option.label}</p>
                        <p className="text-xs text-[#94a3b8]">{option.description} · {option.recordCount.toLocaleString()} record{option.recordCount === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-shrink-0 !border-[#f5c2c2] !text-[#c0392b] hover:!bg-[#fdecec] dark:!border-red-900 dark:!text-red-300"
                      onClick={() => setClearGroupConfirm(option)}
                      disabled={clearingKey === option.key || option.recordCount === 0}
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      {clearingKey === option.key ? 'Clearing…' : 'Clear'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Button
        variant="primary"
        className="w-full !bg-[#c0392b] hover:!bg-[#a5301f]"
        onClick={() => setShowClearAllConfirm(true)}
        disabled={isClearingAll}
        leftIcon={<Trash2 className="h-4 w-4" />}
      >
        {isClearingAll ? 'Clearing everything…' : 'Clear All Data — Every Module'}
      </Button>

      {clearGroupConfirm && (
        <TypedConfirmModal
          title={`Clear "${clearGroupConfirm.label}" Data`}
          message={`Permanently delete all "${clearGroupConfirm.label}" data (${clearGroupConfirm.recordCount.toLocaleString()} record${clearGroupConfirm.recordCount === 1 ? '' : 's'})?`}
          warning="This cannot be undone."
          confirmWord="DELETE"
          confirmLabel="Clear Data"
          isBusy={clearingKey === clearGroupConfirm.key}
          onConfirm={handleClearGroup}
          onCancel={() => setClearGroupConfirm(null)}
        />
      )}

      {showClearAllConfirm && (
        <TypedConfirmModal
          title="Clear All Data — Every Module"
          message="Permanently delete ALL data across every module — Document Library, C-Doc Workflow, PCAR/Tasks, Reminders, Notifications, Announcements, Groups, Company Data, Audit Trail, Platform Settings, and Google Calendar Sync."
          warning="User accounts and roles will NOT be affected, but everything else will be permanently gone. This cannot be undone."
          confirmWord="DELETE ALL"
          confirmLabel="Clear Everything"
          isBusy={isClearingAll}
          onConfirm={handleClearAll}
          onCancel={() => setShowClearAllConfirm(false)}
        />
      )}

      {/* System Controls */}
      <div className="pt-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">System Controls</p>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded bg-[#fff1c9] p-2 text-[#b96a08] dark:bg-amber-900/30 dark:text-amber-300"><Power className="h-4 w-4" /></div>
              <div>
                <p className="font-medium text-[#26334d] dark:text-white">Maintenance Mode</p>
                <p className="text-xs text-[#94a3b8]">{maintenanceEnabled ? 'ON — only Full Access can sign in.' : 'OFF — the app is open to everyone.'}</p>
              </div>
            </div>
            <Button
              variant="primary"
              className={maintenanceEnabled ? '' : '!bg-[#c2670c] hover:!bg-[#a5580a]'}
              onClick={() => handleToggleMaintenance(!maintenanceEnabled)}
              disabled={isSavingMaintenance}
            >
              {maintenanceEnabled ? 'Turn OFF' : 'Turn ON'}
            </Button>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Message shown to users</label>
            <div className="flex gap-2">
              <input type="text" value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} className="field-control h-10 flex-1" />
              <Button variant="secondary" onClick={handleSaveMaintenanceMessage} disabled={isSavingMaintenance}>Save message</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded bg-[#e8f0f8] p-2 text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300"><CalendarClock className="h-4 w-4" /></div>
              <div>
                <p className="font-medium text-[#26334d] dark:text-white">Scheduled Maintenance Notice</p>
                <p className="text-xs text-[#94a3b8]">Announce upcoming maintenance to all users (shows for 72 hours before start time)</p>
              </div>
            </div>
            <Toggle checked={noticeEnabled} onChange={handleToggleScheduledNotice} />
          </div>

          <div className="border-t border-[#e2e8f0] pt-4 dark:border-white/10">
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Announcement Message</label>
            <textarea
              value={noticeMessage}
              onChange={(e) => setNoticeMessage(e.target.value)}
              placeholder="e.g., We have scheduled maintenance on…"
              className="field-control min-h-[80px] w-full py-2"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Start Date &amp; Time</label>
              <input type="datetime-local" value={noticeStartAt} onChange={(e) => setNoticeStartAt(e.target.value)} className="field-control h-10 w-full" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">End Date &amp; Time</label>
              <input type="datetime-local" value={noticeEndAt} onChange={(e) => setNoticeEndAt(e.target.value)} className="field-control h-10 w-full" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="primary" onClick={handleScheduleNotice} disabled={isSavingNotice} leftIcon={<Save className="h-4 w-4" />}>
              {isSavingNotice ? 'Saving…' : 'Schedule Announcement'}
            </Button>
            <Button variant="secondary" onClick={handleCancelNotice} disabled={isSavingNotice}>Cancel</Button>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardBody className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded bg-[#fdecec] p-2 text-[#c0392b] dark:bg-red-900/30 dark:text-red-300"><LogOut className="h-4 w-4" /></div>
            <div>
              <p className="font-medium text-[#26334d] dark:text-white">Force sign-out all users</p>
              <p className="text-xs text-[#94a3b8]">Invalidates every existing session. Everyone (including you) will be redirected to login on their next request.</p>
            </div>
          </div>
          <Button
            variant="primary"
            className="flex-shrink-0 !bg-[#c0392b] hover:!bg-[#a5301f]"
            onClick={handleForceSignOut}
            disabled={isForcingSignOut}
          >
            {isForcingSignOut ? 'Signing out…' : 'Sign out everyone'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
