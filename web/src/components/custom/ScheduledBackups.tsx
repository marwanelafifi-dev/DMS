import { useEffect, useState } from 'react';
import { Calendar, Clock, Download, Folder, Play, Save } from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

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

const FREQUENCIES = [
  { key: 'hourly', label: 'Hourly' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface BackupFile {
  fileName: string;
  sizeBytes: number;
  lastModified: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ScheduledBackups() {
  const { showSuccess, showError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [frequencies, setFrequencies] = useState<string[]>([]);
  const [time, setTime] = useState('02:00');
  const [dayOfWeek, setDayOfWeek] = useState('Sunday');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [keepLastN, setKeepLastN] = useState(30);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const load = () => {
    setIsLoading(true);
    apiClient.getBackupSchedule()
      .then((res) => {
        if (!res.success || !res.data) return;
        const { config, files: fileList } = res.data;
        setEnabled(config.enabled);
        setFrequencies(config.frequencies ?? []);
        setTime(config.time);
        setDayOfWeek(config.dayOfWeek);
        setDayOfMonth(config.dayOfMonth);
        setKeepLastN(config.keepLastN);
        setFiles(fileList ?? []);
      })
      .catch(() => showError('Failed to load backup schedule'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFrequency = (key: string) => {
    setFrequencies((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await apiClient.updateBackupSchedule({ enabled, frequencies, time, dayOfWeek, dayOfMonth, keepLastN });
      if (!res.success) { showError(res.error || 'Failed to save schedule'); return; }
      showSuccess('Backup schedule saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save schedule');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunningNow(true);
    try {
      const res = await apiClient.runScheduledBackupNow();
      if (!res.success) { showError(res.error || 'Failed to run backup'); return; }
      showSuccess(`Backup saved as ${res.data?.fileName}`);
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to run backup');
    } finally {
      setIsRunningNow(false);
    }
  };

  const handleDownload = async (fileName: string) => {
    setDownloadingFile(fileName);
    try {
      await apiClient.downloadScheduledBackupFile(fileName);
    } catch {
      showError('Failed to download backup file');
    } finally {
      setDownloadingFile(null);
    }
  };

  const lastBackup = files[0];

  if (isLoading) {
    return <Card><CardBody className="p-8 text-center text-sm text-[#718198]">Loading…</CardBody></Card>;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
        <div className="rounded bg-[#e8f0f8] p-2 text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300"><Calendar className="h-4 w-4" /></div>
        <div>
          <h3 className="font-semibold text-[#26334d] dark:text-white">Scheduled Backups</h3>
          <p className="text-sm text-[#718198] dark:text-slate-400">Automatic backups saved to object storage under <code className="rounded bg-[#f8fafc] px-1 dark:bg-slate-800">backups/scheduled/</code></p>
        </div>
      </div>

      <CardBody className="space-y-5">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 dark:border-white/10">
          <div>
            <p className="font-medium text-[#26334d] dark:text-white">Enable Automatic Backups</p>
            <p className="text-xs text-[#94a3b8]">The server runs a background check every 5 minutes and triggers a backup when due</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#26334d] dark:text-white">Frequency <span className="font-normal text-[#94a3b8]">(select one or more)</span></p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FREQUENCIES.map((f) => {
              const selected = frequencies.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleFrequency(f.key)}
                  className={`rounded-[6px] px-4 py-2.5 text-sm font-semibold transition-colors ${
                    selected
                      ? 'bg-[#3f66c9] text-white'
                      : 'bg-[#f1f5f9] text-[#52627a] hover:bg-[#e2e8f0] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Time (24h)</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field-control h-10 w-full" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Day of Week</label>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} disabled={!frequencies.includes('weekly')} className="field-control h-10 w-full disabled:opacity-50">
              {DAYS_OF_WEEK.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Day of Month</label>
            <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} disabled={!frequencies.includes('monthly')} className="field-control h-10 w-full disabled:opacity-50">
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Keep last N backups (0 = keep all)</label>
          <input type="number" min={0} value={keepLastN} onChange={(e) => setKeepLastN(Math.max(0, Number(e.target.value)))} className="field-control h-10 w-full sm:w-48" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={handleSave} disabled={isSaving} leftIcon={<Save className="h-4 w-4" />}>
            {isSaving ? 'Saving…' : 'Save Schedule'}
          </Button>
          <Button variant="secondary" onClick={handleRunNow} disabled={isRunningNow} leftIcon={<Play className="h-4 w-4" />}>
            {isRunningNow ? 'Running…' : 'Run Backup Now'}
          </Button>
        </div>

        <div className="border-t border-[#e2e8f0] pt-4 dark:border-white/10">
          <div className="flex items-center gap-1.5 text-xs text-[#718198]">
            <Clock className="h-3.5 w-3.5" />
            {lastBackup
              ? <>Last backup: <strong>{lastBackup.lastModified ? new Date(lastBackup.lastModified).toLocaleString() : ''}</strong> — {lastBackup.fileName}</>
              : 'No backups saved yet'}
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
            <Folder className="h-3.5 w-3.5" /> Saved backup files ({files.length})
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto rounded border border-[#e2e8f0] dark:border-white/10">
            {files.length === 0 ? (
              <p className="p-4 text-center text-sm text-[#94a3b8]">No saved backup files</p>
            ) : (
              <div className="divide-y divide-[#e2e8f0] dark:divide-white/10">
                {files.map((file) => (
                  <div key={file.fileName} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#26334d] dark:text-white">{file.fileName}</p>
                      <p className="text-xs text-[#94a3b8]">{formatSize(file.sizeBytes)} · {file.lastModified ? new Date(file.lastModified).toLocaleString() : ''}</p>
                    </div>
                    <button
                      onClick={() => handleDownload(file.fileName)}
                      disabled={downloadingFile === file.fileName}
                      className="flex-shrink-0 rounded p-2 text-[#52627a] hover:bg-[#f1f5f9] disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
