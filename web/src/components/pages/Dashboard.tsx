import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, Download, FilePlus2, TriangleAlert } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import type { Task, Document, Approval } from '../../types';
import { useNavigate } from 'react-router-dom';

export function Dashboard() {
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

  const exportDashboard = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Total Documents', String(recentDocs.length)],
      ['Pending Approvals', String(pendingApprovals.length)],
      ['Checked Out', String(recentDocs.filter((doc) => doc.checkoutStatus === 'checked_out').length)],
      ['Open PCARs', String(taskStats.open + taskStats.inProgress)],
    ];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'dms-dashboard.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const analytics = [
    { week: 'W1', approved: 54, review: 12, rejected: 3 },
    { week: 'W2', approved: 67, review: 18, rejected: 4 },
    { week: 'W3', approved: 60, review: 22, rejected: 5 },
    { week: 'W4', approved: 73, review: 11, rejected: 4 },
    { week: 'W5', approved: 85, review: 17, rejected: 5 },
    { week: 'W6', approved: 70, review: 22, rejected: 3 },
  ];

  const metrics = [
    { label: 'Total Documents', value: recentDocs.length, detail: '▲ 2.4% this week', detailClass: 'text-[#319d68]' },
    { label: 'Pending Approvals', value: pendingApprovals.length, detail: '▲ 5 since yesterday', detailClass: 'text-[#d27a08]' },
    { label: 'Checked Out', value: recentDocs.filter((doc) => doc.checkoutStatus === 'checked_out').length, detail: '3 overdue', detailClass: 'text-[#64748b]' },
    { label: 'Open PCARs', value: taskStats.open + taskStats.inProgress, detail: `${tasks.filter((task) => task.priority === 'critical').length} critical`, detailClass: 'text-[#e24c53]' },
  ];

  const taskIcons = [Clock3, CheckCircle2, TriangleAlert, ClipboardCheck];
  const taskColors = ['border-[#f2b51d] text-[#e4a400]', 'border-[#3f8bca] text-[#3f8bca]', 'border-[#ef6b70] text-[#ef5b61]', 'border-[#cbd5e3] text-[#8292aa]'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">Dashboard</h1>
          <p className="page-subtitle">System overview · Last sync {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, 09:41</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportDashboard} leftIcon={<Download className="h-4 w-4" />}>Export</Button>
          <Button onClick={() => navigate('/documents')} leftIcon={<FilePlus2 className="h-4 w-4" />}>New Document</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <Card key={metric.label}>
            <CardBody className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-[#687a95]">{metric.label}</div>
              <div className={`mt-2 text-[29px] font-semibold leading-none ${index === 1 ? 'text-[#3f8bca]' : index === 3 ? 'text-[#e24c53]' : 'text-[#2d3d80]'}`}>{metric.value.toLocaleString()}</div>
              <div className={`mt-3 text-xs ${metric.detailClass}`}>{metric.detail}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(330px,0.85fr)]">
        <Card>
          <CardBody className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="section-heading">Approval-Cycle Analytics</h2>
              <select className="field-control h-8 px-3 text-xs" defaultValue="30" aria-label="Analytics date range">
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>
            <div className="mt-7 flex h-[235px] items-end justify-around gap-3 px-2 sm:px-8">
              {analytics.map((item) => (
                <div key={item.week} className="flex h-full flex-1 flex-col items-center justify-end">
                  <div className="flex w-8 flex-col justify-end overflow-hidden rounded-[4px] sm:w-12" style={{ height: `${item.approved + item.review + item.rejected}%` }}>
                    <div className="bg-[#ef6b70]" style={{ height: `${item.rejected}%` }} />
                    <div className="bg-[#3f87c2]" style={{ height: `${item.review}%` }} />
                    <div className="flex-1 bg-[#2f3e83]" />
                  </div>
                  <div className="mt-3 text-xs text-[#7b8ba3]">{item.week}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-5 text-xs text-[#52627a]">
              <span className="flex items-center gap-2"><i className="h-3 w-3 rounded-sm bg-[#2f3e83]" />Approved</span>
              <span className="flex items-center gap-2"><i className="h-3 w-3 rounded-sm bg-[#3f87c2]" />In Review</span>
              <span className="flex items-center gap-2"><i className="h-3 w-3 rounded-sm bg-[#ef6b70]" />Rejected</span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="section-heading">My Tasks</h2>
              <button onClick={() => navigate('/tasks')} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
            </div>
            <div className="mt-3 space-y-2">
              {tasks.slice(0, 4).map((task, index) => {
                const Icon = taskIcons[index % taskIcons.length];
                return (
                  <button key={task.taskId} onClick={() => navigate('/tasks')} className={`flex w-full gap-3 rounded-[4px] border-l-2 px-3 py-2.5 text-left hover:bg-[#f8fafc] ${taskColors[index % taskColors.length]}`}>
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#26334d] dark:text-white">{task.title}</span>
                      <span className="mt-1 block text-xs text-[#718198]">Due {new Date(task.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {task.taskType.replace('_', ' ')}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
