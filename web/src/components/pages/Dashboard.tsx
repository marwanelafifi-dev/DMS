import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, FileClock, Megaphone, TriangleAlert, X } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { SkeletonCard } from '../ui/Skeleton';
import type { Task, Document, Approval } from '../../types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../utils/api';
import { AuditCalendarCard } from '../custom/AuditCalendarCard';

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

interface AnnouncementSummary {
  announcementId: string;
  title: string;
  message: string;
  postedByName?: string | null;
  createdAt: string;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Approval[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([]);
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const currentUserId = user?.userId ?? '';

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;

    const loadDashboardData = async () => {
      setIsLoading(true);
      setLoadError(null);

      // Loaded independently so one failing endpoint still leaves the rest of the
      // dashboard usable instead of blanking the whole page.
      const [taskResult, documentResult, approvalResult, announcementResult] = await Promise.allSettled([
        apiClient.getTasks(),
        apiClient.getDocuments(),
        apiClient.getPendingApprovals(),
        apiClient.getAnnouncements(),
      ]);

      if (cancelled) return;

      setTasks(taskResult.status === 'fulfilled' ? asArray<Task>(taskResult.value.data) : []);
      setRecentDocs(documentResult.status === 'fulfilled' ? asArray<Document>(documentResult.value.data) : []);
      setPendingApprovals(approvalResult.status === 'fulfilled' ? asArray<Approval>(approvalResult.value.data) : []);
      setAnnouncements(announcementResult.status === 'fulfilled' ? asArray<AnnouncementSummary>(announcementResult.value.data) : []);

      const failed = [
        taskResult.status === 'rejected' ? 'tasks' : null,
        documentResult.status === 'rejected' ? 'documents' : null,
        approvalResult.status === 'rejected' ? 'approvals' : null,
      ].filter(Boolean);

      setLoadError(failed.length > 0 ? `Could not load ${failed.join(', ')}. Showing what is available.` : null);
      setLastSyncedAt(new Date());
      setIsLoading(false);
    };

    void loadDashboardData();
    return () => { cancelled = true; };
  }, [currentUserId]);


  const dueTime = (value?: string) => {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isNaN(time) ? null : time;
  };
  const shortDate = (value?: string) => {
    const time = dueTime(value);
    return time === null ? 'no date' : new Date(time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  const myTasks = tasks.filter((t) => t.assignedTo === currentUserId);
  const taskStats = {
    open: myTasks.filter((t) => t.status === 'open').length,
    inProgress: myTasks.filter((t) => t.status === 'in_progress').length,
    done: myTasks.filter((t) => t.status === 'done').length,
    overdue: myTasks.filter((t) => {
      const due = dueTime(t.dueDate);
      return t.status !== 'done' && due !== null && due < Date.now();
    }).length,
  };
  const myCheckedOutDocs = recentDocs.filter((doc) => doc.checkoutStatus === 'checked_out' && doc.checkedOutBy === currentUserId);
  const mySubmissionsInReview = recentDocs.filter((doc) => doc.uploadedBy === currentUserId && doc.status === 'pending_approval');
  // The API returns every pending document; anything the current user submitted belongs
  // in "My Submissions in Review" instead, so it is excluded here to avoid double-counting.
  const approvalsForMe = pendingApprovals.filter((approval) => approval.submittedBy !== currentUserId);
  const reviewStageFor = (doc: Document) => (doc.department === 'Quality Assurance' ? 'Awaiting QA review' : 'Awaiting manager review');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }


  const metrics = [
    { label: 'My Open Tasks', value: taskStats.open + taskStats.inProgress, valueClass: 'text-[#2d3d80] dark:text-white', detail: `${myTasks.filter((task) => task.priority === 'critical').length} critical`, detailClass: 'text-[#e24c53]', action: () => navigate('/tasks') },
    { label: 'My Overdue Tasks', value: taskStats.overdue, valueClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#2d3d80] dark:text-white', detail: taskStats.overdue > 0 ? 'Needs attention' : 'All on track', detailClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#319d68]', action: () => navigate('/tasks') },
    { label: 'Awaiting My Approval', value: approvalsForMe.length, valueClass: 'text-[#d27a08]', detail: approvalsForMe.length > 0 ? 'Review needed' : 'Nothing pending', detailClass: 'text-[#d27a08]', action: () => navigate('/approvals') },
    { label: 'My Submissions in Review', value: mySubmissionsInReview.length, valueClass: 'text-[#6c4fd1] dark:text-[#b9a3f5]', detail: mySubmissionsInReview.length > 0 ? 'With manager/QA' : 'Nothing submitted', detailClass: 'text-[#6c4fd1] dark:text-[#b9a3f5]', action: () => navigate('/documents') },
    { label: 'My Checked-Out Docs', value: myCheckedOutDocs.length, valueClass: 'text-[#2d3d80] dark:text-white', detail: myCheckedOutDocs.length > 0 ? '60-min lock window' : 'None checked out', detailClass: 'text-[#64748b] dark:text-slate-400', action: () => navigate('/documents') },
  ];

  const taskIcons = [Clock3, CheckCircle2, TriangleAlert, ClipboardCheck];
  const taskColors = ['border-[#f2b51d] text-[#e4a400]', 'border-[#3f8bca] text-[#3f8bca]', 'border-[#ef6b70] text-[#ef5b61]', 'border-[#cbd5e3] text-[#8292aa]'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">Welcome back, {user?.fullName ?? 'there'}</h1>
          <p className="page-subtitle">
            Your personal workspace
            {lastSyncedAt && ` · Last sync ${lastSyncedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${lastSyncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>

      {loadError && (
        <div role="status" className="rounded-[4px] border-l-2 border-[#e24c53] bg-[#fdf2f2] px-4 py-3 text-sm text-[#a13239] dark:bg-[#e24c53]/10 dark:text-[#f4a3a7]">
          {loadError}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            onClick={metric.action}
            className="text-left transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] rounded-[4px]"
            aria-label={`Navigate to ${metric.label}`}
          >
            <Card>
              <CardBody className="p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[#687a95] dark:text-slate-400">{metric.label}</div>
                <div data-testid={`metric-${metric.label}`} className={`mt-2 text-[29px] font-semibold leading-none ${metric.valueClass}`}>{metric.value.toLocaleString()}</div>
                <div className={`mt-3 text-xs ${metric.detailClass}`}>{metric.detail}</div>
              </CardBody>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(330px,0.85fr)]">
        <AuditCalendarCard isFullAccess={user?.role === 'Full Access'} />

        <div className="flex flex-col gap-5">
          <Card>
            <CardBody className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-heading flex items-center gap-2"><Megaphone className="h-4 w-4 text-[#3f8bca]" />Announcements</h2>
                <button onClick={() => setShowAllAnnouncements(true)} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
              </div>
              <div className="mt-3 space-y-2">
                {announcements.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">No announcements yet.</p>
                )}
                {announcements.slice(0, 3).map((announcement) => (
                  <button key={announcement.announcementId} onClick={() => setShowAllAnnouncements(true)} className="flex w-full flex-col rounded-[4px] border-l-2 border-[#2f5f96] px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5">
                    <span className="truncate text-sm font-medium text-[#26334d] dark:text-white">{announcement.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-[#718198]">{announcement.message}</span>
                  </button>
                ))}
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
                        <span className="mt-1 block text-xs text-[#718198]">Due {shortDate(task.dueDate)} · {(task.taskType ?? 'task').replace('_', ' ')}</span>
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
                {approvalsForMe.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">Nothing waiting on your review.</p>
                )}
                {approvalsForMe.slice(0, 4).map((approval) => (
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
                      <span className="mt-1 block text-xs text-[#718198]">{reviewStageFor(doc)} · submitted {shortDate(doc.uploadedAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {showAllAnnouncements && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAllAnnouncements(false)}>
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-navy-700">
              <h2 className="section-heading flex items-center gap-2"><Megaphone className="h-4 w-4 text-[#3f8bca]" />All Announcements</h2>
              <button onClick={() => setShowAllAnnouncements(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <CardBody className="max-h-[calc(80vh-72px)] space-y-2 overflow-y-auto">
              {announcements.length === 0 ? (
                <p className="px-1 py-4 text-sm text-[#718198]">No announcements yet.</p>
              ) : (
                announcements.map((announcement) => (
                  <div key={announcement.announcementId} className="rounded-[4px] border-l-2 border-[#2f5f96] px-3 py-2.5">
                    <p className="text-sm font-medium text-[#26334d] dark:text-white">{announcement.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#52627a] dark:text-slate-300">{announcement.message}</p>
                    <p className="mt-1.5 text-xs text-[#718198]">
                      {announcement.postedByName ?? 'Unknown'} · {new Date(announcement.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
