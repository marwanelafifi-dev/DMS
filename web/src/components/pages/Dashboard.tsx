import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, FileClock, TriangleAlert } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { SkeletonCard } from '../ui/Skeleton';
import type { Task, Document, Approval } from '../../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuditCalendarCard } from '../custom/AuditCalendarCard';

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const currentUserId = user?.userId ?? '';

  useEffect(() => {
    if (!currentUserId) return;

    const loadDashboardData = async () => {
      try {
        setIsLoading(true);

        // Mock data for now — scoped to the signed-in user (currentUserId)
        const mockTasks: Task[] = [
          {
            taskId: '1',
            title: 'Review Marketing Plan',
            description: 'Review Q4 marketing plan document',
            taskType: 'correction',
            assignedTo: currentUserId,
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
            assignedTo: currentUserId,
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
            assignedTo: currentUserId,
            assignedBy: 'user-2',
            status: 'open',
            priority: 'critical',
            dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
          },
          {
            taskId: '4',
            title: 'Approve Supplier Audit Checklist',
            description: 'Legacy supplier audit checklist needs sign-off',
            taskType: 'audit_action',
            assignedTo: 'user-quality',
            assignedBy: currentUserId,
            status: 'open',
            priority: 'low',
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
          {
            documentId: '3',
            folderId: 'folder-1',
            name: 'Supplier Audit Checklist',
            fileName: 'supplier-audit-checklist.doc',
            fileSize: 358400,
            contentType: 'application/msword',
            status: 'pending_approval',
            uploadedBy: 'user-audit',
            uploadedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          },
          {
            documentId: '4',
            folderId: 'folder-1',
            name: 'Calibration Procedure SOP-204',
            fileName: 'calibration-procedure-sop-204.pdf',
            fileSize: 421888,
            contentType: 'application/pdf',
            status: 'released',
            uploadedBy: currentUserId,
            uploadedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            checkoutStatus: 'checked_out',
            checkedOutBy: currentUserId,
            checkedOutAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
          },
          {
            documentId: '5',
            folderId: 'folder-1',
            name: 'Training Records Q3',
            fileName: 'training-records-q3.xlsx',
            fileSize: 289792,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            status: 'pending_approval',
            department: 'Quality Assurance',
            uploadedBy: currentUserId,
            uploadedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
          },
          {
            documentId: '6',
            folderId: 'folder-1',
            name: 'Vendor Onboarding Form',
            fileName: 'vendor-onboarding-form.docx',
            fileSize: 154624,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            status: 'pending_approval',
            department: 'Operations',
            uploadedBy: currentUserId,
            uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
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
            submittedByUser: { userId: 'user-3', fullName: 'Omar Hassan', email: 'omar.hassan@si-ware.com', role: 'Writer', isActive: true, createdAt: new Date().toISOString() },
            submittedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            approvalStatus: 'pending',
          },
          {
            approvalId: '2',
            documentId: '3',
            document: mockDocs[2],
            submittedBy: 'user-audit',
            submittedByUser: { userId: 'user-audit', fullName: 'Rami Faraj', email: 'rami.faraj@si-ware.com', role: 'Writer', isActive: true, createdAt: new Date().toISOString() },
            submittedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            approvalStatus: 'pending',
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  }, [currentUserId]);

  const myTasks = tasks.filter((t) => t.assignedTo === currentUserId);
  const taskStats = {
    open: myTasks.filter((t) => t.status === 'open').length,
    inProgress: myTasks.filter((t) => t.status === 'in_progress').length,
    done: myTasks.filter((t) => t.status === 'done').length,
    overdue: myTasks.filter((t) => t.status !== 'done' && new Date(t.dueDate).getTime() < Date.now()).length,
  };
  const myCheckedOutDocs = recentDocs.filter((doc) => doc.checkoutStatus === 'checked_out' && doc.checkedOutBy === currentUserId);
  const mySubmissionsInReview = recentDocs.filter((doc) => doc.uploadedBy === currentUserId && doc.status === 'pending_approval');
  const reviewStageFor = (doc: Document) => (doc.department === 'Quality Assurance' ? 'Awaiting QA review' : 'Awaiting manager review');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const canManageAuditCalendar = user?.role === 'Admin' || user?.role === 'QA';

  const metrics = [
    { label: 'My Open Tasks', value: taskStats.open + taskStats.inProgress, valueClass: 'text-[#2d3d80] dark:text-white', detail: `${myTasks.filter((task) => task.priority === 'critical').length} critical`, detailClass: 'text-[#e24c53]' },
    { label: 'My Overdue Tasks', value: taskStats.overdue, valueClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#2d3d80] dark:text-white', detail: taskStats.overdue > 0 ? 'Needs attention' : 'All on track', detailClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#319d68]' },
    { label: 'Awaiting My Approval', value: pendingApprovals.length, valueClass: 'text-[#d27a08]', detail: pendingApprovals.length > 0 ? 'Review needed' : 'Nothing pending', detailClass: 'text-[#d27a08]' },
    { label: 'My Submissions in Review', value: mySubmissionsInReview.length, valueClass: 'text-[#6c4fd1] dark:text-[#b9a3f5]', detail: mySubmissionsInReview.length > 0 ? 'With manager/QA' : 'Nothing submitted', detailClass: 'text-[#6c4fd1] dark:text-[#b9a3f5]' },
    { label: 'My Checked-Out Docs', value: myCheckedOutDocs.length, valueClass: 'text-[#2d3d80] dark:text-white', detail: myCheckedOutDocs.length > 0 ? '60-min lock window' : 'None checked out', detailClass: 'text-[#64748b] dark:text-slate-400' },
  ];

  const taskIcons = [Clock3, CheckCircle2, TriangleAlert, ClipboardCheck];
  const taskColors = ['border-[#f2b51d] text-[#e4a400]', 'border-[#3f8bca] text-[#3f8bca]', 'border-[#ef6b70] text-[#ef5b61]', 'border-[#cbd5e3] text-[#8292aa]'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">Welcome back, {user?.fullName ?? 'there'}</h1>
          <p className="page-subtitle">Your personal workspace · Last sync {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, 09:41</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardBody className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-[#687a95] dark:text-slate-400">{metric.label}</div>
              <div className={`mt-2 text-[29px] font-semibold leading-none ${metric.valueClass}`}>{metric.value.toLocaleString()}</div>
              <div className={`mt-3 text-xs ${metric.detailClass}`}>{metric.detail}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(330px,0.85fr)]">
        <AuditCalendarCard canManage={canManageAuditCalendar} currentUserName={user?.fullName ?? 'Admin'} />

        <div className="flex flex-col gap-5">
          <Card>
            <CardBody className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-heading">My Tasks</h2>
                <button onClick={() => navigate('/tasks')} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
              </div>
              <div className="mt-3 space-y-2">
                {myTasks.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">You have no assigned tasks right now.</p>
                )}
                {myTasks.slice(0, 4).map((task, index) => {
                  const Icon = taskIcons[index % taskIcons.length];
                  return (
                    <button key={task.taskId} onClick={() => navigate('/tasks')} className={`flex w-full gap-3 rounded-[4px] border-l-2 px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5 ${taskColors[index % taskColors.length]}`}>
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

          <Card>
            <CardBody className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-heading">Awaiting My Approval</h2>
                <button onClick={() => navigate('/approvals')} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
              </div>
              <div className="mt-3 space-y-2">
                {pendingApprovals.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">Nothing waiting on your review.</p>
                )}
                {pendingApprovals.slice(0, 4).map((approval) => (
                  <button key={approval.approvalId} onClick={() => navigate('/approvals')} className="flex w-full gap-3 rounded-[4px] border-l-2 border-[#d27a08] px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5">
                    <FileClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d27a08]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#26334d] dark:text-white">{approval.document?.name ?? 'Document'}</span>
                      <span className="mt-1 block text-xs text-[#718198]">Submitted by {approval.submittedByUser?.fullName ?? 'a colleague'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-heading">My Submissions in Review</h2>
                <button onClick={() => navigate('/documents')} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
              </div>
              <div className="mt-3 space-y-2">
                {mySubmissionsInReview.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">You have no documents waiting on approval.</p>
                )}
                {mySubmissionsInReview.slice(0, 4).map((doc) => (
                  <button key={doc.documentId} onClick={() => navigate('/documents')} className="flex w-full gap-3 rounded-[4px] border-l-2 border-[#6c4fd1] px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5">
                    <FileClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6c4fd1]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#26334d] dark:text-white">{doc.name}</span>
                      <span className="mt-1 block text-xs text-[#718198]">{reviewStageFor(doc)} · submitted {new Date(doc.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
