import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';
import { formatDateTime, formatFileSize } from '../../utils/formatters';

interface AttachmentRow {
  attachmentId: string;
  fileName: string;
  fileSizeBytes?: number | null;
  createdAt: string;
  uploadedByName?: string;
}

interface TaskAttachmentsModalProps {
  taskId: string;
  taskTitle: string;
  onClose: () => void;
}

export function TaskAttachmentsModal({ taskId, taskTitle, onClose }: TaskAttachmentsModalProps) {
  const { showSuccess, showError } = useToast();
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setIsLoading(true);
    setError(null);
    apiClient.getTaskAttachments(taskId)
      .then((res) => setAttachments(res.data || []))
      .catch((err: any) => setError(err?.response?.data?.error || err.message || 'Failed to load attachments'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const res = await apiClient.uploadTaskAttachment(taskId, file);
      if (!res.success) {
        showError(res.error || 'Failed to upload attachment');
        return;
      }
      showSuccess(`Uploaded "${file.name}"`);
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload attachment');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (attachment: AttachmentRow) => {
    setBusyId(attachment.attachmentId);
    try {
      await apiClient.downloadTaskAttachment(taskId, attachment.attachmentId, attachment.fileName);
    } catch {
      showError('Failed to download this attachment');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (attachment: AttachmentRow) => {
    setBusyId(attachment.attachmentId);
    try {
      const res = await apiClient.deleteTaskAttachment(taskId, attachment.attachmentId);
      if (!res.success) {
        showError(res.error || 'Failed to delete this attachment');
        return;
      }
      setAttachments((prev) => prev.filter((a) => a.attachmentId !== attachment.attachmentId));
      showSuccess('Attachment removed');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete this attachment');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white"><Paperclip className="h-5 w-5" /> Attachments</h2>
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">{taskTitle}</p>
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
          ) : attachments.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No attachments yet.</p>
          ) : (
            <div className="space-y-2">
              {attachments.map((a) => {
                const isBusy = busyId === a.attachmentId;
                return (
                  <div key={a.attachmentId} className="flex items-center justify-between gap-3 rounded border border-gray-200 px-4 py-3 dark:border-slate-700">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900 dark:text-white">{a.fileName}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-slate-400">{formatFileSize(a.fileSizeBytes ?? 0)} · {formatDateTime(a.createdAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <button
                        onClick={() => handleDownload(a)}
                        disabled={isBusy}
                        title="Download"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(a)}
                        disabled={isBusy}
                        title="Delete"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-red-900/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUpload(file); e.target.value = ''; }}
          />
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading} leftIcon={<Upload className="h-4 w-4" />}>
            {isUploading ? 'Uploading…' : 'Add Attachment'}
          </Button>
          <Button onClick={onClose} variant="secondary">Close</Button>
        </div>
      </div>
    </div>
  );
}
