import { useEffect, useState } from 'react';
import { Bell, Save } from 'lucide-react';
import { Button, Card, CardBody } from '../ui';
import { useToast } from '../../hooks/useToast';
import { apiClient, type TaskNotificationPolicy, type TaskReminderStage } from '../../utils/api';

const DEFAULT_POLICY: TaskNotificationPolicy = {
  enabled: true,
  creation: { enabled: true, daysBeforeDue: 0, recipients: { assignee: true, folderOwner: false, quality: false, fullAccess: false } },
  firstBeforeDue: { enabled: true, daysBeforeDue: 3, recipients: { assignee: true, folderOwner: false, quality: false, fullAccess: false } },
  secondBeforeDue: { enabled: true, daysBeforeDue: 1, recipients: { assignee: true, folderOwner: true, quality: false, fullAccess: false } },
  dueDate: { enabled: true, daysBeforeDue: 0, recipients: { assignee: true, folderOwner: true, quality: true, fullAccess: true } },
  overdue: { enabled: true, daysBeforeDue: 0, recipients: { assignee: true, folderOwner: true, quality: true, fullAccess: true } },
};

const STAGES: Array<{ key: keyof Omit<TaskNotificationPolicy, 'enabled'>; label: string; editableDays?: boolean }> = [
  { key: 'creation', label: 'When created' },
  { key: 'firstBeforeDue', label: 'Before due date', editableDays: true },
  { key: 'secondBeforeDue', label: 'Before due date', editableDays: true },
  { key: 'dueDate', label: 'On due date' },
  { key: 'overdue', label: 'When overdue' },
];

export function TaskReminderPolicy() {
  const { showError, showSuccess } = useToast();
  const [policy, setPolicy] = useState<TaskNotificationPolicy>(DEFAULT_POLICY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiClient.getTaskNotificationPolicy()
      .then((result) => {
        if (result.success && result.data) setPolicy(result.data as TaskNotificationPolicy);
        else showError(result.error || 'Unable to load the reminder policy');
      })
      .catch((error: any) => showError(error.response?.data?.error || 'Unable to load the reminder policy'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStage = (key: keyof Omit<TaskNotificationPolicy, 'enabled'>, update: Partial<TaskReminderStage>) =>
    setPolicy((current) => ({ ...current, [key]: { ...current[key], ...update } }));

  const updateRecipient = (key: keyof Omit<TaskNotificationPolicy, 'enabled'>, recipient: keyof TaskReminderStage['recipients'], checked: boolean) =>
    setPolicy((current) => ({ ...current, [key]: { ...current[key], recipients: { ...current[key].recipients, [recipient]: checked } } }));

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await apiClient.updateTaskNotificationPolicy(policy);
      if (!result.success) throw new Error(result.error || 'Unable to save the reminder policy');
      setPolicy(result.data as TaskNotificationPolicy);
      showSuccess('Task and PCAR reminder policy saved');
    } catch (error: any) {
      showError(error.response?.data?.error || error.message || 'Unable to save the reminder policy');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <Card><CardBody className="p-8 text-center text-sm text-[#718198]">Loading reminder policy…</CardBody></Card>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Task &amp; PCAR Reminder Policy</h1>
        <p className="page-subtitle">Set the automatic in-app and email reminder schedule for every new Task and PCAR.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 text-[#3f8bca]" />
            <div>
              <h2 className="section-heading">Automatic reminders</h2>
              <p className="mt-1 text-sm text-[#718198] dark:text-slate-400">Creators see the people who will receive each enabled stage in the Task or PCAR form.</p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-[#26334d] dark:text-white">
            <input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-[#3f8bca] focus:ring-[#3f8bca]" />
            Enable automatic reminders
          </label>
        </div>
        <CardBody className="space-y-3">
          {STAGES.map(({ key, label, editableDays }) => {
            const stage = policy[key];
            return <div key={key} className="rounded-[6px] border border-[#e2e8f0] p-4 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <label className="inline-flex min-w-36 items-center gap-2 text-sm font-semibold text-[#26334d] dark:text-white">
                  <input type="checkbox" checked={stage.enabled} onChange={(event) => updateStage(key, { enabled: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-[#3f8bca] focus:ring-[#3f8bca]" />
                  {label}
                </label>
                {editableDays ? <label className="flex items-center gap-2 text-sm text-[#52627a] dark:text-slate-300">Days <input type="number" min="1" max="365" value={stage.daysBeforeDue} onChange={(event) => updateStage(key, { daysBeforeDue: Number(event.target.value) || 1 })} className="field-control h-9 w-20 px-2" /> before due</label>
                  : <span className="text-sm text-[#718198] dark:text-slate-400">{key === 'creation' ? 'Immediately' : key === 'dueDate' ? 'Due date' : 'After the due date'}</span>}
              </div>
              <fieldset disabled={!policy.enabled || !stage.enabled} className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {([['assignee', 'Assignee / group members'], ['folderOwner', 'Linked-folder owner'], ['quality', 'Quality users'], ['fullAccess', 'Full Access users']] as const).map(([recipient, recipientLabel]) => (
                  <label key={recipient} className="inline-flex items-center gap-2 text-xs text-[#52627a] dark:text-slate-300"><input type="checkbox" checked={stage.recipients[recipient]} onChange={(event) => updateRecipient(key, recipient, event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-[#3f8bca] focus:ring-[#3f8bca]" />{recipientLabel}</label>
                ))}
              </fieldset>
            </div>;
          })}
          <div className="flex justify-end pt-1"><Button variant="primary" onClick={save} disabled={isSaving} leftIcon={<Save className="h-4 w-4" />}>{isSaving ? 'Saving…' : 'Save reminder policy'}</Button></div>
        </CardBody>
      </Card>
    </div>
  );
}
