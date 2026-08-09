import { useEffect, useState } from 'react';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Bell, CheckCircle2, Clock, Trash2, Plus, X, Search } from 'lucide-react';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import type { Reminder, ReminderChannel, Task } from '../../types';

const CHANNELS: ReminderChannel[] = ['APP', 'EMAIL', 'BOTH'];

export function Reminders() {
  const { showSuccess, showError } = useToast();

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'sent'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newReminder, setNewReminder] = useState<{ taskId: string; recipientId: string; reminderType: ReminderChannel; dueDate: string }>({
    taskId: '',
    recipientId: DEV_USER_ID,
    reminderType: 'APP',
    dueDate: '',
  });

  useEffect(() => {
    void loadReminders();
    void loadTasks();
    void loadUsers();
  }, []);

  const loadReminders = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getReminders();
      setReminders(Array.isArray(res.data) ? res.data : []);
    } catch {
      showError('Failed to load reminders');
    } finally {
      setIsLoading(false);
    }
  };

  // The API keys reminders to a real task GUID, so the form offers actual tasks
  // instead of asking the user to type an ID that would be rejected.
  const loadTasks = async () => {
    try {
      const res = await apiClient.getTasks();
      setTasks(Array.isArray(res.data) ? (res.data as Task[]) : []);
    } catch {
      showError('Failed to load tasks for the reminder form');
    }
  };

  // Real bug: this form always silently created the reminder for the
  // logged-in user themselves (a hardcoded recipientId) with no way to pick
  // anyone else at all — so reminding a task's actual assignee was never
  // possible, and it looked like "reminders don't notify users" when really
  // no reminder had ever been aimed at another user in the first place.
  const loadUsers = async () => {
    try {
      const res = await apiClient.getUsers({ activeOnly: true });
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      showError('Failed to load users for the reminder form');
    }
  };

  // Defaults the recipient to whoever the task is actually assigned to —
  // the common case — while still leaving it fully overridable below.
  const handleSelectTask = (taskId: string) => {
    const task = tasks.find((t) => t.taskId === taskId);
    setNewReminder((prev) => ({ ...prev, taskId, recipientId: task?.assignedTo || prev.recipientId }));
  };

  const handleCreateReminder = async () => {
    if (!newReminder.taskId || !newReminder.dueDate || !newReminder.recipientId) {
      showError('Task, recipient, and due date are required');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.createReminder({
        taskId: newReminder.taskId,
        recipientId: newReminder.recipientId,
        reminderType: newReminder.reminderType,
        dueDate: new Date(newReminder.dueDate).toISOString(),
      });
      showSuccess('Reminder created');
      setShowAddForm(false);
      setNewReminder({ taskId: '', recipientId: DEV_USER_ID, reminderType: 'APP', dueDate: '' });
      await loadReminders();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create reminder');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendReminder = async (reminderId: string) => {
    try {
      await apiClient.sendReminder(reminderId);
      showSuccess('Reminder marked as sent');
      await loadReminders();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to send reminder');
    }
  };

  const handleDeleteReminder = async (reminderId: string) => {
    try {
      await apiClient.deleteReminder(reminderId);
      showSuccess('Reminder deleted');
      await loadReminders();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete reminder');
    }
  };

  const reminderLabel = (reminder: Reminder) =>
    reminder.task?.title ?? `Task ${reminder.taskId?.slice(0, 8) ?? 'unknown'}`;

  const filteredReminders = reminders.filter((reminder) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = query === '' || reminderLabel(reminder).toLowerCase().includes(query);
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'pending' && !reminder.isSent) ||
      (filterStatus === 'sent' && reminder.isSent);
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: reminders.length,
    pending: reminders.filter(r => !r.isSent).length,
    sent: reminders.filter(r => r.isSent).length,
  };

  const formatDate = (dateString?: string | null) => {
    const time = dateString ? new Date(dateString).getTime() : Number.NaN;
    if (Number.isNaN(time)) return 'No date';
    return new Date(time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Reminders</h1>
        <Button variant="primary" size="md" onClick={() => setShowAddForm(true)}>
          <Plus className="w-4 h-4 mr-2 inline" />
          New Reminder
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Reminders</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{stats.total}</p>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <Bell className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-yellow-500">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{stats.pending}</p>
            </div>
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-green-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Sent</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{stats.sent}</p>
            </div>
            <div className="bg-green-600 p-3 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search reminders..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="px-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
        >
          <option value="all">All Reminders</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
        </select>
      </div>

      {/* Reminders List */}
      {isLoading ? (
        <SkeletonTable />
      ) : filteredReminders.length === 0 ? (
        <Card className="bg-white dark:bg-navy-950">
          <CardBody className="text-center py-12">
            <Bell className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No reminders found</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredReminders.map((reminder) => (
            <Card key={reminder.reminderId} className="hover:shadow-md transition-shadow">
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <p className="font-medium text-navy-900 dark:text-white truncate">
                        {reminderLabel(reminder)}
                      </p>
                      <Badge
                        status={reminder.isSent ? 'success' : 'warning'}
                        variant="outline"
                      >
                        {reminder.isSent ? 'Sent' : 'Pending'}
                      </Badge>
                      <Badge status="default" variant="outline">{reminder.reminderType}</Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Due: {formatDate(reminder.dueDate)}
                      {reminder.isSent && reminder.sentAt && ` · Sent ${formatDate(reminder.sentAt)}`}
                    </p>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {!reminder.isSent && (
                      <button
                        onClick={() => handleSendReminder(reminder.reminderId)}
                        className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                        title="Mark as sent"
                        aria-label={`Mark ${reminderLabel(reminder)} as sent`}
                      >
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteReminder(reminder.reminderId)}
                      className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="Delete"
                      aria-label={`Delete reminder for ${reminderLabel(reminder)}`}
                    >
                      <Trash2 className="w-5 h-5 text-red-600" />
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Add Reminder Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Create New Reminder</h2>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label htmlFor="reminder-task" className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Task *</label>
                <select
                  id="reminder-task"
                  value={newReminder.taskId}
                  onChange={(e) => handleSelectTask(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a task…</option>
                  {tasks.map((task) => (
                    <option key={task.taskId} value={task.taskId}>{task.title}</option>
                  ))}
                </select>
                {tasks.length === 0 && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    No tasks available yet — create a task first.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="reminder-recipient" className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Remind *</label>
                <select
                  id="reminder-recipient"
                  value={newReminder.recipientId}
                  onChange={(e) => setNewReminder({ ...newReminder, recipientId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select who this reminder is for…</option>
                  {users.map((user) => (
                    <option key={user.userId} value={user.userId}>{user.fullName}{user.userId === DEV_USER_ID ? ' (you)' : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="reminder-channel" className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Delivery *</label>
                <select
                  id="reminder-channel"
                  value={newReminder.reminderType}
                  onChange={(e) => setNewReminder({ ...newReminder, reminderType: e.target.value as ReminderChannel })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="reminder-due" className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Due Date *</label>
                <input
                  id="reminder-due"
                  type="datetime-local"
                  value={newReminder.dueDate}
                  onChange={(e) => setNewReminder({ ...newReminder, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setShowAddForm(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleCreateReminder} disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
