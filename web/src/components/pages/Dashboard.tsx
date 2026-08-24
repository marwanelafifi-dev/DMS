import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, FileClock, Megaphone, TriangleAlert, X } from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { SkeletonCard } from '../ui/Skeleton';
import type { Task, Document } from '../../types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../utils/api';
import { AuditCalendarCard } from '../custom/AuditCalendarCard';
import { resolveLibraryStatus } from '../../fixtures/documentLibrary';
import { statusLabels } from '../../utils/documentStatus';
import { ModalOverlay } from '../ui/ModalOverlay';

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

interface AnnouncementSummary {
  announcementId: string;
  title: string;
  message: string;
  postedByName?: string | null;
  createdAt: string;
  notifiedEmail?: boolean;
  notifiedApp?: boolean;
  recipientCount?: number;
}

// One document from a real Document Workflow stage queue — built straight
// from the same qa-review-queue/manager-review-queue/final-release-queue
// endpoints the actual Document Workflow page uses, not the old, disconnected
// "any document with status pending_approval" legacy endpoint this used to
// call, whose fabricated approvalId (= documentId) didn't match any real
// approval record, so it could never deep-link into the queue it came from.
interface PendingApprovalItem {
  approvalId: string;
  documentId: string;
  fileName: string;
  ownerName: string;
  createdBy?: string;
  stageKey: 'qa-queue' | 'manager-queue' | 'release-queue';
}

function flattenQueueResult(
  result: PromiseSettledResult<{ data?: any[] }>,
  stageKey: PendingApprovalItem['stageKey'],
): PendingApprovalItem[] {
  if (result.status !== 'fulfilled') return [];
  return (result.value.data || [])
    .map((item: any) => {
      const doc = item.documents?.[0];
      if (!doc?.documentId) return null;
      return {
        approvalId: item.approvalId,
        documentId: doc.documentId,
        fileName: doc.fileName ?? 'Document',
        ownerName: doc.ownerName ?? 'Unknown owner',
        createdBy: item.createdBy,
        stageKey,
      };
    })
    .filter((item): item is PendingApprovalItem => item !== null);
}

export function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentDocs, setRecentDocs] = useState<Document[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([]);
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);
  // Set when a real Announcement notification is clicked (see
  // NotificationsBell) — opens the same "All Announcements" modal and
  // scrolls/highlights the one it's about, instead of just dumping the user
  // on the Dashboard with no indication of what the notification was for.
  const highlightedAnnouncementId = searchParams.get('announcement');
  const highlightedAnnouncementRef = useRef<HTMLButtonElement | null>(null);
  // Set when a specific announcement is opened (either by clicking a row in
  // the list, or arriving via a notification) — shows its full details
  // instead of the truncated list-row preview.
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementSummary | null>(null);
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
      // dashboard usable instead of blanking the whole page. A role without
      // access to a given stage gets a 403 for that one call, which just
      // resolves to an empty list for that stage below — same graceful
      // degradation as any other failed call here.
      const [taskResult, documentResult, qaResult, managerResult, releaseResult, announcementResult] = await Promise.allSettled([
        apiClient.getTasks(),
        apiClient.getDocuments(),
        apiClient.getQaReviewQueue({ pageSize: 100 }),
        apiClient.getManagerReviewQueue({ pageSize: 100 }),
        apiClient.getFinalReleaseQueue({ pageSize: 100 }),
        apiClient.getAnnouncements(),
      ]);

      if (cancelled) return;

      setTasks(taskResult.status === 'fulfilled' ? asArray<Task>(taskResult.value.data) : []);
      setRecentDocs(documentResult.status === 'fulfilled' ? asArray<Document>(documentResult.value.data) : []);
      setPendingApprovals([
        ...flattenQueueResult(qaResult, 'qa-queue'),
        ...flattenQueueResult(managerResult, 'manager-queue'),
        ...flattenQueueResult(releaseResult, 'release-queue'),
      ]);
      setAnnouncements(announcementResult.status === 'fulfilled' ? asArray<AnnouncementSummary>(announcementResult.value.data) : []);

      // A rejected queue call (qa/manager/release) usually just means this
      // role has no access to that stage — a normal, expected 403, not a
      // real failure worth surfacing as a load-error banner.
      const failed = [
        taskResult.status === 'rejected' ? 'tasks' : null,
        documentResult.status === 'rejected' ? 'documents' : null,
      ].filter(Boolean);

      setLoadError(failed.length > 0 ? `Could not load ${failed.join(', ')}. Showing what is available.` : null);
      setLastSyncedAt(new Date());
      setIsLoading(false);
    };

    void loadDashboardData();
    return () => { cancelled = true; };
  }, [currentUserId]);

  useEffect(() => {
    if (!highlightedAnnouncementId || announcements.length === 0) return;
    setShowAllAnnouncements(true);
    // Jump straight to the full detail view for the one the notification was
    // about, rather than just scrolling to it in the list.
    const match = announcements.find((a) => a.announcementId === highlightedAnnouncementId);
    if (match) {
      setSelectedAnnouncement(match);
      return;
    }
    // Fallback (e.g. the announcement was somehow not found): scroll/highlight
    // in the list instead of doing nothing.
    const timer = window.setTimeout(() => {
      highlightedAnnouncementRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [highlightedAnnouncementId, announcements]);

  const closeAnnouncementsModal = () => {
    setShowAllAnnouncements(false);
    setSelectedAnnouncement(null);
    if (searchParams.has('announcement')) {
      const next = new URLSearchParams(searchParams);
      next.delete('announcement');
      setSearchParams(next, { replace: true });
    }
  };


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
  // The queues return every pending document in that stage; anything the
  // current user submitted themselves belongs in "My Submitted Documents"
  // instead, so it is excluded here to avoid double-counting.
  const approvalsForMe = pendingApprovals.filter((approval) => approval.createdBy !== currentUserId);
  const approvalDeepLink = (approval: PendingApprovalItem) =>
    `/approvals?tab=${approval.stageKey}&approvalId=${encodeURIComponent(approval.approvalId)}&documentId=${encodeURIComponent(approval.documentId)}`;
  // The real stage, not a department-based guess — same resolution the
  // Document Library/Search/Preview already use, so this panel never shows a
  // status that disagrees with what the document actually shows everywhere else.
  const reviewStageFor = (doc: Document) => statusLabels[resolveLibraryStatus(doc)];
  // "In Review" would be misleading as a blanket label — some of these are
  // actually sitting back with the submitter awaiting a fix, the opposite of
  // being under review, so the count/detail text stays neutral about that.
  const mySubmissionsNeedingCorrection = mySubmissionsInReview.filter((doc) => resolveLibraryStatus(doc) === 'correction_in_progress').length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }


  const metrics = [
    { label: 'My Open Tasks', value: taskStats.open + taskStats.inProgress, valueClass: 'text-[#2d3d80] dark:text-white', detail: `${myTasks.filter((task) => task.priority === 'critical').length} critical`, detailClass: 'text-[#e24c53]', action: () => { const openTask = myTasks.find((t) => t.status === 'open' || t.status === 'in_progress'); navigate(openTask ? `/tasks?highlight=${encodeURIComponent(openTask.taskId)}` : '/tasks'); } },
    { label: 'My Overdue Tasks', value: taskStats.overdue, valueClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#2d3d80] dark:text-white', detail: taskStats.overdue > 0 ? 'Needs attention' : 'All on track', detailClass: taskStats.overdue > 0 ? 'text-[#e24c53]' : 'text-[#319d68]', action: () => { const overdueTask = myTasks.find((t) => { const due = dueTime(t.dueDate); return t.status !== 'done' && due !== null && due < Date.now(); }); navigate(overdueTask ? `/tasks?highlight=${encodeURIComponent(overdueTask.taskId)}` : '/tasks'); } },
    { label: 'Awaiting My Approval', value: approvalsForMe.length, valueClass: 'text-[#d27a08]', detail: approvalsForMe.length > 0 ? 'Review needed' : 'Nothing pending', detailClass: 'text-[#d27a08]', action: () => navigate(approvalsForMe[0] ? approvalDeepLink(approvalsForMe[0]) : '/approvals') },
    { label: 'My Submitted Documents', value: mySubmissionsInReview.length, valueClass: 'text-[#6c4fd1] dark:text-[#b9a3f5]', detail: mySubmissionsNeedingCorrection > 0 ? `${mySubmissionsNeedingCorrection} need correction` : mySubmissionsInReview.length > 0 ? 'In the approval pipeline' : 'Nothing submitted', detailClass: mySubmissionsNeedingCorrection > 0 ? 'text-[#c73c44]' : 'text-[#6c4fd1] dark:text-[#b9a3f5]', action: () => navigate('/documents?mine=1') },
    { label: 'My Checked-Out Docs', value: myCheckedOutDocs.length, valueClass: 'text-[#2d3d80] dark:text-white', detail: myCheckedOutDocs.length > 0 ? '60-min lock window' : 'None checked out', detailClass: 'text-[#64748b] dark:text-slate-400', action: () => navigate(myCheckedOutDocs[0] ? `/documents?preview=${encodeURIComponent(myCheckedOutDocs[0].documentId)}` : '/documents') },
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
                    <button key={task.taskId} onClick={() => navigate(`/tasks?highlight=${encodeURIComponent(task.taskId)}`)} className={`flex w-full gap-3 rounded-[4px] border-l-2 px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5 ${taskColors[index % taskColors.length]}`}>
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
                  <button key={`${approval.approvalId}-${approval.documentId}`} onClick={() => navigate(approvalDeepLink(approval))} className="flex w-full gap-3 rounded-[4px] border-l-2 border-[#d27a08] px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5">
                    <FileClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d27a08]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#26334d] dark:text-white">{approval.fileName}</span>
                      <span className="mt-1 block text-xs text-[#718198]">Submitted by {approval.ownerName}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-heading">My Submitted Documents</h2>
                <button onClick={() => navigate('/documents?mine=1')} className="text-xs font-medium text-[#3f8bca] hover:underline">View all</button>
              </div>
              <div className="mt-3 space-y-2">
                {mySubmissionsInReview.length === 0 && (
                  <p className="px-1 py-4 text-sm text-[#718198]">You have no documents waiting on approval.</p>
                )}
                {mySubmissionsInReview.slice(0, 4).map((doc) => (
                  <button key={doc.documentId} onClick={() => navigate(`/documents?mine=1&preview=${doc.documentId}`)} className="flex w-full gap-3 rounded-[4px] border-l-2 border-[#6c4fd1] px-3 py-2.5 text-left hover:bg-[#f8fafc] dark:hover:bg-white/5">
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
        <ModalOverlay onClose={closeAnnouncementsModal} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-navy-700">
              <h2 className="section-heading flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-[#3f8bca]" />
                {selectedAnnouncement ? selectedAnnouncement.title : 'All Announcements'}
              </h2>
              <button onClick={closeAnnouncementsModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedAnnouncement ? (
              <CardBody className="max-h-[calc(80vh-72px)] space-y-4 overflow-y-auto">
                <button onClick={() => setSelectedAnnouncement(null)} className="text-xs font-medium text-[#3f8bca] hover:underline">&larr; Back to all announcements</button>
                <p className="whitespace-pre-wrap text-sm text-[#52627a] dark:text-slate-300">{selectedAnnouncement.message}</p>
                <div className="space-y-1.5 border-t border-gray-200 pt-3 text-xs text-[#718198] dark:border-navy-700">
                  <p>Posted by {selectedAnnouncement.postedByName ?? 'Unknown'}</p>
                  <p>{new Date(selectedAnnouncement.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  {typeof selectedAnnouncement.recipientCount === 'number' && (
                    <p>Sent to {selectedAnnouncement.recipientCount} recipient{selectedAnnouncement.recipientCount === 1 ? '' : 's'}</p>
                  )}
                  <p>
                    Delivered via {[selectedAnnouncement.notifiedApp && 'in-app notification', selectedAnnouncement.notifiedEmail && 'email'].filter(Boolean).join(' and ') || 'no channel recorded'}
                  </p>
                </div>
              </CardBody>
            ) : (
              <CardBody className="max-h-[calc(80vh-72px)] space-y-2 overflow-y-auto">
                {announcements.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-[#718198]">No announcements yet.</p>
                ) : (
                  announcements.map((announcement) => {
                    const isHighlighted = announcement.announcementId === highlightedAnnouncementId;
                    return (
                      <button
                        key={announcement.announcementId}
                        ref={isHighlighted ? highlightedAnnouncementRef : undefined}
                        onClick={() => setSelectedAnnouncement(announcement)}
                        className={`block w-full rounded-[4px] border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-[#f8fafc] dark:hover:bg-white/5 ${
                          isHighlighted ? 'border-[#3f8bca] bg-[#eaf3fb] dark:bg-[#3f8bca]/15' : 'border-[#2f5f96]'
                        }`}
                      >
                        <p className="text-sm font-medium text-[#26334d] dark:text-white">{announcement.title}</p>
                        <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-[#52627a] dark:text-slate-300">{announcement.message}</p>
                        <p className="mt-1.5 text-xs text-[#718198]">
                          {announcement.postedByName ?? 'Unknown'} · {new Date(announcement.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </button>
                    );
                  })
                )}
              </CardBody>
            )}
          </Card>
        </ModalOverlay>
      )}
    </div>
  );
}
