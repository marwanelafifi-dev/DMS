import { useEffect, useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { SkeletonTable } from '../ui/Skeleton';
import { Megaphone, Trash2, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';
import { usePageAccess } from '../../hooks/usePageAccess';
import { useToast } from '../../hooks/useToast';

interface Announcement {
  announcementId: string;
  title: string;
  message: string;
  postedById: string;
  postedByName?: string | null;
  notifiedEmail: boolean;
  notifiedApp: boolean;
  recipientCount: number;
  createdAt: string;
}

interface UserLite {
  userId: string;
  fullName: string;
  email: string;
}

export function SendAnnouncement() {
  const { user } = useAuth();
  const access = usePageAccess();
  const { showSuccess, showError } = useToast();
  // The route itself is already gated on canSendAnnouncements (see App.tsx's
  // RequirePageAccess) — this only controls the "New Announcement" button.
  const canPost = access?.canSendAnnouncements === true;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: '',
    message: '',
    audience: 'all' as 'all' | 'selected',
    selectedUserIds: [] as string[],
    notifyEmail: true,
    notifyApp: true,
  });

  const loadAnnouncements = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getAnnouncements();
      setAnnouncements(Array.isArray(res.data) ? (res.data as Announcement[]) : []);
    } catch {
      showError('Failed to load announcements');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAnnouncements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canPost) return;
    apiClient.getUsers({ activeOnly: true })
      .then((res) => setUsers(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, [canPost]);

  const toggleUser = (userId: string) => {
    setForm((f) => ({
      ...f,
      selectedUserIds: f.selectedUserIds.includes(userId)
        ? f.selectedUserIds.filter((id) => id !== userId)
        : [...f.selectedUserIds, userId],
    }));
  };

  const resetForm = () => setForm({ title: '', message: '', audience: 'all', selectedUserIds: [], notifyEmail: true, notifyApp: true });

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      showError('Title and message are required');
      return;
    }
    if (form.audience === 'selected' && form.selectedUserIds.length === 0) {
      showError('Select at least one recipient, or choose "All users"');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiClient.createAnnouncement({
        title: form.title.trim(),
        message: form.message.trim(),
        recipientUserIds: form.audience === 'all' ? null : form.selectedUserIds,
        notifyEmail: form.notifyEmail,
        notifyApp: form.notifyApp,
      });
      const recipientCount = (res.data as { recipientCount?: number } | undefined)?.recipientCount ?? 0;
      showSuccess(`Announcement posted — notified ${recipientCount} user(s)`);
      resetForm();
      setShowForm(false);
      await loadAnnouncements();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to post announcement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (announcementId: string) => {
    try {
      await apiClient.deleteAnnouncement(announcementId);
      showSuccess('Announcement deleted');
      await loadAnnouncements();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete announcement');
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const canDelete = (announcement: Announcement) => announcement.postedById === user?.userId || access?.bypassFolderPermissions === true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-navy-900 dark:text-white">Send Announcement</h1>
          <p className="text-sm text-gray-500 dark:text-navy-400">Post updates visible to every user, with optional email and in-app notifications</p>
        </div>
        {canPost && (
          <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
            <Megaphone className="w-4 h-4 mr-2 inline" />
            New Announcement
          </Button>
        )}
      </div>

      {isLoading ? (
        <SkeletonTable />
      ) : announcements.length === 0 ? (
        <Card className="bg-white dark:bg-navy-950">
          <CardBody className="text-center py-12">
            <Megaphone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No announcements yet</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card key={announcement.announcementId}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-serif font-bold text-navy-900 dark:text-white">{announcement.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{announcement.message}</p>
                    <p className="mt-2 text-xs text-gray-500 dark:text-navy-400">
                      Posted by {announcement.postedByName ?? 'Unknown'} · {formatDate(announcement.createdAt)}
                      {(announcement.notifiedEmail || announcement.notifiedApp) && (
                        <> · Notified {announcement.recipientCount} user(s) via {[announcement.notifiedEmail && 'email', announcement.notifiedApp && 'in-app'].filter(Boolean).join(' + ')}</>
                      )}
                    </p>
                  </div>
                  {canDelete(announcement) && (
                    <button
                      onClick={() => handleDelete(announcement.announcementId)}
                      className="flex-shrink-0 rounded p-2 text-red-600 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                      title="Delete"
                      aria-label={`Delete announcement ${announcement.title}`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {showForm && canPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-navy-700">
              <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">New Announcement</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <X className="h-6 w-6" />
              </button>
            </div>
            <CardBody className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-navy-900 dark:text-white">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Internal Review Starting Next Week"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-navy-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-navy-900 dark:text-white">Message *</label>
                <textarea
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  placeholder="Type anything you want everyone to know..."
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-navy-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-navy-900 dark:text-white">Notify</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-navy-200">
                    <input type="radio" checked={form.audience === 'all'} onChange={() => setForm((f) => ({ ...f, audience: 'all' }))} />
                    All users
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-navy-200">
                    <input type="radio" checked={form.audience === 'selected'} onChange={() => setForm((f) => ({ ...f, audience: 'selected' }))} />
                    Selected users
                  </label>
                </div>
              </div>

              {form.audience === 'selected' && (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-navy-700">
                  {users.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-navy-400">No users found.</p>
                  ) : (
                    users.map((u) => (
                      <label key={u.userId} className="flex items-center gap-2 text-sm text-gray-700 dark:text-navy-200">
                        <input type="checkbox" checked={form.selectedUserIds.includes(u.userId)} onChange={() => toggleUser(u.userId)} />
                        {u.fullName} <span className="text-xs text-gray-400">({u.email})</span>
                      </label>
                    ))
                  )}
                </div>
              )}

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-navy-200">
                  <input type="checkbox" checked={form.notifyEmail} onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))} />
                  Send email
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-navy-200">
                  <input type="checkbox" checked={form.notifyApp} onChange={(e) => setForm((f) => ({ ...f, notifyApp: e.target.checked }))} />
                  In-app notification
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowForm(false)} disabled={isSubmitting}>Cancel</Button>
                <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? 'Posting...' : 'Post Announcement'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
