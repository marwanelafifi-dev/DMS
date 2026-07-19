import { useEffect, useState } from 'react';
import { Card, CardBody, Button, Badge } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Plus, Search, CheckCircle2, Clock, AlertCircle, X, Edit2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient, DEV_USER_ID } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import type { Task } from '../../types';

const PAGE_SIZE = 10;

interface TaskForm {
  title: string;
  description: string;
  taskType: 'correction' | 'rca' | 'audit_action';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
  assignedTo: string;
  documentId?: string;
}

const PRIORITY_COLORS = {
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
} as const;


export function Tasks() {
  const { showSuccess, showError } = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTask, setNewTask] = useState<TaskForm>({
    title: '',
    description: '',
    taskType: 'correction',
    priority: 'medium',
    dueDate: '',
    assignedTo: DEV_USER_ID,
    documentId: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TaskForm>>({});

  const [statusChangeConfirm, setStatusChangeConfirm] = useState<{ taskId?: string; newStatus?: Task['status']; taskTitle?: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskId?: string; taskTitle?: string }>({});

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadTasks = async (targetPage = page) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getTasks({ page: targetPage, pageSize: PAGE_SIZE });
      const allTasks = res.data || [];
      setTasks(allTasks);
      setTotalCount(res.totalCount ?? allTasks.length ?? 0);
      setTotalPages(res.totalPages ?? 1);
    } catch (err: any) {
      setLoadError(err.response?.data?.error || 'Failed to reach the API');
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await apiClient.getUsers({ activeOnly: true });
      setUsers(res.data || []);
    } catch (err) {
      // Silently fail - users list is just for assignment dropdown
    }
  };

  useEffect(() => {
    loadTasks(page);
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = !statusFilter || task.status === statusFilter;
    const matchesPriority = !priorityFilter || task.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const taskStats = {
    total: totalCount,
    open: tasks.filter(t => t.status === 'open').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length,
    overdue: tasks.filter(t => {
      const due = new Date(t.dueDate);
      return t.status !== 'done' && due < new Date();
    }).length,
  };

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) {
      showError('Task title is required');
      return;
    }
    if (!newTask.dueDate) {
      showError('Due date is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.createTask({
        ...newTask,
        assignedBy: DEV_USER_ID,
      });
      showSuccess('Task created successfully');
      setShowAddForm(false);
      setNewTask({
        title: '',
        description: '',
        taskType: 'correction',
        priority: 'medium',
        dueDate: '',
        assignedTo: DEV_USER_ID,
        documentId: '',
      });
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    const task = tasks.find(t => t.taskId === taskId);
    if (!task) return;

    try {
      if (newStatus === 'done') {
        await apiClient.completeTask(taskId);
      } else {
        await apiClient.updateTask(taskId, { status: newStatus });
      }
      showSuccess('Task status updated');
      setStatusChangeConfirm({});
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update task');
    }
  };

  const handleEditTask = (task: Task) => {
    setEditingId(task.taskId);
    setEditData({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await apiClient.updateTask(editingId, editData);
      showSuccess('Task updated successfully');
      setEditingId(null);
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await apiClient.updateTask(taskId, { status: 'done' });
      showSuccess('Task marked as complete');
      setDeleteConfirm({});
      loadTasks();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete task');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusBadgeColor = (status: Task['status']): any => {
    switch (status) {
      case 'open':
        return 'info';
      case 'in_progress':
        return 'warning';
      case 'done':
        return 'success';
      default:
        return 'default';
    }
  };

  const isOverdue = (dueDate: string, status: Task['status']) => {
    return status !== 'done' && new Date(dueDate) < new Date();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">My Tasks</h1>
        <Button variant="primary" size="md" onClick={() => setShowAddForm(true)}>
          <Plus className="w-4 h-4 mr-2 inline" />
          New Task
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-navy-700">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Tasks</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.total}</p>
            </div>
            <div className="bg-navy-800 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-blue-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Open</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.open}</p>
            </div>
            <div className="bg-blue-600 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-yellow-500">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">In Progress</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.inProgress}</p>
            </div>
            <div className="bg-yellow-500 p-3 rounded-lg">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-green-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.done}</p>
            </div>
            <div className="bg-green-600 p-3 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-white dark:bg-navy-950 border-l-4 border-l-red-600">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Overdue</p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{taskStats.overdue}</p>
            </div>
            <div className="bg-red-600 p-3 rounded-lg">
              <AlertCircle className="w-6 h-6 text-white" />
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
            placeholder="Search tasks..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="px-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Completed</option>
        </select>

        <select
          className="px-4 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Tasks Table */}
      {loadError ? (
        <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
          <CardBody>
            <p className="text-red-700 dark:text-red-300">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => loadTasks()} className="mt-4">
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : isLoading ? (
        <SkeletonTable />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 dark:bg-navy-900 border-b border-gray-200 dark:border-navy-700">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Title</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Priority</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Due Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-navy-900 dark:text-white">Type</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-navy-900 dark:text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No tasks found
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task, idx) => (
                    <tr
                      key={task.taskId}
                      className={`border-b border-gray-200 dark:border-navy-700 ${
                        idx % 2 === 1 ? 'bg-gray-50 dark:bg-navy-850' : 'bg-white dark:bg-navy-950'
                      } hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors`}
                    >
                      <td className="px-6 py-4">
                        {editingId === task.taskId ? (
                          <input
                            type="text"
                            value={editData.title || ''}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          />
                        ) : (
                          <div>
                            <p className="font-medium text-navy-900 dark:text-white">{task.title}</p>
                            {task.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-400">{task.description}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={getStatusBadgeColor(task.status)} variant="outline">
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId ? (
                          <select
                            value={editData.priority || 'medium'}
                            onChange={(e) => setEditData({ ...editData, priority: e.target.value as any })}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                          </select>
                        ) : (
                          <Badge status={PRIORITY_COLORS[task.priority]} variant="outline">
                            {task.priority}
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingId === task.taskId ? (
                          <input
                            type="date"
                            value={editData.dueDate || task.dueDate?.split('T')[0]}
                            onChange={(e) => setEditData({ ...editData, dueDate: e.target.value })}
                            className="px-3 py-2 border border-gray-200 dark:border-navy-700 rounded bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                          />
                        ) : (
                          <div>
                            <p className={`text-sm ${isOverdue(task.dueDate, task.status) ? 'text-red-600 font-semibold' : 'text-gray-600 dark:text-gray-400'}`}>
                              {formatDate(task.dueDate)}
                            </p>
                            {isOverdue(task.dueDate, task.status) && (
                              <p className="text-xs text-red-600 font-semibold">Overdue</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-600 dark:text-gray-400">{task.taskType.replace('_', ' ')}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          {editingId === task.taskId ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleSaveEdit}
                                className="!px-3"
                              >
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                className="!px-3"
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              {task.status !== 'done' && (
                                <button
                                  onClick={() => setStatusChangeConfirm({ taskId: task.taskId, newStatus: 'done', taskTitle: task.title })}
                                  className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors text-gray-600 dark:text-gray-300"
                                  title="Mark as complete"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleEditTask(task)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-navy-700 rounded transition-colors text-gray-600 dark:text-gray-300"
                                title="Edit"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ taskId: task.taskId, taskTitle: task.title })}
                                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-navy-700 bg-gray-50 dark:bg-navy-900">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages} ({totalCount} total tasks)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4 mr-1 inline" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1 inline" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add Task Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-xl font-serif font-bold text-navy-900 dark:text-white">Create New Task</h2>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Task Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Fix QMS documentation"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Description</label>
                <textarea
                  placeholder="Task details..."
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Type</label>
                  <select
                    value={newTask.taskType}
                    onChange={(e) => setNewTask({ ...newTask, taskType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    <option value="correction">Correction</option>
                    <option value="rca">RCA</option>
                    <option value="audit_action">Audit Action</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Due Date *</label>
                <input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">Assigned To</label>
                <select
                  value={newTask.assignedTo}
                  onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white"
                >
                  {users.map(user => (
                    <option key={user.userId} value={user.userId}>{user.fullName}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="secondary"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateTask}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Task'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Status Change Confirmation Modal */}
      {statusChangeConfirm.taskId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Mark as Complete</h2>
              <button
                onClick={() => setStatusChangeConfirm({})}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Mark <span className="font-semibold">"{statusChangeConfirm.taskTitle}"</span> as completed?
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setStatusChangeConfirm({})}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => statusChangeConfirm.taskId && handleStatusChange(statusChangeConfirm.taskId, 'done')}
                >
                  Mark Complete
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.taskId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">Delete Task</h2>
              <button
                onClick={() => setDeleteConfirm({})}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <CardBody>
              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Are you sure you want to delete <span className="font-semibold">"{deleteConfirm.taskTitle}"</span>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteConfirm({})}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => deleteConfirm.taskId && handleDeleteTask(deleteConfirm.taskId)}
                >
                  Delete Task
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
