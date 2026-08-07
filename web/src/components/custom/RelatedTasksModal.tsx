import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, AlertCircle, ClipboardList } from 'lucide-react';
import { Button, Badge } from '../ui';
import { apiClient } from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';

interface RelatedTaskRow {
  taskId: string;
  title: string;
  description?: string | null;
  taskType: string;
  riskSeverity?: string | null;
  assignedToUser?: { userId: string; fullName: string } | null;
  submittedByName?: string | null;
  dueDate?: string | null;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  completedByName?: string | null;
}

interface RelatedTasksModalProps {
  documentId: string;
  fileName: string;
  onClose: () => void;
}

const STATUS_BADGE: Record<string, 'default' | 'warning' | 'success'> = {
  open: 'default',
  in_progress: 'warning',
  completed: 'success',
};

// Every correction task raised against this document across every C-Doc
// Workflow cycle, oldest edits included — the point is to see the full
// history, not just whatever's currently open.
export function RelatedTasksModal({ documentId, fileName, onClose }: RelatedTasksModalProps) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<RelatedTaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const goToTask = (taskId: string) => {
    onClose();
    navigate(`/tasks?highlight=${taskId}`);
  };

  const load = () => {
    setIsLoading(true);
    setError(null);
    apiClient.getTasksByDocument(documentId)
      .then((res) => {
        if (!res.success) throw new Error(res.error);
        setTasks(res.data || []);
      })
      .catch((err: any) => setError(err?.response?.data?.error || err.message || 'Failed to load related tasks'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white"><ClipboardList className="h-5 w-5" /> Related Tasks</h2>
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">{fileName}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
          {isLoading ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No tasks have ever been raised against this document.</p>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.taskId} className="rounded border border-gray-200 px-4 py-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => goToTask(task.taskId)}
                        className="truncate text-left text-sm font-semibold text-navy-900 hover:underline dark:text-white"
                        title="Open this task"
                      >
                        {task.title}
                      </button>
                      {task.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-500 dark:text-slate-400">{task.description}</p>}
                    </div>
                    <Badge status={STATUS_BADGE[task.status] ?? 'default'} variant="outline">{task.status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                    <span>Type: {task.taskType}</span>
                    {task.riskSeverity && <span>Priority: {task.riskSeverity}</span>}
                    <span>Submitted by: {task.submittedByName ?? 'Unknown'}</span>
                    <span>Assigned to: {task.assignedToUser?.fullName ?? 'Unassigned'}</span>
                    <span>Created: {formatDateTime(task.createdAt)}</span>
                    {task.dueDate && <span>Due: {formatDateTime(task.dueDate)}</span>}
                    {task.completedAt && <span>Completed: {formatDateTime(task.completedAt)}{task.completedByName ? ` by ${task.completedByName}` : ''}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <Button onClick={onClose} variant="secondary">Close</Button>
        </div>
      </div>
    </div>
  );
}
