import { useEffect, useState } from 'react';
import { ListChecks, FileText, CheckCircle2 } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import { useAuth } from '../../hooks/useAuth';
import type { Task, Document, Approval } from '../../types';
import { useNavigate } from 'react-router-dom';

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setIsLoading(true);

        // Mock data for now
        const mockTasks: Task[] = [
          {
            taskId: '1',
            title: 'Review Marketing Plan',
            description: 'Review Q4 marketing plan document',
            taskType: 'correction',
            assignedTo: 'user-1',
            assignedBy: 'user-2',
            status: 'in_progress',
            priority: 'high',
            dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            taskId: '2',
            title: 'Verify Product Specs',
            description: 'Verify technical specifications',
            taskType: 'correction',
            assignedTo: 'user-1',
            assignedBy: 'user-3',
            status: 'open',
            priority: 'medium',
            dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            taskId: '3',
            title: 'Complete RCA',
            description: 'Root cause analysis for recent issue',
            taskType: 'rca',
            assignedTo: 'user-1',
            assignedBy: 'user-2',
            status: 'open',
            priority: 'critical',
            dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        ];

        const mockDocs: Document[] = [
          {
            documentId: '1',
            folderId: 'folder-1',
            name: 'Q4 Marketing Plan',
            fileName: 'q4-plan.pdf',
            fileSize: 2048576,
            contentType: 'application/pdf',
            status: 'released',
            uploadedBy: 'user-2',
            uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            documentId: '2',
            folderId: 'folder-1',
            name: 'Product Specifications',
            fileName: 'specs.docx',
            fileSize: 512000,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 'pending_approval',
            uploadedBy: 'user-3',
            uploadedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        ];

        setTasks(mockTasks);
        setRecentDocs(mockDocs);
        setPendingApprovals([
          {
            approvalId: '1',
            documentId: '2',
            document: mockDocs[1],
            submittedBy: 'user-3',
            submittedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            approvalStatus: 'pending',
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  }, []);

  const taskStats = {
    open: tasks.filter((t) => t.status === 'open').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };

  const getStatusColor = (
    status: 'open' | 'in_progress' | 'done'
  ): 'warning' | 'info' | 'success' => {
    return {
      open: 'warning',
      in_progress: 'info',
      done: 'success',
    }[status] as 'warning' | 'info' | 'success';
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-4xl font-bold mb-2 text-slate-900 dark:text-slate-100">Welcome back, {user?.fullName}!</h1>
        <p className="text-slate-600 dark:text-slate-400 font-serif text-lg">
          Here's an overview of your recent activity and pending tasks.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-1 font-semibold">
                Open Tasks
              </p>
              <p className="text-4xl font-bold text-slate-900 dark:text-slate-100">{taskStats.open}</p>
            </div>
            <ListChecks className="w-12 h-12 bg-gradient-to-br from-navy-900 to-primary-500 text-white rounded-lg p-2" />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-1 font-semibold">
                In Progress
              </p>
              <p className="text-4xl font-bold text-slate-900 dark:text-slate-100">{taskStats.inProgress}</p>
            </div>
            <FileText className="w-12 h-12 bg-gradient-to-br from-navy-900 to-primary-500 text-white rounded-lg p-2" />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-1 font-semibold">
                Pending Approvals
              </p>
              <p className="text-4xl font-bold text-slate-900 dark:text-slate-100">{pendingApprovals.length}</p>
            </div>
            <CheckCircle2 className="w-12 h-12 bg-gradient-to-br from-navy-900 to-primary-500 text-white rounded-lg p-2" />
          </CardBody>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Tasks (Left - Takes 2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">My Tasks</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/tasks')}
            >
              View All
            </Button>
          </div>

          {/* Task Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardBody className="text-center">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Open</p>
                <p className="text-3xl font-bold text-warning mt-1">{taskStats.open}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                  In Progress
                </p>
                <p className="text-3xl font-bold text-info mt-1">{taskStats.inProgress}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Done</p>
                <p className="text-3xl font-bold text-success mt-1">{taskStats.done}</p>
              </CardBody>
            </Card>
          </div>

          {/* Task List */}
          <div className="space-y-2">
            {tasks.slice(0, 3).map((task) => (
              <Card
                key={task.taskId}
                onClick={() => navigate(`/tasks/${task.taskId}`)}
                className="cursor-pointer hover:shadow-lg transition-all"
              >
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{task.title}</h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 font-serif">
                        {task.description}
                      </p>
                    </div>
                    <Badge
                      status={
                        task.priority === 'critical'
                          ? 'error'
                          : task.priority === 'high'
                            ? 'warning'
                            : 'info'
                      }
                      size="sm"
                    >
                      {task.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge
                      status={getStatusColor(task.status)}
                      variant="outline"
                      size="sm"
                    >
                      {task.status.replace('_', ' ')}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Due:{' '}
                      {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>

        {/* Recent Documents & Approvals (Right) */}
        <div className="space-y-6">
          {/* Recent Documents */}
          <div>
            <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-slate-100">Recent Documents</h3>
            <div className="space-y-2">
              {recentDocs.slice(0, 3).map((doc) => (
                <Card
                  key={doc.documentId}
                  onClick={() => navigate(`/documents/${doc.documentId}`)}
                  className="cursor-pointer hover:shadow-lg transition-all"
                >
                  <CardBody className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{doc.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {(doc.fileSize / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <Badge
                        status={
                          doc.status === 'released'
                            ? 'success'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {doc.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>

          {/* Pending Approvals */}
          <div>
            <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-slate-100">Pending Approvals</h3>
            {pendingApprovals.length > 0 ? (
              <div className="space-y-2">
                {pendingApprovals.map((approval) => (
                  <Card
                    key={approval.approvalId}
                    onClick={() => navigate(`/approvals/${approval.approvalId}`)}
                    className="cursor-pointer border-l-4 border-l-warning hover:shadow-lg transition-all"
                  >
                    <CardBody className="space-y-2">
                      <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {approval.document?.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Submitted{' '}
                        {new Date(approval.submittedAt).toLocaleDateString()}
                      </p>
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/approvals/${approval.approvalId}`);
                        }}
                      >
                        Review
                      </Button>
                    </CardBody>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardBody className="text-center py-8">
                  <p className="text-slate-500 dark:text-slate-400">
                    No pending approvals
                  </p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
