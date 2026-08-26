import { apiClient } from '../../utils/api';
import { ReadOnlyFilePreviewModal } from './ReadOnlyFilePreviewModal';

interface AttachmentPreviewModalProps {
  taskId: string;
  attachmentId: string;
  fileName: string;
  onClose: () => void;
}

/** Task-scoped adapter over the same read-only viewer used by Legacy Archive. */
export function AttachmentPreviewModal({ taskId, attachmentId, fileName, onClose }: AttachmentPreviewModalProps) {
  return (
    <ReadOnlyFilePreviewModal
      fileName={fileName}
      loadBlob={() => apiClient.fetchTaskAttachmentBlob(taskId, attachmentId)}
      onDownload={() => apiClient.downloadTaskAttachment(taskId, attachmentId, fileName)}
      onClose={onClose}
    />
  );
}
